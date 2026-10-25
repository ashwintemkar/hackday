import { getPool } from '@/lib/db';
import type { CreateTicketInput } from '@/lib/tickets/schema';

export type Ticket = {
  id: string;
  source: string;
  external_ref: string | null;
  title: string;
  description: string;
  status: string;
  workflow_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type TicketAuditLogEntry = {
  id: string;
  ticket_id: string;
  actor: string;
  action: string;
  detail: unknown;
  created_at: Date;
};

/** Inserts the ticket plus its first audit-log entry atomically - a ticket that exists
 * without any audit trail would be a data-integrity gap the whole point of
 * ticket_audit_log is meant to prevent. */
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Ticket>(
      `INSERT INTO tickets (source, external_ref, title, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.source, input.externalRef ?? null, input.title, input.description],
    );
    const ticket = rows[0];
    await client.query(
      `INSERT INTO ticket_audit_log (ticket_id, actor, action, detail)
       VALUES ($1, $2, $3, $4)`,
      [ticket.id, 'system', 'ticket_intake', JSON.stringify({ source: input.source })],
    );
    await client.query('COMMIT');
    return ticket;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setTicketWorkflowId(
  ticketId: string,
  workflowId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE tickets SET workflow_id = $1, updated_at = now() WHERE id = $2`,
    [workflowId, ticketId],
  );
}

export async function appendTicketAuditLog(
  ticketId: string,
  actor: string,
  action: string,
  detail?: unknown,
): Promise<void> {
  await getPool().query(
    `INSERT INTO ticket_audit_log (ticket_id, actor, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, actor, action, detail === undefined ? null : JSON.stringify(detail)],
  );
}

export async function listTickets(limit: number): Promise<Ticket[]> {
  const { rows } = await getPool().query<Ticket>(
    `SELECT * FROM tickets ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  const { rows } = await getPool().query<Ticket>(
    `SELECT * FROM tickets WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getTicketAuditLog(
  ticketId: string,
): Promise<TicketAuditLogEntry[]> {
  const { rows } = await getPool().query<TicketAuditLogEntry>(
    `SELECT * FROM ticket_audit_log WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId],
  );
  return rows;
}
