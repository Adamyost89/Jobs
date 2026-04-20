/**
 * Captures EVERY tab from EVERY .xlsx at repo root into SpreadsheetSnapshot (lossless JSON rows).
 * Run FIRST so nothing lives only in Excel.
 *
 * Run: npm run import:xlsx-snapshots
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { PrismaClient, Prisma } from "@prisma/client";
import { globAllXlsxWorkbooks, workbookRoot } from "./workbook-paths";
import { workbookKeyFromPath } from "./workbook-key";

const prisma = new PrismaClient();

function jsonRows(rows: unknown[][]): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(rows, (_, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "[]"
  ) as Prisma.InputJsonValue;
}

async function snapshotWorkbook(fp: string) {
  const wbKey = workbookKeyFromPath(fp);
  const wb = XLSX.readFile(fp);
  for (const sheetName of wb.SheetNames) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: null }) as unknown[][];
    const rowCount = rows.length;
    const colCount = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    await prisma.spreadsheetSnapshot.upsert({
      where: {
        workbookKey_sheetName: { workbookKey: wbKey, sheetName },
      },
      create: {
        workbookKey: wbKey,
        sheetName,
        rowCount,
        colCount,
        rows: jsonRows(rows),
      },
      update: {
        rowCount,
        colCount,
        rows: jsonRows(rows),
      },
    });
  }
  console.log("Snapshotted:", wbKey, wb.SheetNames.length, "sheets");
}

async function main() {
  const root = workbookRoot();
  const files = globAllXlsxWorkbooks(root);
  if (files.length === 0) {
    console.warn("No .xlsx files in:", root);
    return;
  }
  for (const fp of files.sort()) {
    await snapshotWorkbook(fp);
  }
  console.log("Done. Files:", files.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
