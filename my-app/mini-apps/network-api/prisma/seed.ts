import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.counterSample.deleteMany();
  await prisma.macEntry.deleteMany();
  await prisma.logLine.deleteMany();
  await prisma.flapEvent.deleteMany();
  await prisma.interface.deleteMany();
  await prisma.device.deleteMany();
  await prisma.knownIssue.deleteMany();

  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);
  const hoursAgo = (n: number) => new Date(now - n * 60 * 60 * 1000);

  // --- Hero device: the one the flagship story is about ---
  const heroDevice = await prisma.device.create({
    data: { name: "edge-rtr-04", model: "Cisco ASR-9010", firmwareVersion: "15.2(4)S3" },
  });

  const heroInterface = await prisma.interface.create({
    data: {
      deviceId: heroDevice.id,
      name: "GigabitEthernet0/1",
      crcErrors24h: 842,
      resets24h: 6,
      status: "up",
    },
  });

  const crcTrend = [4, 22, 96, 310, 588, 842];
  for (let i = 0; i < crcTrend.length; i++) {
    await prisma.counterSample.create({
      data: {
        interfaceId: heroInterface.id,
        sampledAt: hoursAgo((crcTrend.length - i) * 4),
        crcErrors: crcTrend[i],
      },
    });
  }

  const flapNotes = [
    "CRC error burst preceded BGP session drop",
    "Interface flap, session recovered after 40s",
    "CRC error burst preceded BGP session drop",
    "Interface flap, session recovered after 25s",
    "CRC error burst preceded BGP session drop",
    "Interface flap, session recovered after 55s",
  ];
  for (let i = 0; i < flapNotes.length; i++) {
    await prisma.flapEvent.create({
      data: {
        deviceId: heroDevice.id,
        interfaceName: "GigabitEthernet0/1",
        occurredAt: daysAgo(9 - i * 1.5),
        note: flapNotes[i],
      },
    });
  }

  await prisma.logLine.createMany({
    data: [
      { deviceId: heroDevice.id, loggedAt: hoursAgo(20), text: "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(20), text: "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(19.98), text: "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(19.97), text: "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to up" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(6), text: "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(6), text: "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(5.98), text: "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up" },
      { deviceId: heroDevice.id, loggedAt: hoursAgo(1), text: "%TRANSCEIVER-3-CRC_ERR: GigabitEthernet0/1 transceiver reporting elevated CRC error rate" },
    ],
  });

  await prisma.macEntry.createMany({
    data: [
      { deviceId: heroDevice.id, interfaceName: "GigabitEthernet0/1", macAddress: "00:1a:2b:3c:4d:01", vlan: 100, learnedAt: hoursAgo(48) },
      { deviceId: heroDevice.id, interfaceName: "GigabitEthernet0/1", macAddress: "00:1a:2b:3c:4d:02", vlan: 100, learnedAt: hoursAgo(30) },
    ],
  });

  // --- Baseline devices: healthy, browsable, different firmware, should NOT match the known issue ---
  const coreSwitch = await prisma.device.create({
    data: { name: "core-sw-01", model: "Cisco Nexus 9300", firmwareVersion: "9.3(8)" },
  });
  const coreInterface = await prisma.interface.create({
    data: { deviceId: coreSwitch.id, name: "TenGigabitEthernet0/1", crcErrors24h: 3, resets24h: 0, status: "up" },
  });
  await prisma.counterSample.createMany({
    data: [0, 1, 1, 2, 3, 3].map((v, i) => ({ interfaceId: coreInterface.id, sampledAt: hoursAgo((6 - i) * 4), crcErrors: v })),
  });
  await prisma.macEntry.create({
    data: { deviceId: coreSwitch.id, interfaceName: "TenGigabitEthernet0/1", macAddress: "00:1a:2b:3c:4d:10", vlan: 200, learnedAt: hoursAgo(200) },
  });

  const edgeRtr09 = await prisma.device.create({
    data: { name: "edge-rtr-09", model: "Cisco ASR-9010", firmwareVersion: "15.2(4)S6" },
  });
  const edge09Interface = await prisma.interface.create({
    data: { deviceId: edgeRtr09.id, name: "GigabitEthernet0/2", crcErrors24h: 0, resets24h: 0, status: "up" },
  });
  await prisma.counterSample.createMany({
    data: [0, 0, 0, 0, 0, 0].map((v, i) => ({ interfaceId: edge09Interface.id, sampledAt: hoursAgo((6 - i) * 4), crcErrors: v })),
  });
  await prisma.flapEvent.create({
    data: {
      deviceId: edgeRtr09.id,
      interfaceName: "GigabitEthernet0/2",
      occurredAt: hoursAgo(6),
      note: "Routine maintenance window, planned, no impact",
    },
  });

  // --- Known issues knowledge base ---
  await prisma.knownIssue.create({
    data: {
      issueRef: "NX-2024-0142",
      matchModel: "Cisco ASR-9010",
      matchFirmwareRange: "15.2(4)S1 - 15.2(4)S4",
      affectedVersions: "15.2(4)S1,15.2(4)S2,15.2(4)S3,15.2(4)S4",
      symptom: "Intermittent CRC errors and link flaps on GigabitEthernet ports under sustained traffic, not caused by physical cabling or switching loops",
      rootCause: "Transceiver auto-negotiation firmware defect present in the affected release range",
      fixedInVersion: "15.2(4)S6",
      recommendedAction: "Soft-clear the affected interface as an interim fix, and schedule a firmware upgrade to 15.2(4)S6 to permanently resolve",
    },
  });

  console.log(
    "Seeded 3 devices (edge-rtr-04 hero with a known-issue match, core-sw-01, edge-rtr-09) and 1 known issue.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
