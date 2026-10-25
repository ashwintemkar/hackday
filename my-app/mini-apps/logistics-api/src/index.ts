import "dotenv/config";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { dashboardHtml } from "./dashboard.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const ACTION_TOKEN = process.env.LOGISTICS_API_ACTION_TOKEN;
const PORT = Number(process.env.PORT ?? 4003);
const COORDINATOR_NAME = "Rajesh K";

async function audit(actor: string, action: string, target: string, outcome: string, detail?: string) {
  await prisma.auditLog.create({ data: { actor, action, target, outcome, detail } });
}

async function findPoOrReply(poNumber: string, reply: any) {
  const po = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: { shipment: true } });
  if (!po) {
    reply.code(404).send({ error: `Unknown purchase order: ${poNumber}` });
    return null;
  }
  return po;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(dashboardHtml);
});

app.get("/api/purchase-orders", async () => {
  const pos = await prisma.purchaseOrder.findMany({ include: { shipment: true } });
  return {
    purchaseOrders: pos.map((p) => ({
      poNumber: p.poNumber,
      description: p.description,
      status: p.status,
      carrierStatus: p.shipment?.carrierStatus ?? "unknown",
    })),
  };
});

app.get("/api/overview", async (req, reply) => {
  const { poNumber } = req.query as { poNumber?: string };
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber: poNumber || "PO-55210" },
    include: { shipment: true },
  });
  if (!po) {
    reply.code(404).send({ error: `Unknown purchase order: ${poNumber}` });
    return;
  }
  const auditLog = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 });
  return { po, auditLog, coordinator: COORDINATOR_NAME };
});

app.get("/purchase-orders/:poNumber", async (req, reply) => {
  const { poNumber } = req.params as { poNumber: string };
  const po = await findPoOrReply(poNumber, reply);
  if (!po) return;
  return {
    poNumber: po.poNumber,
    description: po.description,
    quantity: po.quantity,
    unit: po.unit,
    expectedDate: po.expectedDate,
    status: po.status,
  };
});

app.get("/shipments/:poNumber/carrier-status", async (req, reply) => {
  const { poNumber } = req.params as { poNumber: string };
  const po = await findPoOrReply(poNumber, reply);
  if (!po) return;
  if (!po.shipment) {
    reply.code(404).send({ error: `No shipment linked to ${poNumber}` });
    return;
  }
  return {
    poNumber: po.poNumber,
    carrierStatus: po.shipment.carrierStatus,
    heldSince: po.shipment.heldSince,
    releaseTimeKnown: po.shipment.releaseTimeKnown,
    notes: po.shipment.notes,
  };
});

app.get("/audit-log", async () => {
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return { entries };
});

app.post("/purchase-orders/:poNumber/escalate", async (req, reply) => {
  const { poNumber } = req.params as { poNumber: string };
  const authHeader = req.headers["authorization"];
  const provided = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : undefined;
  const actor = (req.headers["x-actor"] as string) || "agent";

  if (!ACTION_TOKEN || provided !== ACTION_TOKEN) {
    await audit(actor, "escalate", poNumber, "denied", "Missing or incorrect action token");
    reply.code(403).send({ error: "Action requires an approved action token. This action is not self-authorizing." });
    return;
  }

  const po = await findPoOrReply(poNumber, reply);
  if (!po) {
    await audit(actor, "escalate", poNumber, "error", "Unknown purchase order");
    return;
  }

  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "escalated" } });
  await audit(actor, "escalate", poNumber, "success", `Logistics coordinator ${COORDINATOR_NAME} notified`);

  return {
    poNumber: po.poNumber,
    action: "escalate",
    status: "escalated",
    notified: COORDINATOR_NAME,
    performedAt: new Date().toISOString(),
  };
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`logistics-api listening on ${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
