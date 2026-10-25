import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.shipment.deleteMany();
  await prisma.purchaseOrder.deleteMany();

  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);

  // --- Hero PO: held at customs, no known release time ---
  const heroPo = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-55210",
      description: "Crude barrel delivery",
      quantity: 400,
      unit: "barrels",
      expectedDate: daysAgo(2),
      status: "in_transit",
    },
  });
  await prisma.shipment.create({
    data: {
      poId: heroPo.id,
      carrierStatus: "held_at_customs",
      heldSince: daysAgo(3),
      releaseTimeKnown: false,
      notes: "No confirmed release time in the carrier system.",
    },
  });

  // --- Baseline POs: normal, on schedule, browsable ---
  const deliveredPo = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-55301",
      description: "Refined diesel top-up",
      quantity: 250,
      unit: "barrels",
      expectedDate: daysAgo(5),
      status: "delivered",
    },
  });
  await prisma.shipment.create({
    data: {
      poId: deliveredPo.id,
      carrierStatus: "delivered",
      heldSince: null,
      releaseTimeKnown: true,
      notes: "Delivered on schedule, no issues.",
    },
  });

  const onTimePo = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-55402",
      description: "Lubricant restock",
      quantity: 120,
      unit: "drums",
      expectedDate: daysFromNow(3),
      status: "in_transit",
    },
  });
  await prisma.shipment.create({
    data: {
      poId: onTimePo.id,
      carrierStatus: "in_transit",
      heldSince: null,
      releaseTimeKnown: true,
      notes: "On schedule, ETA confirmed by carrier.",
    },
  });

  console.log("Seeded 3 purchase orders: PO-55210 (hero, held), PO-55301 (delivered), PO-55402 (on time).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
