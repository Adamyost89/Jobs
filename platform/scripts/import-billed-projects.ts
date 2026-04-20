/**
 * Import all `*billed*projects*.xlsx` workbooks at repo root (Drew, Brett, James, Mike, …).
 * - Year tabs `2025`, `2026`, … → BilledProjectLine (supplemental tracker per file owner).
 * - Pay tabs `2025 Pay`, `2026 Pay`, … → multiline cells → CommissionPayout (same format as Total Commissions).
 *
 * Run: npm run import:billed-projects
 */
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { PrismaClient, Prisma } from "@prisma/client";
import { globBilledProjectWorkbooks, workbookRoot } from "./workbook-paths";
import { parsePaymentLine } from "../src/lib/parse-payment-line";
import { resolveCommissionStyleColumns, cellNum, cellStr, boolish } from "./header-columns";

const prisma = new PrismaClient();

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function ownerFromBilledFilename(fp: string): string {
  let base = path.basename(fp, path.extname(fp)).replace(/\s*\(\d+\)\s*$/, "").trim();
  const m = base.match(/^(.+?)\s+billed\s+projects$/i);
  if (m) return titleCaseWords(m[1]!.trim());
  const m2 = base.match(/^(.+?)\s+projects\s+billed$/i);
  if (m2) return titleCaseWords(m2[1]!.trim());
  const stripped = base
    .replace(/\s*billed\s*projects.*$/i, "")
    .replace(/\s*projects\s*billed.*$/i, "")
    .trim();
  return titleCaseWords(stripped || "Unknown");
}

async function importYearTab(
  fp: string,
  ownerName: string,
  sheetName: string,
  year: number,
  rows: unknown[][]
) {
  if (rows.length < 2) return { lines: 0, payouts: 0 };
  const cols = resolveCommissionStyleColumns(rows[0]!);
  if (!cols) {
    console.warn("  Skip year tab (no Job # column):", sheetName);
    return { lines: 0, payouts: 0 };
  }
  const sourceFilename = path.basename(fp);
  let lines = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const jobNumber = String(row[cols.job] ?? "").trim();
    if (!jobNumber) continue;
    const job = await prisma.job.findUnique({
      where: { jobNumber },
      select: { id: true },
    });
    await prisma.billedProjectLine.upsert({
      where: {
        sourceFilename_year_jobNumber: { sourceFilename, year, jobNumber },
      },
      create: {
        sourceFilename,
        ownerName,
        sheetName,
        year,
        jobNumber,
        customerName: cellStr(row, cols.name),
        paidInFull: cols.paidFull >= 0 ? boolish(row[cols.paidFull]) : false,
        contractAmount: new Prisma.Decimal(cellNum(row, cols.contract).toFixed(2)),
        changeOrders: new Prisma.Decimal(cellNum(row, cols.changeOrders).toFixed(2)),
        invoicedTotal: new Prisma.Decimal(cellNum(row, cols.invoiced).toFixed(2)),
        amountPaid: new Prisma.Decimal(cellNum(row, cols.amountPaid).toFixed(2)),
        expectedCommission: new Prisma.Decimal(cellNum(row, cols.expectedCommission).toFixed(2)),
        commissionPaid: new Prisma.Decimal(cellNum(row, cols.commissionPaid).toFixed(2)),
        commissionOwed: new Prisma.Decimal(cellNum(row, cols.commissionOwed).toFixed(2)),
        jobId: job?.id ?? null,
      },
      update: {
        ownerName,
        sheetName,
        customerName: cellStr(row, cols.name),
        paidInFull: cols.paidFull >= 0 ? boolish(row[cols.paidFull]) : false,
        contractAmount: new Prisma.Decimal(cellNum(row, cols.contract).toFixed(2)),
        changeOrders: new Prisma.Decimal(cellNum(row, cols.changeOrders).toFixed(2)),
        invoicedTotal: new Prisma.Decimal(cellNum(row, cols.invoiced).toFixed(2)),
        amountPaid: new Prisma.Decimal(cellNum(row, cols.amountPaid).toFixed(2)),
        expectedCommission: new Prisma.Decimal(cellNum(row, cols.expectedCommission).toFixed(2)),
        commissionPaid: new Prisma.Decimal(cellNum(row, cols.commissionPaid).toFixed(2)),
        commissionOwed: new Prisma.Decimal(cellNum(row, cols.commissionOwed).toFixed(2)),
        jobId: job?.id ?? null,
      },
    });
    lines++;
  }
  return { lines, payouts: 0 };
}

