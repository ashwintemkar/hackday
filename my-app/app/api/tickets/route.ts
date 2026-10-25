import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createTicketSchema } from '@/lib/tickets/schema';
import {
  appendTicketAuditLog,
  createTicket,
  listTickets,
  setTicketWorkflowId,
} from '@/lib/tickets/repository';
import { startTicketResolutionWorkflow } from '@/lib/temporal/client';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Ticket intake - the single entry point ARCHITECTURE.md's flow diagram routes Portal, Jira,
 * and (future) Slack through before a ticket reaches the TicketResolutionWorkflow. Persists the
 * ticket first (so intake never depends on Temporal being reachable), then best-effort starts
 * the workflow.
 */
export async function POST(request: NextRequest) {
  let input;
  try {
    input = createTicketSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  try {
    const ticket = await createTicket(input);

    const workflowResult = await startTicketResolutionWorkflow(ticket);
    if (workflowResult.started) {
      await setTicketWorkflowId(ticket.id, workflowResult.workflowId);
      await appendTicketAuditLog(ticket.id, 'system', 'workflow_started', {
        workflowId: workflowResult.workflowId,
      });
      ticket.workflow_id = workflowResult.workflowId;
    } else {
      await appendTicketAuditLog(ticket.id, 'system', 'workflow_start_failed', {
        reason: workflowResult.reason,
      });
    }

    return NextResponse.json({ success: true, data: ticket }, { status: 201 });
  } catch (error) {
    console.error('[api/tickets] intake failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create ticket' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get('limit');
  const parsedLimit = limitParam ? Number(limitParam) : DEFAULT_LIST_LIMIT;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

  try {
    const tickets = await listTickets(limit);
    return NextResponse.json({ success: true, data: tickets });
  } catch (error) {
    console.error('[api/tickets] list failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list tickets' },
      { status: 500 },
    );
  }
}
