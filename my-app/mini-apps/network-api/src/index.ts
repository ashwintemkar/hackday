import "dotenv/config";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { dashboardHtml } from "./dashboard.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const ACTION_TOKEN = process.env.NETWORK_API_ACTION_TOKEN;
const PORT = Number(process.env.PORT ?? 4001);

async function audit(actor: string, action: string, target: string, outcome: string, detail?: string) {
  await prisma.auditLog.create({ data: { actor, action, target, outcome, detail } });
}

async function findDeviceOrReply(name: string, reply: any) {
  const device = await prisma.device.findUnique({ where: { name }, include: { interfaces: true } });
  if (!device) {
    reply.code(404).send({ error: `Unknown device: ${name}` });
    return null;
  }
  return device;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(dashboardHtml);
});

app.get("/api/devices", async () => {
  const devices = await prisma.device.findMany({ include: { interfaces: true } });
  return {
    devices: devices.map((d) => ({
      name: d.name,
      model: d.model,
      firmwareVersion: d.firmwareVersion,
      status: d.interfaces[0]?.status ?? "unknown",
      maxCrcErrors24h: Math.max(0, ...d.interfaces.map((i) => i.crcErrors24h)),
    })),
  };
});

app.get("/api/overview", async (req, reply) => {
  const { device: deviceName } = req.query as { device?: string };
  const device = await prisma.device.findUnique({
    where: { name: deviceName || "edge-rtr-04" },
    include: {
      interfaces: { include: { counterSamples: { orderBy: { sampledAt: "asc" } } } },
      flapEvents: { orderBy: { occurredAt: "asc" } },
      logLines: { orderBy: { loggedAt: "asc" } },
      macEntries: true,
    },
  });
  if (!device) {
    reply.code(404).send({ error: `Unknown device: ${deviceName}` });
    return;
  }
  const auditLog = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 });
  return { device, auditLog };
});

app.get("/devices/:name/interface-status", async (req, reply) => {
  const { name } = req.params as { name: string };
  const device = await findDeviceOrReply(name, reply);
  if (!device) return;

  return {
    device: device.name,
    interfaces: device.interfaces.map((i) => ({
      name: i.name,
      status: i.status,
      crcErrors24h: i.crcErrors24h,
      resets24h: i.resets24h,
    })),
  };
});

app.get("/devices/:name/counter-history", async (req, reply) => {
  const { name } = req.params as { name: string };
  const device = await prisma.device.findUnique({
    where: { name },
    include: { interfaces: { include: { counterSamples: { orderBy: { sampledAt: "asc" } } } } },
  });
  if (!device) {
    reply.code(404).send({ error: `Unknown device: ${name}` });
    return;
  }

  return {
    device: device.name,
    interfaces: device.interfaces.map((i) => ({
      name: i.name,
      samples: i.counterSamples.map((s) => ({ sampledAt: s.sampledAt, crcErrors: s.crcErrors })),
    })),
  };
});

app.get("/devices/:name/mac-table", async (req, reply) => {
  const { name } = req.params as { name: string };
  const device = await prisma.device.findUnique({ where: { name }, include: { macEntries: true } });
  if (!device) {
    reply.code(404).send({ error: `Unknown device: ${name}` });
    return;
  }

  return {
    device: device.name,
    entries: device.macEntries.map((m) => ({
      interfaceName: m.interfaceName,
      macAddress: m.macAddress,
      vlan: m.vlan,
      learnedAt: m.learnedAt,
    })),
  };
});

app.get("/devices/:name/logs", async (req, reply) => {
  const { name } = req.params as { name: string };
  const device = await prisma.device.findUnique({
    where: { name },
    include: { logLines: { orderBy: { loggedAt: "asc" } } },
  });
  if (!device) {
    reply.code(404).send({ error: `Unknown device: ${name}` });
    return;
  }

  return {
    device: device.name,
    lines: device.logLines.map((l) => ({ loggedAt: l.loggedAt, text: l.text })),
  };
});

app.get("/devices/:name/flap-history", async (req, reply) => {
  const { name } = req.params as { name: string };
  const device = await findDeviceOrReply(name, reply);
  if (!device) return;

  const events = await prisma.flapEvent.findMany({
    where: { deviceId: device.id },
    orderBy: { occurredAt: "asc" },
  });
  return {
    device: device.name,
    flapCount: events.length,
    windowDays: 9,
    events: events.map((e) => ({
      interfaceName: e.interfaceName,
      occurredAt: e.occurredAt,
      note: e.note,
    })),
  };
});

app.get("/known-issues", async (req) => {
  const { model, firmwareVersion } = req.query as { model?: string; firmwareVersion?: string };
  const issues = await prisma.knownIssue.findMany({ where: model ? { matchModel: model } : undefined });
  const matches = issues.filter((issue) => {
    if (!firmwareVersion) return true;
    return issue.affectedVersions.split(",").includes(firmwareVersion);
  });
  return {
    queried: { model, firmwareVersion },
    matches: matches.map((i) => ({
      issueRef: i.issueRef,
      matchModel: i.matchModel,
      matchFirmwareRange: i.matchFirmwareRange,
      symptom: i.symptom,
      rootCause: i.rootCause,
      fixedInVersion: i.fixedInVersion,
      recommendedAction: i.recommendedAction,
    })),
  };
});

app.get("/audit-log", async () => {
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return { entries };
});

app.post("/devices/:name/soft-clear-interface", async (req, reply) => {
  const { name } = req.params as { name: string };

  const authHeader = req.headers["authorization"];
  const provided = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : undefined;
  const actor = (req.headers["x-actor"] as string) || "agent";

  if (!ACTION_TOKEN || provided !== ACTION_TOKEN) {
    await audit(actor, "soft-clear-interface", name, "denied", "Missing or incorrect action token");
    reply.code(403).send({
      error: "Action requires an approved action token. This action is not self-authorizing.",
    });
    return;
  }

  const device = await findDeviceOrReply(name, reply);
  if (!device) {
    await audit(actor, "soft-clear-interface", name, "error", "Unknown device");
    return;
  }

  const iface = device.interfaces[0];
  if (!iface) {
    await audit(actor, "soft-clear-interface", name, "error", "No interface found for device");
    reply.code(404).send({ error: `No interface found for device: ${name}` });
    return;
  }

  await prisma.interface.update({
    where: { id: iface.id },
    data: { crcErrors24h: 0, resets24h: 0, status: "up" },
  });
  await prisma.counterSample.create({
    data: { interfaceId: iface.id, sampledAt: new Date(), crcErrors: 0 },
  });

  await audit(actor, "soft-clear-interface", name, "success", `${iface.name} counters cleared, interface re-negotiated`);

  return {
    device: device.name,
    interfaceName: iface.name,
    action: "soft-clear-interface",
    result: "Interface cleared and re-negotiated, CRC counters reset",
    performedAt: new Date().toISOString(),
  };
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`network-api listening on ${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
