/**
 * Remove pre-assigned "shell" jobs (no lead, name, rep, money, UNKNOWN) that have no commissions.
 * Safe to re-run. Re-import jobs after pruning so FKs stay consistent.
 *
 * Run: npm run prune:shell-jobs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const res = await prisma.job.deleteMany({
    where: {
      status: "UNKNOWN",
      leadNumber: null,
      salespersonId: null,
      contractAmount: { equals: 0 },
      invoicedTotal: { equals: 0 },
      changeOrders: { equals: 0 },
      projectRevenue: { equals: 0 },
      OR: [{ name: null }, { name: "" }],
      commissions: { none: {} },
    },
  });
  console.log("Deleted shell jobs (no commission rows):", res.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
