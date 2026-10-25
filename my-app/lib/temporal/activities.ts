// Temporal activities for TicketResolutionWorkflow (see workflows.ts). Activities, unlike
// workflow code, are ordinary Node - free to do I/O (Postgres, the Jarvislabs HTTP call via
// lib/pgvector/query's retrieval+judgement) - Temporal just handles their retries/timeouts.
//
// Relative imports throughout (not the "@/..." tsconfig alias) - this file is loaded by the
// Temporal worker via tsx/ts-node (scripts/temporal-worker.ts), not Next.js's bundler, which is
// the only thing that resolves that alias in this project.
import {
  getTicketById,
  appendTicketAuditLog,
  type Ticket,
} from "../tickets/repository";
import { queryPineconeForTicketResolution } from "../pgvector/query";

export type TicketJudgement = {
  type: "duplicate" | "resolution" | "none";
  confidence: number;
  message?: string;
  matchedTicketKey?: string;
};

export async function fetchTicket(ticketId: string): Promise<Ticket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  return ticket;
}

/** The "embed + retrieve context" + "ask Jarvislabs to decide" activities from
 * ARCHITECTURE.md's flow, combined into one Temporal activity - the retrieval and the
 * judgement call are both already one round trip in queryPineconeForTicketResolution (see
 * lib/pgvector/query.ts), so splitting them into two activities would only add a redundant
 * embedding call between them. */
export async function retrieveAndJudge(ticketId: string): Promise<TicketJudgement> {
  const ticket = await fetchTicket(ticketId);
  const query = `TITLE: ${ticket.title}\nDESCRIPTION: ${ticket.description}`;

  const result = await queryPineconeForTicketResolution({ query, duplicateNeeded: true });

  return {
    type: result.type,
    confidence: result.score ?? 0,
    message: result.message,
    matchedTicketKey: result.original_ticket_id || result.source_ticket_id,
  };
}

export async function applyAutoResolution(ticketId: string, judgement: TicketJudgement): Promise<void> {
  const pool = (await import("../db")).getPool();
  await pool.query(`UPDATE tickets SET status = 'resolved', updated_at = now() WHERE id = $1`, [ticketId]);
  await appendTicketAuditLog(ticketId, "gemma", "auto_resolved", judgement);
}

export async function escalateToHuman(ticketId: string, judgement: TicketJudgement): Promise<void> {
  const pool = (await import("../db")).getPool();
  await pool.query(`UPDATE tickets SET status = 'escalated', updated_at = now() WHERE id = $1`, [ticketId]);
  await appendTicketAuditLog(ticketId, "system", "escalated_pending_human_approval", judgement);
}

export async function recordHumanDecision(
  ticketId: string,
  approved: boolean,
  judgement: TicketJudgement,
): Promise<void> {
  const pool = (await import("../db")).getPool();
  const status = approved ? "resolved" : "escalated";
  await pool.query(`UPDATE tickets SET status = $1, updated_at = now() WHERE id = $2`, [status, ticketId]);
  await appendTicketAuditLog(
    ticketId,
    "human",
    approved ? "human_approved_resolution" : "human_rejected_resolution",
    judgement,
  );
}
