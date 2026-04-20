/**
 * Import payout lines from Commissions.xlsx "Total Commissions {year}" tabs.
 * Matches Google Apps Script cell lines: `jobNumber - customer - $amount` (newline-separated).
 *
 * Run: npm run import:payouts  (needs DATABASE_URL; workbook at repo root or WORKBOOK_DIR)
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { resolveCommissionsXlsx, workbookRoot } from "./workbook-paths";
import { importTotalCommissionsWideSheet } from "../src/lib/total-commissions-wide-import";

const prisma = new PrismaClient();

async function main() {
  const root = workbookRoot();
  const fp = resolveCommissionsXlsx(root);
  if (!fp || !fs.existsSync(fp)) {
    console.error("Missing commissions.xlsx in:", root);
    process.exit(1);
  }
  const wb = XLSX.readFile(fp);
  const targets = wb.SheetNames.filter((n) => /^Total Commissions\s*\d{4}/i.test(n));
  if (targets.length === 0) {
    console.error("No sheets matching /^Total Commissions \\d{4}/ in", fp, "tabs:", wb.SheetNames.join(", "));
    process.exit(1);
  }

  let upserted = 0;
  for (const sheetName of targets) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" }) as unknown[][];
    const stats = await importTotalCommissionsWideSheet(prisma, rows, sheetName, {});
    upserted += stats.imported;
    console.log("Processed sheet:", sheetName, stats);
  }
  console.log("Done. Upserted payout lines:", upserted);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
