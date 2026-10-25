import "dotenv/config";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { dashboardHtml } from "./dashboard.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const AGENT_TOKEN = process.env.OPS_API_AGENT_TOKEN;
const APPROVAL_TOKEN = process.env.OPS_API_APPROVAL_TOKEN;
const PORT = Number(process.env.PORT ?? 4004);

async function audit(actor: string, action: string, target: string, outcome: string, detail?: string) {
  await prisma.auditLog.create({ data: { actor, action, target, outcome, detail } });
}

function bearerToken(req: any): string | undefined {
  const header = req.headers["authorization"];
  return typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : undefined;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(dashboardHtml);
});

app.get("/api/pods", async () => {
  const pods = await prisma.pod.findMany();
  return {
    pods: pods.map((p) => ({
      name: p.name,
      service: p.service,
      memoryPercent: p.memoryPercent,
      status: p.status,
    })),
  };
});

app.get("/api/overview", async (req, reply) => {
  const { pod: podName } = req.query as { pod?: string };
  const pod = await prisma.pod.findUnique({ where: { name: podName || "checkout-api-7f9c-2" } });
  if (!pod) {
    reply.code(404).send({ error: `Unknown pod: ${podName}` });
    return;
  }
  const deployments = await prisma.deploymentEvent.findMany({
    where: { service: pod.service },
    orderBy: { deployedAt: "desc" },
  });
  const auditLog = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 });
  return { pod, deployments, auditLog };
});

app.get("/pods/:name/metrics", async (req, reply) => {
  const { name } = req.params as { name: string };
  const pod = await prisma.pod.findUnique({ where: { name } });
  if (!pod) {
    reply.code(404).send({ error: `Unknown pod: ${name}` });
    return;
  }
  return {
    pod: pod.name,
    service: pod.service,
    memoryPercent: pod.memoryPercent,
    cpuPercent: pod.cpuPercent,
    status: pod.status,
  };
});

app.get("/deployments/:service/history", async (req, reply) => {
  const { service } = req.params as { service: string };
  const events = await prisma.deploymentEvent.findMany({
    where: { service },
    orderBy: { deployedAt: "desc" },
  });
  if (events.length === 0) {
    reply.code(404).send({ error: `No deployment history for service: ${service}` });
    return;
  }
  return {
    service,
    history: events.map((e) => ({ version: e.version, deployedAt: e.deployedAt })),
  };
});

app.get("/audit-log", async () => {
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return { entries };
});

app.post("/pods/:name/restart", async (req, reply) => {
  const { name } = req.params as { name: string };
  const provided = bearerToken(req);
  const actor = (req.headers["x-actor"] as string) || "agent";

  const authorized = provided === AGENT_TOKEN || provided === APPROVAL_TOKEN;
  if (!authorized) {
    await audit(actor, "restart-pod", name, "denied", "Missing or incorrect agent token");
    reply.code(403).send({ error: "Action requires a valid agent token." });
    return;
  }

  const pod = await prisma.pod.findUnique({ where: { name } });
  if (!pod) {
    await audit(actor, "restart-pod", name, "error", "Unknown pod");
    reply.code(404).send({ error: `Unknown pod: ${name}` });
    return;
  }

  await prisma.pod.update({ where: { id: pod.id }, data: { memoryPercent: 12, status: "healthy" } });
  await audit(actor, "restart-pod", name, "success", "Green tier, pre-approved, memory reset to 12%");

  return {
    pod: pod.name,
    action: "restart",
    result: "Pod restarted, memory reset to 12%",
    performedAt: new Date().toISOString(),
  };
});

app.post("/deployments/:service/rollback", async (req, reply) => {
  const { service } = req.params as { service: string };
  const { toVersion } = (req.body as { toVersion?: string }) ?? {};
  const provided = bearerToken(req);
  const actor = (req.headers["x-actor"] as string) || "agent";

  if (provided !== APPROVAL_TOKEN) {
    await audit(actor, "rollback-deployment", service, "denied", "Agent token alone is not enough, this action needs human approval specifically");
    reply.code(403).send({
      error: "Rollback requires the human approval token, an agent token alone is not sufficient for this action.",
    });
    return;
  }

  const version = toVersion || "4.11.0";
  await prisma.deploymentEvent.create({
    data: { service, version, deployedAt: new Date() },
  });

  const pod = await prisma.pod.findFirst({ where: { service } });
  if (pod) {
    await prisma.pod.update({ where: { id: pod.id }, data: { status: "healthy" } });
  }

  await audit(actor, "rollback-deployment", service, "success", `Rolled back to ${version}, human approved`);

  return {
    service,
    action: "rollback",
    version,
    performedAt: new Date().toISOString(),
  };
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`ops-api listening on ${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
