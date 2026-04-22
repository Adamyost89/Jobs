/**
 * Set Commission.paidAmount / owedAmount from posted checks + existing ledger math
 * (`commissionDisplayAmounts`) so reports and HR totals match check history.
 *
 * Run: npm run sync:commission-ledger-from-payouts
 */
import { PrismaClient } from "@prisma/client";
import { syncCommissionLedgerFromPayouts } from "../src/lib/commission-ledger-sync";

const prisma = new PrismaClient();

async function main() {
  const { scanned, updated } = await syncCommissionLedgerFromPayouts(prisma);
  console.log("Commission rows updated to match payout totals:", updated, "of", scanned, "scanned");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
