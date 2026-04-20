/**
 * Import per-salesperson commission tabs from commissions.xlsx (e.g. Brett 2026, James 2025, Mike 2026).
 * Upserts Commission.paidAmount / owedAmount for existing jobs (run import:jobs first).
 *
 * Year policy (by Job.year): 2024 → paid += owed, owed = 0. 2025/2026 → exact sheet paid/owed.
 *
 * Run: npm run import:commission-sheets
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { PrismaClient, Prisma } from "@prisma/client";
import { resolveCommissionsXlsx, workbookRoot } from "./workbook-paths";
import { resolveCommissionStyleColumns, cellNum } from "./header-columns";
import { normalizeImportedCommissionAmounts } from "../src/lib/commission-import-policy";

const prisma = new PrismaClient();

async function assertImportsAllowedAfterCutover() {
  const cfg = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
  const allowOverride = process.env.ALLOW_IMPORTS_AFTER_CUTOVER === "1";
  if (cfg?.cutoverComplete && !allowOverride) {
    throw new Error(
      "Cutover is complete; commission imports are blocked to protect app-managed commission balances. " +
        "Set ALLOW_IMPORTS_AFTER_CUTOVER=1 only for intentional backfills."
    );
  }
}

const SKIP = /^commission data$/i;
const PERSON_YEAR = /^(.+?)\s+(20\d{2})$/;

function looksLikeJobNumber(s: string): boolean {
  return /^\d{8}/.test(s) || /^202[4-9]/.test(s);
}

function detectCommissionHeaderRow(
  rows: unknown[][]
): { headerRow0Based: number; cols: NonNullable<ReturnType<typeof resolveCommissionStyleColumns>> } | null {
  const maxScan = Math.min(rows.length, 40);
  for (let i = 0; i < maxScan; i++) {
    const cols = resolveCommissionStyleColumns(rows[i] ?? []);
    if (!cols) continue;
    for (let j = i + 1; j < Math.min(rows.length, i + 8); j++) {
      const row = rows[j] as unknown[] | undefined;
      const jobNumber = String(row?.[cols.job] ?? "").trim();
      if (looksLikeJobNumber(jobNumber)) {
        return { headerRow0Based: i, cols };
      }
    }
  }
  return null;
}

async function importPersonYearSheet(wb: XLSX.WorkBook, sheetName: string) {
  if (SKIP.test(sheetName)) return 0;
  if (/^total commissions/i.test(sheetName)) return 0;
  const my = sheetName.match(PERSON_YEAR);
  if (!my) return 0;
  const salespersonName = my[1]!.trim().replace(/\s+/g, " ");
  const sheetYear = parseInt(my[2]!, 10);

  const sh = wb.Sheets[sheetName];
  if (!sh) return 0;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" }) as unknown[][];
  if (rows.length < 2) return 0;
  const header = detectCommissionHeaderRow(rows);
  if (!header) {
    console.warn("Skip (no Job # column):", sheetName);
    return 0;
  }
  const cols = header.cols;

  const sp = await prisma.salesperson.upsert({
    where: { name: salespersonName },
    create: { name: salespersonName, active: true },
    update: { active: true },
  });

  let n = 0;
  for (let r = header.headerRow0Based + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const jobNumber = String(row[cols.job] ?? "").trim();
    if (!jobNumber || !looksLikeJobNumber(jobNumber)) continue;

    const job = await prisma.job.findUnique({ where: { jobNumber } });
    if (!job) {
      console.warn("No Job row for", jobNumber, "—", sheetName);
      continue;
    }
    if (job.year !== sheetYear) {
      console.warn("Year mismatch:", sheetName, "job", jobNumber, "DB year", job.year);
    }

    const existing = await prisma.commission.findUnique({
      where: { jobId_salespersonId: { jobId: job.id, salespersonId: sp.id } },
    });
    if (existing?.override) continue;

    const paidRaw = cellNum(row, cols.commissionPaid);
    const owedRaw = cellNum(row, cols.commissionOwed);
    const { paid: paidAmt, owed: owedAmt } = normalizeImportedCommissionAmounts(job.year, paidRaw, owedRaw);

    await prisma.commission.upsert({
      where: { jobId_salespersonId: { jobId: job.id, salespersonId: sp.id } },
      create: {
        jobId: job.id,
        salespersonId: sp.id,
        paidAmount: new Prisma.Decimal(paidAmt.toFixed(2)),
        owedAmount: new Prisma.Decimal(owedAmt.toFixed(2)),
        override: false,
      },
      update: {
        paidAmount: new Prisma.Decimal(paidAmt.toFixed(2)),
        owedAmount: new Prisma.Decimal(owedAmt.toFixed(2)),
      },
    });
    n++;
  }
  console.log(sheetName, "commission rows upserted:", n);
  return n;
}

async function main() {
  await assertImportsAllowedAfterCutover();
  const root = workbookRoot();
  const fp = resolveCommissionsXlsx(root);
  if (!fp || !fs.existsSync(fp)) {
    console.error("Missing commissions.xlsx in:", root);
    process.exit(1);
  }
  const wb = XLSX.readFile(fp);
  let total = 0;
  for (const name of wb.SheetNames) {
    total += await importPersonYearSheet(wb, name);
  }
  console.log("Done. Sheets touched total upserts:", total);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
