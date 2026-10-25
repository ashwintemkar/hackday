import { Connection, Client } from '@temporalio/client';
import type { Ticket } from '@/lib/tickets/repository';

// No worker implements this workflow yet (see ARCHITECTURE.md's TicketResolutionWorkflow -
// embed+retrieve/decide/execute/escalate activities aren't built). Starting it by its string
// name rather than a typed workflow-function reference means intake doesn't need that
// implementation to exist first: Temporal queues the run on this task queue and it executes
// once a worker registers against the same name/queue, same as any other durable workflow.
export const TICKET_RESOLUTION_WORKFLOW_TYPE = 'TicketResolutionWorkflow';
export const TICKET_RESOLUTION_TASK_QUEUE =
  process.env.TEMPORAL_TASK_QUEUE || 'ticket-resolution';

declare global {
  var __ticketlyTemporalClient: Client | undefined;
}

async function getTemporalClient(): Promise<Client> {
  if (!globalThis.__ticketlyTemporalClient) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    globalThis.__ticketlyTemporalClient = new Client({ connection });
  }
  return globalThis.__ticketlyTemporalClient;
}

export type WorkflowStartResult =
  | { started: true; workflowId: string }
  | { started: false; reason: string };

/** Best-effort: a dev machine without `docker compose up temporal` running shouldn't make
 * ticket intake fail - the ticket is already durably stored in Postgres by the time this is
 * called, so a Temporal outage only means resolution is delayed, not that intake is lost. */
export async function startTicketResolutionWorkflow(
  ticket: Ticket,
): Promise<WorkflowStartResult> {
  const workflowId = `ticket-resolution-${ticket.id}`;
  try {
    const client = await getTemporalClient();
    await client.workflow.start(TICKET_RESOLUTION_WORKFLOW_TYPE, {
      taskQueue: TICKET_RESOLUTION_TASK_QUEUE,
      workflowId,
      args: [{ ticketId: ticket.id }],
    });
    return { started: true, workflowId };
  } catch (error) {
    console.error(
      `[tickets] could not start ${TICKET_RESOLUTION_WORKFLOW_TYPE} for ticket ${ticket.id}:`,
      error,
    );
    return {
      started: false,
      reason: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
