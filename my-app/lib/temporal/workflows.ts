// TicketResolutionWorkflow - the durable workflow from ARCHITECTURE.md's flow diagram
// (A1 embed+retrieve -> A2 ask Jarvislabs to decide -> A3 auto-resolve or A4 escalate to human,
// gated by a HumanApprovalSignal). Started by name from lib/temporal/client.ts whenever a
// ticket is created (see app/api/tickets/route.ts) - this file is what finally implements it;
// before this, the client only queued the run with nothing to execute it.
//
// Workflow code must stay deterministic (no direct I/O, no Date.now(), no random) - all the
// real work (Postgres, the Jarvislabs call) happens in activities.ts, invoked here only through
// proxyActivities. Relative imports only, same reason as activities.ts: Temporal's workflow
// bundler doesn't resolve the "@/..." tsconfig alias.
import { proxyActivities, defineSignal, setHandler, condition, log } from "@temporalio/workflow";
import type * as activities from "./activities";

const { retrieveAndJudge, applyAutoResolution, escalateToHuman, recordHumanDecision } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

// Confidence at/above this auto-resolves without a human in the loop; below it, the ticket is
// escalated and waits on a human's call instead - the same "confident -> auto-resolve,
// low-confidence -> escalate" split ARCHITECTURE.md describes for Temporal's WF node.
const AUTO_RESOLVE_CONFIDENCE_THRESHOLD = 0.82;

// How long an escalated ticket waits for a human before the workflow gives up and leaves it
// escalated for someone to pick up outside this run.
const HUMAN_APPROVAL_TIMEOUT = "7 days";

export const humanApprovalSignal = defineSignal<[{ approved: boolean }]>("humanApproval");

export type TicketResolutionResult = {
  status: "resolved" | "escalated" | "timed_out_awaiting_human";
  confidence: number;
  matchedTicketKey?: string;
};

export async function ticketResolutionWorkflow(input: {
  ticketId: string;
}): Promise<TicketResolutionResult> {
  const judgement = await retrieveAndJudge(input.ticketId);
  log.info("Ticket judged", { ticketId: input.ticketId, ...judgement });

  if (judgement.type !== "none" && judgement.confidence >= AUTO_RESOLVE_CONFIDENCE_THRESHOLD) {
    await applyAutoResolution(input.ticketId, judgement);
    return { status: "resolved", confidence: judgement.confidence, matchedTicketKey: judgement.matchedTicketKey };
  }

  await escalateToHuman(input.ticketId, judgement);

  let humanDecision: { approved: boolean } | undefined;
  setHandler(humanApprovalSignal, (value) => {
    humanDecision = value;
  });

  const signaled = await condition(() => humanDecision !== undefined, HUMAN_APPROVAL_TIMEOUT);
  if (!signaled) {
    return { status: "timed_out_awaiting_human", confidence: judgement.confidence };
  }

  await recordHumanDecision(input.ticketId, humanDecision!.approved, judgement);
  return {
    status: humanDecision!.approved ? "resolved" : "escalated",
    confidence: judgement.confidence,
    matchedTicketKey: judgement.matchedTicketKey,
  };
}
