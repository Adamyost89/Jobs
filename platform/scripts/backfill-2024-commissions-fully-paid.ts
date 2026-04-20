/**
 * One-time / idempotent: for every non-override Commission on a 2024 job, set
 * paidAmount = paidAmount + owedAmount and owedAmount = 0 (assume 2024 fully paid).
 *
 * Re-importing (`npm run import:commission-data` and person sheets) applies the same rule.
 *
 * Run: npm run backfill:2024-commissions-paid
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeImportedCommissionAmounts } from "../src/lib/commission-import-policy";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.commission.findMany({
    where: { override: false, job: { year: 2024 } },
    select: { id: true, paidAmount: true, owedAmount: true },
  });
  let n = 0;
  for (const c of rows) {
    const paid = c.paidAmount.toNumber();
    const owed = c.owedAmount.toNumber();
    const { paid: newPaid, owed: newOwed } = normalizeImportedCommissionAmounts(2024, paid, owed);
    if (newPaid === paid && newOwed === owed) continue;
    await prisma.commission.update({
      where: { id: c.id },
      data: {
        paidAmount: new Prisma.Decimal(newPaid.toFixed(2)),
        owedAmount: new Prisma.Decimal(newOwed.toFixed(2)),
      },
    });
    n++;
  }
  console.log("Updated 2024 commission rows (paid folded, owed cleared):", n, "of", rows.length, "scanned");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
