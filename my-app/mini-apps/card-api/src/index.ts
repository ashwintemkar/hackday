import "dotenv/config";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { dashboardHtml } from "./dashboard.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const ACTION_TOKEN = process.env.CARD_API_ACTION_TOKEN;
const PORT = Number(process.env.PORT ?? 4002);

async function audit(actor: string, action: string, target: string, outcome: string, detail?: string) {
  await prisma.auditLog.create({ data: { actor, action, target, outcome, detail } });
}

async function findCardOrReply(last4: string, reply: any) {
  const card = await prisma.card.findFirst({ where: { last4 } });
  if (!card) {
    reply.code(404).send({ error: `Unknown card: ${last4}` });
    return null;
  }
  return card;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(dashboardHtml);
});

app.get("/api/cards", async () => {
  const cards = await prisma.card.findMany({ include: { transactions: true } });
  return {
    cards: cards.map((c) => ({
      last4: c.last4,
      cardholderName: c.cardholderName,
      status: c.status,
      transactionCount: c.transactions.length,
    })),
  };
});

app.get("/api/overview", async (req, reply) => {
  const { last4 } = req.query as { last4?: string };
  const card = await prisma.card.findFirst({
    where: { last4: last4 || "7734" },
    include: {
      transactions: { orderBy: { occurredAt: "desc" } },
      knownDevices: true,
    },
  });
  if (!card) {
    reply.code(404).send({ error: `Unknown card: ${last4}` });
    return;
  }
  const merchants = await prisma.merchant.findMany();
  const auditLog = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 });
  return { card, merchants, auditLog };
});

app.get("/cards/:last4/transactions", async (req, reply) => {
  const { last4 } = req.params as { last4: string };
  const card = await findCardOrReply(last4, reply);
  if (!card) return;

  const transactions = await prisma.transaction.findMany({
    where: { cardId: card.id },
    orderBy: { occurredAt: "desc" },
  });
  return {
    card: card.last4,
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: t.amount,
      merchantName: t.merchantName,
      merchantLocation: t.merchantLocation,
      occurredAt: t.occurredAt,
      deviceFingerprint: t.deviceFingerprint,
    })),
  };
});

app.get("/accounts/:last4/device-history", async (req, reply) => {
  const { last4 } = req.params as { last4: string };
  const card = await findCardOrReply(last4, reply);
  if (!card) return;

  const devices = await prisma.knownDevice.findMany({ where: { cardId: card.id } });
  return {
    card: card.last4,
    knownDevices: devices.map((d) => ({ fingerprint: d.fingerprint, firstSeenAt: d.firstSeenAt })),
  };
});

app.get("/merchants/:name/risk-score", async (req, reply) => {
  const { name } = req.params as { name: string };
  const merchant = await prisma.merchant.findUnique({ where: { name } });
  if (!merchant) {
    reply.code(404).send({ error: `Unknown merchant: ${name}` });
    return;
  }
  return {
    merchant: merchant.name,
    chargebackRatePct: merchant.chargebackRatePct,
    riskLevel: merchant.riskLevel,
  };
});

app.get("/audit-log", async () => {
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return { entries };
});

async function setCardStatus(req: any, reply: any, targetStatus: "blocked" | "active", actionName: string) {
  const { last4 } = req.params as { last4: string };
  const authHeader = req.headers["authorization"];
  const provided = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : undefined;
  const actor = (req.headers["x-actor"] as string) || "agent";

  if (!ACTION_TOKEN || provided !== ACTION_TOKEN) {
    await audit(actor, actionName, last4, "denied", "Missing or incorrect action token");
    reply.code(403).send({ error: "Action requires an approved action token. This action is not self-authorizing." });
    return;
  }

  const card = await findCardOrReply(last4, reply);
  if (!card) {
    await audit(actor, actionName, last4, "error", "Unknown card");
    return;
  }

  await prisma.card.update({ where: { id: card.id }, data: { status: targetStatus } });
  await audit(actor, actionName, last4, "success", `Card status set to ${targetStatus}`);

  return {
    card: card.last4,
    action: actionName,
    status: targetStatus,
    performedAt: new Date().toISOString(),
  };
}

app.post("/cards/:last4/block", async (req, reply) => {
  const result = await setCardStatus(req, reply, "blocked", "block-card");
  if (result) return result;
});

app.post("/cards/:last4/unblock", async (req, reply) => {
  const result = await setCardStatus(req, reply, "active", "unblock-card");
  if (result) return result;
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`card-api listening on ${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
