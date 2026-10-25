// Runs the Temporal worker that actually executes TicketResolutionWorkflow (lib/temporal/
// workflows.ts) - until this runs, ticket intake (app/api/tickets/route.ts) still starts the
// workflow, but it just sits queued on the `ticket-resolution` task queue with nothing to pick
// it up. Start with `pnpm worker:temporal` (needs `docker compose up -d temporal temporal-ui
// ollama postgres` running first, and JARVISLABS_API_KEY/JARVISLABS_ENDPOINT set for the
// judgement step).
import "dotenv/config";
import { Worker } from "@temporalio/worker";
import * as activities from "../lib/temporal/activities";
import { TICKET_RESOLUTION_TASK_QUEUE } from "../lib/temporal/client";

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve("../lib/temporal/workflows"),
    activities,
    taskQueue: TICKET_RESOLUTION_TASK_QUEUE,
  });

  console.log(`[temporal-worker] polling task queue "${TICKET_RESOLUTION_TASK_QUEUE}"`);
  await worker.run();
}

run().catch((err) => {
  console.error("[temporal-worker] fatal error:", err);
  process.exit(1);
});
