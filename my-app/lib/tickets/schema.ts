import { z } from 'zod';

// Matches tickets.source's documented values (see docker/postgres/init.sql) - the three
// intake channels from ARCHITECTURE.md's flow diagram (Slack is listed there as "future",
// but accepted here already so the intake contract doesn't need to change again once it
// ships).
export const ticketSourceSchema = z.enum(['portal', 'jira', 'slack']);

export const createTicketSchema = z.object({
  source: ticketSourceSchema,
  // Set by the caller for sources that already have their own identifier (e.g. a Jira issue
  // key) so an escalation later can round-trip back to the originating system.
  externalRef: z.string().trim().min(1).max(255).optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(20_000),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
