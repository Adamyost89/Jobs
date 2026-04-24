/**
 * Normalize bad Change Orders data:
 * when Amount Paid equals Contract Amount, Change Orders should be 0.
 *
 * Run:
 *   npx tsx scripts/normalize-change-orders-when-paid-equals-contract.ts
 */
import { PrismaClient } from "@prisma/client";
import { normalizeChangeOrdersWhenPaidMatchesContract } from "../src/lib/job-change-order-normalization";

const prisma = new PrismaClient();

async function main() {
  const { scanned, matched, updated } = await normalizeChangeOrdersWhenPaidMatchesContract(prisma);
  if (matched === 0) {
    console.log("No jobs needed normalization.");
    return;
  }
  console.log(`Normalized ${updated} jobs (matched ${matched}, scanned ${scanned}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
