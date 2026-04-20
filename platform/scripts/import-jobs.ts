/**
 * Import jobs from Job Numbering xlsx tabs 2024, 2025, 2026.
 * Supports two header layouts (see `src/lib/job-sheet-import.ts`).
 *
 * Run: npm run import:jobs  (needs DATABASE_URL in .env)
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { importJobBookTab, sheetToRows } from "../src/lib/job-sheet-import";
import { workbookRoot, resolveJobNumberingXlsx } from "./workbook-paths";

const prisma = new PrismaClient();
const root = workbookRoot();
const fp = resolveJobNumberingXlsx(root);

async function main() {
  if (!fp || !fs.existsSync(fp)) {
    console.error(
      "Missing Job Numbering workbook in:",
      root,
      "\nExpected something like Job Numbering.xlsx or Job Numbering(1).xlsx"
    );
    process.exit(1);
  }
  console.log("Using workbook:", fp);
  const wb = XLSX.readFile(fp, { cellDates: true, cellNF: false, cellText: false });
  for (const yearTab of ["2024", "2025", "2026"]) {
    if (!wb.SheetNames.includes(yearTab)) {
      console.warn("Skip missing tab:", yearTab);
      continue;
    }
    const sh = wb.Sheets[yearTab];
    const rows = sheetToRows(sh);
    const year = parseInt(yearTab, 10);
    console.log("Importing", yearTab, "raw rows:", rows.length);
    const r = await importJobBookTab(prisma, rows, {
      bookYear: year,
      headerMode: "auto",
    });
    console.log(
      yearTab,
      r.layout,
      "headerRow:",
      r.headerRowUsed,
      "imported:",
      r.imported,
      "skippedNoLead:",
      r.skippedNoLead,
      "contractSignedAt set:",
      r.signedAtOk,
      "missing:",
      r.signedAtMissing
    );
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
