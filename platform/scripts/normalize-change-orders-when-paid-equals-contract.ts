/**
 * Reconcile Change Orders:
 * invoicedTotal - contractAmount (positives always; negatives only when paid / paid & closed).
 *
 * Run:
 *   npx tsx scripts/normalize-change-orders-when-paid-equals-contract.ts
 */
import { PrismaClient } from "@prisma/client";
import { reconcileChangeOrdersFromPaidAndContract } from "../src/lib/job-change-order-normalization";

const prisma = new PrismaClient();

async function main() {
  const { scanned, matched, updated } = await reconcileChangeOrdersFromPaidAndContract(prisma);
  if (matched === 0) {
    console.log("No jobs needed change-order reconciliation.");
    return;
  }
  console.log(`Reconciled ${updated} jobs (matched ${matched}, scanned ${scanned}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
