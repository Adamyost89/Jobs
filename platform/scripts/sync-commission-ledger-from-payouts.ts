/**
 * Set Commission.paidAmount / owedAmount from posted checks + existing ledger math
 * (`commissionDisplayAmounts`) so reports and HR totals match check history.
 *
 * Run: npm run sync:commission-ledger-from-payouts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { commissionDisplayAmounts } from "../src/lib/commission-display";

const prisma = new PrismaClient();

async function main() {
  const commissions = await prisma.commission.findMany({
    where: { override: false },
    select: {
      id: true,
      jobId: true,
      salespersonId: true,
      paidAmount: true,
      owedAmount: true,
      salesperson: { select: { active: true } },
    },
  });

  const sums = await prisma.commissionPayout.groupBy({
    by: ["jobId", "salespersonId"],
    where: { jobId: { not: null } },
    _sum: { amount: true },
  });
  const sumMap = new Map<string, number>();
  for (const g of sums) {
    if (!g.jobId) continue;
    sumMap.set(`${g.jobId}|${g.salespersonId}`, g._sum.amount?.toNumber() ?? 0);
  }

  let updated = 0;
  for (const c of commissions) {
    const key = `${c.jobId}|${c.salespersonId}`;
    const payoutSum = sumMap.get(key) ?? 0;
    const { displayPaid, displayOwed } = commissionDisplayAmounts(
      c.paidAmount.toNumber(),
      c.owedAmount.toNumber(),
      payoutSum,
      c.salesperson.active
    );
    const lp = c.paidAmount.toNumber();
    const lo = c.owedAmount.toNumber();
    if (Math.abs(lp - displayPaid) < 0.02 && Math.abs(lo - displayOwed) < 0.02) continue;

    await prisma.commission.update({
      where: { id: c.id },
      data: {
        paidAmount: new Prisma.Decimal(displayPaid.toFixed(2)),
        owedAmount: new Prisma.Decimal(displayOwed.toFixed(2)),
      },
    });
    updated++;
  }
  console.log("Commission rows updated to match payout totals:", updated, "of", commissions.length, "scanned");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
