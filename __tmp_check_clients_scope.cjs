const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const date = process.argv[2] || "2026-05-13";
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const runs = await prisma.analysisRun.findMany({
    where: { dateRef: dayStart, status: "completed" },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { id: true, dateRef: true, startedAt: true, tenantId: true, channelId: true }
  });

  if (!runs.length) {
    console.log(JSON.stringify({ date, runs: 0 }, null, 2));
    return;
  }

  const run = runs[0];

  const dayRecords = await prisma.clientRecord.findMany({
    where: { runId: run.id },
    select: { phonePk: true, contactName: true, updatedAt: true }
  });

  const statesAll = await prisma.clientState.findMany({
    where: { tenantId: run.tenantId, channelId: run.channelId },
    select: { phonePk: true, contactName: true, lastSeenAt: true, updatedAt: true }
  });

  const statesDateWindow = statesAll.filter((s) => s.lastSeenAt >= dayStart && s.lastSeenAt <= dayEnd);

  const daySet = new Set(dayRecords.map((r) => r.phonePk));
  const overallSet = new Set(statesAll.map((r) => r.phonePk));

  const onlyOverall = [...overallSet].filter((pk) => !daySet.has(pk)).slice(0, 30);
  const onlyDay = [...daySet].filter((pk) => !overallSet.has(pk)).slice(0, 30);

  console.log(JSON.stringify({
    date,
    selectedRun: run,
    counts: {
      dayClientRecords: dayRecords.length,
      overallClientStates: statesAll.length,
      overallWithinDateByLastSeenAt: statesDateWindow.length,
      onlyInOverallNotInDay: onlyOverall.length,
      onlyInDayNotInOverall: onlyDay.length
    },
    samples: {
      onlyInOverallNotInDay: onlyOverall,
      onlyInDayNotInOverall: onlyDay
    }
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
