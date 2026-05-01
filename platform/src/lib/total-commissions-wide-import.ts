/**
 * "Total Commissions {year}" tabs in Commissions.xlsx: column A = pay period, then one column per rep
 * with newline-separated `jobNumber - customer - $amount` lines (same as `scripts/import-total-commissions.ts`).
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { pickCommissionPayoutScalarWriteFields } from "@/lib/job-prisma-write-fields";
import { parsePaymentLine } from "@/lib/parse-payment-line";
import { resolveOrCreateSalespersonByName } from "@/lib/salesperson-name";

export type TotalCommissionsWideImportResult = {
  headerRowUsed: number;
  dataStartUsed: number;
  dataEndExclusive: number;
  imported: number;
  skipped: number;
  created: number;
  updated: number;
};

export function totalCommissionsWideSheetYear(sheetName: string): number | null {
  const m = sheetName.trim().match(/^Total Commissions\s*(\d{4})/i);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  return Number.isFinite(y) ? y : null;
}

export function isTotalCommissionsWideSheetName(sheetName: string): boolean {
  return totalCommissionsWideSheetYear(sheetName) != null;
}

/** Column B = index 1 → first salesperson (defaults when header row missing). */
function defaultSalespeopleForYear(sheetYear: number): string[] {
  if (sheetYear === 2025) return ["Brett", "Drew", "James", "Geoff", "Adam"];
  if (sheetYear === 2026) return ["Brett", "Drew", "James", "Mike"];
  return [];
}

function salespersonNamesForSheet(sheetYear: number, headerRow: unknown[] | undefined): string[] {
  const defaults = defaultSalespeopleForYear(sheetYear);
  if (!headerRow || defaults.length === 0) return defaults;
  return defaults.map((d, i) => {
    const h = String(headerRow[i + 1] ?? "").trim();
    return h || d;
  });
}

/** First 0-based row index that contains pay-period data (row before that is rep-name header when return value is 1). */
export function detectTotalCommissionsFirstDataRow0Based(rows: unknown[][]): number {
  const a0 = String(rows[0]?.[0] ?? "").toLowerCase();
  if (a0.includes("pay period") || a0.includes("period") || a0 === "pay period") return 1;
  const b0 = String(rows[0]?.[1] ?? "").toLowerCase();
  if (b0.includes("brett") && !String(rows[0]?.[0] ?? "").includes("&")) return 1;
  return 0;
}

export async function importTotalCommissionsWideSheet(
  db: PrismaClient,
  rowsInput: unknown[][],
  sheetName: string,
  opts: {
    dataStartRow0Based?: number;
    dataEndExclusive?: number;
    recordedByUserId?: string | null;
    dryRun?: boolean;
  } = {}
): Promise<TotalCommissionsWideImportResult> {
  const sheetYear = totalCommissionsWideSheetYear(sheetName);
  if (!sheetYear) {
    throw new Error(`Sheet name does not match Total Commissions YYYY: ${sheetName}`);
  }

  const firstDataFromLayout = detectTotalCommissionsFirstDataRow0Based(rowsInput);
  const headerRow0 = firstDataFromLayout > 0 ? (rowsInput[0] as unknown[]) : undefined;
  const spNames = salespersonNamesForSheet(sheetYear, headerRow0);
  if (spNames.length === 0) {
    throw new Error(`No default salesperson columns for year ${sheetYear} (${sheetName})`);
  }

  const defaultDataStart = firstDataFromLayout;
  const dataStart =
    opts.dataStartRow0Based !== undefined
      ? Math.max(0, opts.dataStartRow0Based)
      : defaultDataStart;
  const dataEnd = opts.dataEndExclusive ?? rowsInput.length;

  if (dataStart > rowsInput.length) {
    throw new Error(`dataStartRow0Based ${dataStart} is past end of sheet (${rowsInput.length} rows)`);
  }
  if (dataEnd < dataStart || dataEnd > rowsInput.length) {
    throw new Error(`dataEndExclusive ${dataEnd} is invalid for sheet length ${rowsInput.length}`);
  }

  let imported = 0;
  let skipped = 0;
  let created = 0;
  let updated = 0;

  for (let r = dataStart; r < dataEnd; r++) {
    const row = rowsInput[r] as unknown[];
    const payPeriodLabel = String(row[0] ?? "").trim();
    if (!payPeriodLabel) {
      skipped++;
      continue;
    }
    if (/^pay\s*period/i.test(payPeriodLabel)) {
      skipped++;
      continue;
    }

    for (let ci = 0; ci < spNames.length; ci++) {
      const col = ci + 1;
      const salespersonName = spNames[ci];
      if (!salespersonName) continue;
      const cell = String(row[col] ?? "").trim();
      if (!cell) continue;

      const sp = await resolveOrCreateSalespersonByName(db, salespersonName, {
        activeOnCreate: true,
        preferFirstToken: true,
      });
      if (!sp) continue;

      const lines = cell.split(/\r?\n/);
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const parsed = parsePaymentLine(lines[lineIdx]!);
        if (!parsed) {
          skipped++;
          continue;
        }
        const job = await db.job.findUnique({
          where: { jobNumber: parsed.jobNumber },
          select: { id: true },
        });
        const importSourceKey = `TC:${sheetName}:r${r}:c${col}:${lineIdx}:${parsed.jobNumber}`;

        const createRaw = {
          importSourceKey,
          salespersonId: sp.id,
          jobId: job?.id ?? null,
          payPeriodLabel,
          amount: new Prisma.Decimal(parsed.amount.toFixed(2)),
          notes: `import:${sheetName} · ${parsed.customer}`,
          recordedByUserId: opts.recordedByUserId ?? null,
        };
        const updateRaw = {
          salespersonId: sp.id,
          jobId: job?.id ?? null,
          payPeriodLabel,
          amount: new Prisma.Decimal(parsed.amount.toFixed(2)),
          notes: `import:${sheetName} · ${parsed.customer}`,
          recordedByUserId: opts.recordedByUserId ?? null,
        };

        const existing = await db.commissionPayout.findUnique({
          where: { importSourceKey },
          select: { id: true },
        });
        if (existing) updated += 1;
        else created += 1;
        if (!opts.dryRun) {
          await db.commissionPayout.upsert({
            where: { importSourceKey },
            create: pickCommissionPayoutScalarWriteFields(createRaw as Record<string, unknown>) as Prisma.CommissionPayoutCreateInput,
            update: pickCommissionPayoutScalarWriteFields(updateRaw as Record<string, unknown>) as Prisma.CommissionPayoutUpdateInput,
          });
        }
        imported++;
      }
    }
  }

  return {
    headerRowUsed: 0,
    dataStartUsed: dataStart,
    dataEndExclusive: dataEnd,
    imported,
    skipped,
    created,
    updated,
  };
}
