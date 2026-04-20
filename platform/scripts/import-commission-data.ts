/**
 * Import "Commission Data" tab from Job Numbering.xlsx (Lead, Job #, Salesperson, Paid, Owed, Override).
 * Upserts Commission rows for jobs that already exist (run import:jobs first).
 *
 * Year policy (by Job.year): 2024 → paid += owed, owed = 0 (fully paid). 2025/2026 → exact Paid/Owed from sheet.
 *
 * Run: npm run import:commission-data
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { PrismaClient, Prisma } from "@prisma/client";
import { resolveJobNumberingXlsx, workbookRoot } from "./workbook-paths";
import { normalizeImportedCommissionAmounts } from "../src/lib/commission-import-policy";

function normCell(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findCol(headers: unknown[], matchers: ((h: string) => boolean)[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normCell(headers[i]);
    if (!h) continue;
    for (const m of matchers) {
      if (m(h)) return i;
    }
  }
  return -1;
}

function mapCommissionDataHeaders(headers: unknown[]): {
  lead: number;
  job: number;
  sp: number;
  paid: number;
  owed: number;
  override: number;
} | null {
  const job = findCol(headers, [
    (h) => h.includes("job") && h.includes("#"),
    (h) => h === "job number",
  ]);
  if (job < 0) return null;
  const sp = findCol(headers, [(h) => h === "salesperson" || h === "sales person"]);
  const paid = findCol(headers, [(h) => h === "paid" || h === "paid amount"]);
  const owed = findCol(headers, [(h) => h === "owed" || h === "owed amount"]);
  const override = findCol(headers, [(h) => h === "override" || h.includes("override flag")]);
  const lead = findCol(headers, [(h) => h.includes("lead")]);
  if (sp < 0 || paid < 0 || owed < 0) return null;
  return {
    lead: lead >= 0 ? lead : -1,
    job,
    sp,
    paid,
    owed,
    override: override >= 0 ? override : -1,
  };
}

function num(v: unknown): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const x = parseFloat(v.replace(/[^0-9.-]+/g, ""));
    return isNaN(x) ? 0 : x;
  }
  return 0;
}

function boolish(v: unknown): boolean {
  return v === true || v === "TRUE" || v === "true" || String(v).toLowerCase() === "yes";
}

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

async function main() {
  await assertImportsAllowedAfterCutover();
  const root = workbookRoot();
  const fp = resolveJobNumberingXlsx(root);
  if (!fp || !fs.existsSync(fp)) {
    console.error("Missing Job Numbering workbook in:", root);
    process.exit(1);
  }
  const wb = XLSX.readFile(fp);
  const tab = "Commission Data";
  if (!wb.SheetNames.includes(tab)) {
    console.warn("No tab", tab, "— nothing to do.");
    return;
  }
  const sh = wb.Sheets[tab]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" }) as unknown[][];
  if (rows.length < 2) {
    console.warn("Commission Data empty");
    return;
  }
  const cols = mapCommissionDataHeaders(rows[0]!);
  if (!cols) {
    console.error("Could not map Commission Data headers:", rows[0]);
    process.exit(1);
  }

  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const jobNumber = String(row[cols.job] ?? "").trim();
    if (!jobNumber) continue;
    const spName = String(row[cols.sp] ?? "").trim();
    if (!spName) continue;

    const job = await prisma.job.findUnique({ where: { jobNumber } });
    if (!job) {
      console.warn("No Job for Commission Data row:", jobNumber, spName);
      continue;
    }

    const sp = await prisma.salesperson.upsert({
      where: { name: spName },
      create: { name: spName, active: true },
      update: { active: true },
    });

    const paidRaw = num(row[cols.paid]);
    const owedRaw = num(row[cols.owed]);
    const { paid: paidAmt, owed: owedAmt } = normalizeImportedCommissionAmounts(
      job.year,
      paidRaw,
      owedRaw
    );
    const ov = cols.override >= 0 ? boolish(row[cols.override]) : false;

    const existing = await prisma.commission.findUnique({
      where: { jobId_salespersonId: { jobId: job.id, salespersonId: sp.id } },
    });
    if (existing?.override) continue;

    await prisma.commission.upsert({
      where: { jobId_salespersonId: { jobId: job.id, salespersonId: sp.id } },
      create: {
        jobId: job.id,
        salespersonId: sp.id,
        paidAmount: new Prisma.Decimal(paidAmt.toFixed(2)),
        owedAmount: new Prisma.Decimal(owedAmt.toFixed(2)),
        override: ov,
      },
      update: {
        paidAmount: new Prisma.Decimal(paidAmt.toFixed(2)),
        owedAmount: new Prisma.Decimal(owedAmt.toFixed(2)),
        override: ov,
      },
    });
    n++;
  }
  console.log("Commission Data rows upserted:", n);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
