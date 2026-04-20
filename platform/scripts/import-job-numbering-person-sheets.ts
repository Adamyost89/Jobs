/**
 * Job Numbering workbook: tabs like `2025 Brett`, `2026 Mike` (commission columns aligned to main year rows).
 * Also imports full-grid person tabs when headers include Job # (e.g. some 2024 layouts).
 *
 * Year policy (by Job.year): 2024 → paid += owed, owed = 0. 2025/2026 → exact paid/owed from sheet.
 *
 * Run after import:jobs — npm run import:job-person-sheets
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { PrismaClient, Prisma } from "@prisma/client";
import { resolveJobNumberingXlsx, workbookRoot } from "./workbook-paths";
import { resolveCommissionStyleColumns, cellNum, boolish } from "./header-columns";
import { normalizeImportedCommissionAmounts } from "../src/lib/commission-import-policy";

const prisma = new PrismaClient();

const YEAR_ONLY = new Set(["2023", "2024", "2025", "2026"]);
const SKIP_SHEETS = /^commission data$|^index$/i;
const PERSON_SHEET = /^(\d{4})\s+(.+)$/;
const SKIP_PERSON = /survey|chart|callback|^reports$|schedule|insurance|breakdown|am totals|^am$|^paid\s/i;

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

function detectLayout(headerRow: unknown[]): "modern" | "legacy2024" {
  const c1 = String(headerRow[1] ?? "").toLowerCase();
  if (c1.includes("job")) return "modern";
  return "legacy2024";
}

function jobNumberFromMasterRow(
  rows: unknown[][],
  layout: "modern" | "legacy2024",
  r: number
): string | null {
  const row = rows[r] as unknown[];
  if (!row) return null;
  if (layout === "modern") {
    const j = String(row[1] ?? "").trim();
    return looksLikeJobNumber(j) ? j : null;
  }
  const j = String(row[0] ?? "").trim();
  return looksLikeJobNumber(j) ? j : null;
}

async function importAlignedPersonSheet(
  rowsMaster: unknown[][],
  layout: "modern" | "legacy2024",
  rowsPerson: unknown[][],
  salespersonName: string,
  sheetLabel: string
) {
  const sp = await prisma.salesperson.upsert({
    where: { name: salespersonName },
    create: { name: salespersonName, active: true },
    update: { active: true },
  });

  let n = 0;
  const maxR = Math.min(rowsPerson.length, rowsMaster.length);
  for (let r = 1; r < maxR; r++) {
    const jobNumber = jobNumberFromMasterRow(rowsMaster, layout, r);
    if (!jobNumber) continue;

    const prow = rowsPerson[r] as unknown[];
    if (!prow || prow.length === 0) continue;

    const paidRaw = cellNum(prow, 0);
    const owedRaw = cellNum(prow, 1);
    const override = prow.length > 3 ? boolish(prow[3]) : false;

    if (paidRaw === 0 && owedRaw === 0 && !override) continue;

    const job = await prisma.job.findUnique({ where: { jobNumber } });
    if (!job) continue;

    const existing = await prisma.commission.findUnique({
      where: { jobId_salespersonId: { jobId: job.id, salespersonId: sp.id } },
    });
    if (existing?.override) continue;

    const { paid, owed } = normalizeImportedCommissionAmounts(job.year, paidRaw, owedRaw);

    await prisma.commission.upsert({
      where: { jobId_salespersonId: { jobId: job.id, salespersonId: sp.id } },
      create: {
        jobId: job.id,
        salespersonId: sp.id,
        paidAmount: new Prisma.Decimal(paid.toFixed(2)),
        owedAmount: new Prisma.Decimal(owed.toFixed(2)),
        override,
      },
      update: {
        paidAmount: new Prisma.Decimal(paid.toFixed(2)),
        owedAmount: new Prisma.Decimal(owed.toFixed(2)),
        override,
      },
    });
    n++;
  }
  console.log(sheetLabel, "(aligned) commission rows:", n);
}

async function importFullGridPersonSheet(
  rows: unknown[][],
  salespersonName: string,
  sheetLabel: string,
  headerRow0Based: number,
  cols: NonNullable<ReturnType<typeof resolveCommissionStyleColumns>>
) {
  const sp = await prisma.salesperson.upsert({
    where: { name: salespersonName },
    create: { name: salespersonName, active: true },
    update: { active: true },
  });
  let n = 0;
  for (let r = headerRow0Based + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const jobNumber = String(row[cols.job] ?? "").trim();
    if (!jobNumber || !looksLikeJobNumber(jobNumber)) continue;
    const job = await prisma.job.findUnique({ where: { jobNumber } });
    if (!job) continue;

    const paidRaw = cellNum(row, cols.commissionPaid);
    const owedRaw = cellNum(row, cols.commissionOwed);
    const { paid: paidAmt, owed: owedAmt } = normalizeImportedCommissionAmounts(job.year, paidRaw, owedRaw);

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
        override: false,
      },
      update: {
        paidAmount: new Prisma.Decimal(paidAmt.toFixed(2)),
        owedAmount: new Prisma.Decimal(owedAmt.toFixed(2)),
      },
    });
    n++;
  }
  console.log(sheetLabel, "(full grid) commission rows:", n);
}

async function main() {
  const root = workbookRoot();
  const fp = resolveJobNumberingXlsx(root);
  if (!fp || !fs.existsSync(fp)) {
    console.error("Missing Job Numbering workbook in:", root);
    process.exit(1);
  }
  const wb = XLSX.readFile(fp);
  const masterCache = new Map<string, { rows: unknown[][]; layout: "modern" | "legacy2024" }>();
  for (const y of ["2023", "2024", "2025", "2026"]) {
    if (!wb.SheetNames.includes(y)) continue;
    const sh = wb.Sheets[y];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" }) as unknown[][];
    const layout = detectLayout(rows[0] ?? []);
    masterCache.set(y, { rows, layout });
  }

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.test(sheetName)) continue;
    if (YEAR_ONLY.has(sheetName)) continue;
    const m = sheetName.match(PERSON_SHEET);
    if (!m) continue;
    const yearStr = m[1]!;
    const person = m[2]!.trim();
    if (SKIP_PERSON.test(person) || SKIP_PERSON.test(sheetName)) continue;

    const master = masterCache.get(yearStr);
    if (!master) {
      console.warn("No master tab", yearStr, "for", sheetName);
      continue;
    }

    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rowsPerson = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" }) as unknown[][];

    const detectedHeader = detectCommissionHeaderRow(rowsPerson);
    const useFullGrid = Boolean(detectedHeader);

    if (useFullGrid) {
      await importFullGridPersonSheet(
        rowsPerson,
        person,
        sheetName,
        detectedHeader!.headerRow0Based,
        detectedHeader!.cols
      );
    } else {
      await importAlignedPersonSheet(master.rows, master.layout, rowsPerson, person, sheetName);
    }
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
