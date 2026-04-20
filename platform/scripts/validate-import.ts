/**
 * Post-import validation gates (prints JSON report, exit 1 on hard fails).
 * Run: npx tsx scripts/validate-import.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dupRows = await prisma.$queryRaw<{ jobNumber: string; c: bigint }[]>`
    SELECT "jobNumber", COUNT(*)::bigint as c
    FROM "Job"
    GROUP BY "jobNumber"
    HAVING COUNT(*) > 1
  `;

  const jobsMissingSp = await prisma.job.count({
    where: {
      contractAmount: { gt: 0 },
      salespersonId: null,
    },
  });

  const commissionMismatch = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "Commission" c
    JOIN "Job" j ON j.id = c."jobId"
    WHERE c."override" = false
      AND c."owedAmount" < 0
  `;

  let billedProjectLinesWithoutLinkedJob: number | null = null;
  try {
    billedProjectLinesWithoutLinkedJob = await prisma.billedProjectLine.count({
      where: { jobId: null },
    });
  } catch {
    billedProjectLinesWithoutLinkedJob = null;
  }

  let spreadsheetSnapshotSheets: number | null = null;
  try {
    spreadsheetSnapshotSheets = await prisma.spreadsheetSnapshot.count();
  } catch {
    spreadsheetSnapshotSheets = null;
  }

  const jobsByYear = await prisma.job.groupBy({
    by: ["year"],
    _count: { _all: true },
    _sum: { contractAmount: true, gp: true },
  });
  const jobYearRollup = jobsByYear
    .map((g) => ({
      year: g.year,
      jobCount: g._count._all,
      sumContract: g._sum.contractAmount?.toNumber() ?? 0,
      sumGp: g._sum.gp?.toNumber() ?? 0,
    }))
    .sort((a, b) => a.year - b.year);

  const signedBookMissingContractSignedAt = await prisma.job.count({
    where: {
      salespersonId: { not: null },
      contractAmount: { gt: 0 },
      contractSignedAt: null,
    },
  });

  const signedBookMissingContractSignedByYear = await prisma.job.groupBy({
    by: ["year"],
    where: {
      salespersonId: { not: null },
      contractAmount: { gt: 0 },
      contractSignedAt: null,
    },
    _count: { _all: true },
  });

  const prolineJobsMissingSignedDate = await prisma.job.count({
    where: {
      salespersonId: { not: null },
      contractAmount: { gt: 0 },
      contractSignedAt: null,
      prolineJobId: { not: null },
    },
  });

  const report = {
    duplicateJobNumberGroups: dupRows.map((r) => ({ jobNumber: r.jobNumber, count: Number(r.c) })),
    jobsWithContractButNoSalesperson: jobsMissingSp,
    negativeOwedCommissions: commissionMismatch.length,
    billedProjectLinesWithoutLinkedJob,
    spreadsheetSnapshotSheets,
    jobYearRollup,
    signedBookMissingContractSignedAt,
    signedBookMissingContractSignedByYear: signedBookMissingContractSignedByYear
      .map((g) => ({ year: g.year, count: g._count._all }))
      .sort((a, b) => a.year - b.year),
    prolineJobsMissingSignedDate,
    hardFail: dupRows.length > 0 || commissionMismatch.length > 0,
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.hardFail) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
