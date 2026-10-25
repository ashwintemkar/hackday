import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.transaction.deleteMany();
  await prisma.knownDevice.deleteMany();
  await prisma.card.deleteMany();
  await prisma.merchant.deleteMany();

  const now = Date.now();
  const minutesAgo = (n: number) => new Date(now - n * 60 * 1000);
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  // --- Hero card: the flagged fraud investigation ---
  const heroCard = await prisma.card.create({
    data: { last4: "7734", cardholderName: "D. Okafor", status: "active" },
  });

  await prisma.knownDevice.create({
    data: { cardId: heroCard.id, fingerprint: "device-a1b2-known", firstSeenAt: minutesAgo(60 * 24 * 90) },
  });

  await prisma.transaction.create({
    data: {
      cardId: heroCard.id,
      amount: 42.5,
      merchantName: "Cafe Nine",
      merchantLocation: "Austin, TX, USA",
      occurredAt: minutesAgo(40),
      deviceFingerprint: "device-a1b2-known",
    },
  });

  await prisma.transaction.create({
    data: {
      cardId: heroCard.id,
      amount: 1240.0,
      merchantName: "TechZone Electronics",
      merchantLocation: "Singapore",
      occurredAt: minutesAgo(0),
      deviceFingerprint: "device-f9e8-unseen",
    },
  });

  await prisma.merchant.create({
    data: { name: "TechZone Electronics", chargebackRatePct: 4.8, riskLevel: "elevated" },
  });

  // --- Baseline cards: normal, unflagged, browsable activity ---
  const cardAlvarez = await prisma.card.create({
    data: { last4: "2291", cardholderName: "J. Alvarez", status: "active" },
  });
  await prisma.knownDevice.create({
    data: { cardId: cardAlvarez.id, fingerprint: "device-c3d4-known", firstSeenAt: daysAgo(210) },
  });
  await prisma.transaction.create({
    data: {
      cardId: cardAlvarez.id,
      amount: 18.2,
      merchantName: "Greenline Grocers",
      merchantLocation: "Denver, CO, USA",
      occurredAt: minutesAgo(90),
      deviceFingerprint: "device-c3d4-known",
    },
  });
  await prisma.transaction.create({
    data: {
      cardId: cardAlvarez.id,
      amount: 64.0,
      merchantName: "Metro Transit",
      merchantLocation: "Denver, CO, USA",
      occurredAt: daysAgo(1),
      deviceFingerprint: "device-c3d4-known",
    },
  });

  const cardChen = await prisma.card.create({
    data: { last4: "8850", cardholderName: "M. Chen", status: "active" },
  });
  await prisma.knownDevice.create({
    data: { cardId: cardChen.id, fingerprint: "device-e5f6-known", firstSeenAt: daysAgo(340) },
  });
  await prisma.transaction.create({
    data: {
      cardId: cardChen.id,
      amount: 129.99,
      merchantName: "Northgate Electronics",
      merchantLocation: "Seattle, WA, USA",
      occurredAt: daysAgo(2),
      deviceFingerprint: "device-e5f6-known",
    },
  });

  console.log("Seeded 3 cards: 7734 (hero, flagged), 2291, 8850.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
