import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { runAgentLoop, type AgentLoopRequest, type ScenarioSlug } from "@/lib/agent-loop";

// Manual verification endpoint for the agent orchestration loop.
// Session gated like every other /api route in this app. Runs one real
// scenario through Jarvislabs and the real mcp-gateway and returns the full
// transcript, including any pending_human_approval state, as JSON, so the
// loop and the human approval gate can be proven end to end without the
// full chat UI wired up yet.
//
// Two request shapes:
//
// Fresh run:
//   { "scenario": "interface-flapping", "message": "edge-rtr-04's interface keeps flapping, can you look into it?" }
//
// Resume after a human approves a pending gated tool call, using the
// conversationState and pendingApproval this route returned from the run
// being resumed:
//   { "scenario": "interface-flapping", "conversationState": [...], "resumeApproval": { "callId": "...", "tool": "network_soft_clear_interface", "input": { "device": "edge-rtr-04" } } }
//
// Same shape but denyApproval instead of resumeApproval, the tool is never
// executed and the model is told the human denied it:
//   { "scenario": "interface-flapping", "conversationState": [...], "denyApproval": { "callId": "...", "tool": "network_soft_clear_interface", "input": { "device": "edge-rtr-04" } } }
//
// A follow-up message on an existing conversation, keeps the same thread
// going instead of starting over:
//   { "scenario": "interface-flapping", "conversationState": [...], "continueMessage": "yeah go ahead and check the mac table too" }
const KNOWN_SCENARIOS: ScenarioSlug[] = ["interface-flapping"];

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { scenario, message, conversationState, resumeApproval, denyApproval, continueMessage } = body as Partial<AgentLoopRequest>;

    if (!scenario || !KNOWN_SCENARIOS.includes(scenario)) {
      return NextResponse.json(
        { error: `scenario must be one of: ${KNOWN_SCENARIOS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!message && !resumeApproval && !denyApproval && !continueMessage) {
      return NextResponse.json(
        { error: "Provide message (fresh run), resumeApproval + conversationState (approve), denyApproval + conversationState (deny), or continueMessage + conversationState (keep chatting)" },
        { status: 400 },
      );
    }

    const result = await runAgentLoop({ scenario, message, conversationState, resumeApproval, denyApproval, continueMessage });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
