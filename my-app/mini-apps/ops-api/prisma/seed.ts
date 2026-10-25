import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.pod.deleteMany();
  await prisma.deploymentEvent.deleteMany();

  const now = Date.now();
  const hoursAgo = (n: number) => new Date(now - n * 60 * 60 * 1000);

  // --- Hero pod: the degraded one the demo story is about ---
  await prisma.pod.create({
    data: {
      name: "checkout-api-7f9c-2",
      service: "checkout-api",
      memoryPercent: 94,
      cpuPercent: 22,
      status: "degraded",
    },
  });

  await prisma.deploymentEvent.create({
    data: { service: "checkout-api", version: "4.12.0", deployedAt: hoursAgo(7) },
  });
  await prisma.deploymentEvent.create({
    data: { service: "checkout-api", version: "4.11.0", deployedAt: hoursAgo(24 * 12) },
  });

  // --- Baseline pods: healthy, browsable, not part of the flagged story ---
  await prisma.pod.create({
    data: {
      name: "checkout-api-7f9c-1",
      service: "checkout-api",
      memoryPercent: 31,
      cpuPercent: 19,
      status: "healthy",
    },
  });

  await prisma.pod.create({
    data: {
      name: "auth-api-4b2d-1",
      service: "auth-api",
      memoryPercent: 28,
      cpuPercent: 11,
      status: "healthy",
    },
  });
  await prisma.deploymentEvent.create({
    data: { service: "auth-api", version: "2.3.1", deployedAt: hoursAgo(24 * 20) },
  });

  console.log("Seeded 3 pods: checkout-api-7f9c-2 (hero, degraded), checkout-api-7f9c-1, auth-api-4b2d-1.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
