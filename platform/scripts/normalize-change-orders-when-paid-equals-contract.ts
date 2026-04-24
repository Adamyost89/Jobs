/**
 * Normalize bad Change Orders data:
 * when Amount Paid equals Contract Amount, Change Orders should be 0.
 *
 * Run:
 *   npx tsx scripts/normalize-change-orders-when-paid-equals-contract.ts
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const EPSILON = 0.005;

function money(n: Prisma.Decimal | null): number | null {
  return n == null ? null : n.toNumber();
}

async function main() {
  const rows = await prisma.job.findMany({
    where: {
      amountPaid: { not: null },
      NOT: { changeOrders: { equals: 0 } },
    },
    select: {
      id: true,
      jobNumber: true,
      contractAmount: true,
      amountPaid: true,
      changeOrders: true,
    },
    take: 20_000,
  });

  const matches = rows.filter((row) => {
    const paid = money(row.amountPaid);
    const contract = row.contractAmount.toNumber();
    const changeOrders = row.changeOrders.toNumber();
    if (paid == null) return false;
    return Math.abs(paid - contract) <= EPSILON && Math.abs(changeOrders) > EPSILON;
  });

  if (matches.length === 0) {
    console.log("No jobs needed normalization.");
    return;
  }

  const ids = matches.map((m) => m.id);
  const res = await prisma.job.updateMany({
    where: { id: { in: ids } },
    data: { changeOrders: new Prisma.Decimal("0") },
  });

  console.log(`Normalized ${res.count} jobs (changeOrders -> 0).`);
  console.log("Sample:");
  for (const row of matches.slice(0, 15)) {
    console.log(
      `${row.jobNumber}: contract=${row.contractAmount.toNumber().toFixed(2)} paid=${money(row.amountPaid)?.toFixed(2)} changeOrders=${row.changeOrders.toNumber().toFixed(2)}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