async function importPayTab(fp: string, sheetName: string, rows: unknown[][]) {
  if (rows.length < 2) return 0;
  const header = rows[0] as unknown[];
  const payPeriodCol = 0;
  const salespersonHeader = String(header[1] ?? "").trim();
  const spName = titleCaseWords(salespersonHeader || "Unknown");
  const sp = await prisma.salesperson.upsert({
    where: { name: spName },
    create: { name: spName, active: true },
    update: { active: true },
  });

  const sourceFilename = path.basename(fp);
  let payouts = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const payPeriodLabel = String(row[payPeriodCol] ?? "").trim();
    if (!payPeriodLabel || /^pay\s*period/i.test(payPeriodLabel)) continue;
    const cell = String(row[1] ?? "").trim();
    if (!cell) continue;
    const lines = cell.split(/\r?\n/);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const parsed = parsePaymentLine(lines[lineIdx]!);
      if (!parsed) continue;
      const job = await prisma.job.findUnique({
        where: { jobNumber: parsed.jobNumber },
        select: { id: true },
      });
      const importSourceKey = `BP:${sourceFilename}:${sheetName}:r${r}:li${lineIdx}:${parsed.jobNumber}`;
      await prisma.commissionPayout.upsert({
        where: { importSourceKey },
        create: {
          importSourceKey,
          salespersonId: sp.id,
          jobId: job?.id ?? null,
          payPeriodLabel,
          amount: new Prisma.Decimal(parsed.amount.toFixed(2)),
          notes: `import:billed:${sourceFilename} · ${parsed.customer}`,
        },
        update: {
          salespersonId: sp.id,
          jobId: job?.id ?? null,
          payPeriodLabel,
          amount: new Prisma.Decimal(parsed.amount.toFixed(2)),
          notes: `import:billed:${sourceFilename} · ${parsed.customer}`,
        },
      });
      payouts++;
    }
  }
  return payouts;
}

async function importOneFile(fp: string) {
  if (!fs.existsSync(fp)) return;
  const ownerName = ownerFromBilledFilename(fp);
  console.log("File:", path.basename(fp), "→ owner:", ownerName);
  const wb = XLSX.readFile(fp);
  let totalLines = 0;
  let totalPayouts = 0;

  for (const sheetName of wb.SheetNames) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" }) as unknown[][];

    const yOnly = sheetName.match(/^(20\d{2})$/);
    if (yOnly) {
      const year = parseInt(yOnly[1]!, 10);
      const { lines } = await importYearTab(fp, ownerName, sheetName, year, rows);
      totalLines += lines;
      if (lines) console.log(" ", sheetName, "billed rows:", lines);
      continue;
    }

    const yPay = sheetName.match(/^(20\d{2})\s*Pay$/i);
    if (yPay) {
      const n = await importPayTab(fp, sheetName, rows);
      totalPayouts += n;
      if (n) console.log(" ", sheetName, "payout lines:", n);
    }
  }
  console.log("  Totals billed lines:", totalLines, "payout lines:", totalPayouts);
}

async function main() {
  const root = workbookRoot();
  const files = globBilledProjectWorkbooks(root);
  if (files.length === 0) {
    console.warn("No *billed*projects*.xlsx files in:", root);
    return;
  }
  for (const fp of files.sort()) {
    await importOneFile(fp);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
