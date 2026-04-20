/**
 * Tabular commission payout import → `CommissionPayout` (one row per payout line).
 * Complements `scripts/import-total-commissions.ts` (multiline “Total Commissions” cells).
 */
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { sheetToRows } from "@/lib/job-sheet-import";
import { pickCommissionPayoutScalarWriteFields } from "@/lib/job-prisma-write-fields";
import {
  findPayoutHeaderRowIndex,
  mergePayoutColumnMap,
  suggestPayoutColumnMapFromHeader,
  type PayoutColumnMap,
} from "@/lib/payout-column-map";
import {
  detectTotalCommissionsFirstDataRow0Based,
  importTotalCommissionsWideSheet,
  isTotalCommissionsWideSheetName,
} from "@/lib/total-commissions-wide-import";
import { resolveOrCreateSalespersonByName } from "@/lib/salesperson-name";

export type { PayoutColumnMap } from "@/lib/payout-column-map";

export type PayoutImportTabOptions = {
  sheetName: string;
  headerMode: "auto" | "manual";
  headerRow0Based?: number;
  dataStartRow0Based?: number;
  dataEndExclusive?: number;
  /** Merged on top of header-based suggestions when `columnMapMode` is `merge`. */
  columnMap: PayoutColumnMap;
  /**
   * `merge` (default): guess columns from the header row, then apply `columnMap` overrides.
   * `manual_only`: ignore header guessing; `columnMap` must define every required field (and any optional columns you use).
   */
  columnMapMode?: "merge" | "manual_only";
  recordedByUserId?: string | null;
};

export type PayoutImportTabResult = {
  headerRowUsed: number;
  dataStartUsed: number;
  dataEndExclusive: number;
  imported: number;
  skipped: number;
};

function num(v: unknown): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const x = parseFloat(v.replace(/[^0-9.-]+/g, ""));
    return isNaN(x) ? NaN : x;
  }
  return NaN;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function getCell(row: unknown[], col: number | undefined): unknown {
  if (col === undefined || col < 0) return undefined;
  if (!row || col >= row.length) return undefined;
  return row[col];
}

function validateColumnMap(m: PayoutColumnMap): void {
  const missing: string[] = [];
  if (m.payPeriodLabel === undefined) missing.push("payPeriodLabel (pay period text)");
  if (m.amount === undefined) missing.push("amount (payout dollars)");
  if (m.salespersonName === undefined && m.salespersonId === undefined) {
    missing.push("salespersonName and/or salespersonId");
  }
  if (missing.length) {
    throw new Error(
      `Column map is incomplete after merging your indices with header detection. ` +
        `Set 0-based column indices (A=0) for: ${missing.join("; ")}. ` +
        `Optional: jobNumber, notes, importSourceKey. ` +
        `Tip: turn on “Manual column map only” on the payout import screen and enter only what you need, with no header guessing.`
    );
  }
}

function buildPayoutColumnMap(headerRow: unknown[], opts: PayoutImportTabOptions): PayoutColumnMap {
  const mode = opts.columnMapMode ?? "merge";
  const user = opts.columnMap ?? {};
  if (mode === "manual_only") {
    validateColumnMap(user);
    return user;
  }
  const suggested = suggestPayoutColumnMapFromHeader(headerRow);
  const merged = mergePayoutColumnMap(suggested, user);
  validateColumnMap(merged);
  return merged;
}

function sanitizeSheetKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
}

export async function importPayoutSheetTab(
  db: PrismaClient,
  rowsInput: unknown[][],
  opts: PayoutImportTabOptions
): Promise<PayoutImportTabResult> {
  if (isTotalCommissionsWideSheetName(opts.sheetName)) {
    const wide = await importTotalCommissionsWideSheet(db, rowsInput, opts.sheetName, {
      dataStartRow0Based: opts.dataStartRow0Based,
      dataEndExclusive: opts.dataEndExclusive,
      recordedByUserId: opts.recordedByUserId ?? null,
    });
    const firstData = detectTotalCommissionsFirstDataRow0Based(rowsInput);
    return {
      headerRowUsed: firstData === 1 ? 0 : findPayoutHeaderRowIndex(rowsInput),
      dataStartUsed: wide.dataStartUsed,
      dataEndExclusive: wide.dataEndExclusive,
      imported: wide.imported,
      skipped: wide.skipped,
    };
  }

  const sheetSlug = sanitizeSheetKey(opts.sheetName);

  let headerIdx: number;
  if (opts.headerMode === "manual") {
    if (opts.headerRow0Based === undefined || opts.headerRow0Based < 0) {
      throw new Error("Manual header mode requires headerRow0Based >= 0");
    }
    headerIdx = opts.headerRow0Based;
    if (headerIdx >= rowsInput.length) {
      throw new Error(`Header row ${headerIdx} is past the end of the sheet (${rowsInput.length} rows)`);
    }
  } else {
    headerIdx = findPayoutHeaderRowIndex(rowsInput);
  }

  const headerRow = rowsInput[headerIdx] ?? [];
  const map = buildPayoutColumnMap(headerRow, opts);

  const defaultDataStart = headerIdx + 1;
  const dataStart = opts.dataStartRow0Based ?? defaultDataStart;
  const dataEnd = opts.dataEndExclusive ?? rowsInput.length;

  if (dataStart < 0 || dataStart > rowsInput.length) {
    throw new Error(`dataStartRow0Based ${dataStart} is out of range`);
  }
  if (dataEnd < dataStart || dataEnd > rowsInput.length) {
    throw new Error(`dataEndExclusive ${dataEnd} is invalid for sheet length ${rowsInput.length}`);
  }

  let imported = 0;
  let skipped = 0;

  for (let i = dataStart; i < dataEnd; i++) {
    const row = rowsInput[i] as unknown[];
    const payPeriodLabel = str(getCell(row, map.payPeriodLabel)).trim();
    if (!payPeriodLabel) {
      skipped++;
      continue;
    }

    let salespersonId: string | null = null;
    if (map.salespersonId !== undefined) {
      const sid = str(getCell(row, map.salespersonId)).trim();
      if (sid) {
        const sp = await db.salesperson.findUnique({ where: { id: sid }, select: { id: true } });
        if (sp) salespersonId = sp.id;
      }
    }
    if (!salespersonId && map.salespersonName !== undefined) {
      const name = str(getCell(row, map.salespersonName)).trim();
      if (!name) {
        skipped++;
        continue;
      }
      const sp = await resolveOrCreateSalespersonByName(db, name, {
        activeOnCreate: true,
        preferFirstToken: true,
      });
      salespersonId = sp?.id ?? null;
    }
    if (!salespersonId) {
      skipped++;
      continue;
    }

    const amountRaw = num(getCell(row, map.amount));
    if (!Number.isFinite(amountRaw)) {
      skipped++;
      continue;
    }

    let jobId: string | null = null;
    if (map.jobNumber !== undefined) {
      const jn = str(getCell(row, map.jobNumber)).trim();
      if (jn) {
        const job = await db.job.findUnique({ where: { jobNumber: jn }, select: { id: true } });
        jobId = job?.id ?? null;
      }
    }

    const notesRaw =
      map.notes !== undefined ? str(getCell(row, map.notes)).trim() : "";
    const notes = notesRaw || null;

    let importSourceKey: string | null = null;
    if (map.importSourceKey !== undefined) {
      const k = str(getCell(row, map.importSourceKey)).trim();
      if (k) importSourceKey = k.slice(0, 250);
    }
    if (!importSourceKey) {
      importSourceKey = `PAYOUT_UI:${sheetSlug}:row${i}`;
    }

    const amount = new Prisma.Decimal(amountRaw.toFixed(2));

    const createRaw = {
      importSourceKey,
      salespersonId,
      jobId,
      payPeriodLabel,
      amount,
      notes,
      recordedByUserId: opts.recordedByUserId ?? null,
    };
    const updateRaw = {
      salespersonId,
      jobId,
      payPeriodLabel,
      amount,
      notes,
      recordedByUserId: opts.recordedByUserId ?? null,
    };

    await db.commissionPayout.upsert({
      where: { importSourceKey },
      create: pickCommissionPayoutScalarWriteFields(createRaw as Record<string, unknown>) as Prisma.CommissionPayoutCreateInput,
      update: pickCommissionPayoutScalarWriteFields(updateRaw as Record<string, unknown>) as Prisma.CommissionPayoutUpdateInput,
    });
    imported++;
  }

  return {
    headerRowUsed: headerIdx,
    dataStartUsed: dataStart,
    dataEndExclusive: dataEnd,
    imported,
    skipped,
  };
}

export type PayoutSheetPreviewRow = {
  sheetName: string;
  rowCount: number;
  suggestedHeaderRow0Based: number;
  suggestedColumnMap: PayoutColumnMap;
  previewRows: string[][];
  /** Commissions.xlsx wide tabs: pay period col A, rep columns with multiline payment text — column map not used. */
  layout?: "total_commissions_wide";
};

export function previewPayoutSheetsFromWorkbook(
  wb: XLSX.WorkBook,
  maxPreviewRows = 8,
  maxCols = 16
): PayoutSheetPreviewRow[] {
  return wb.SheetNames.map((sheetName) => {
    const sh = wb.Sheets[sheetName];
    if (!sh) {
      return {
        sheetName,
        rowCount: 0,
        suggestedHeaderRow0Based: 0,
        suggestedColumnMap: {},
        previewRows: [],
      };
    }
    const rows = sheetToRows(sh);
    if (isTotalCommissionsWideSheetName(sheetName)) {
      const firstData = detectTotalCommissionsFirstDataRow0Based(rows);
      const suggestedHeaderRow0Based = firstData === 1 ? 0 : findPayoutHeaderRowIndex(rows);
      const headerRow = rows[suggestedHeaderRow0Based] ?? [];
      return {
        sheetName,
        rowCount: rows.length,
        suggestedHeaderRow0Based,
        suggestedColumnMap: suggestPayoutColumnMapFromHeader(headerRow),
        previewRows: rows.slice(0, maxPreviewRows).map((r) => {
          const arr = (r as unknown[]) ?? [];
          const out: string[] = [];
          for (let c = 0; c < maxCols; c++) {
            const v = arr[c];
            const s = v === null || v === undefined ? "" : String(v);
            out.push(s.length > 48 ? `${s.slice(0, 45)}…` : s);
          }
          return out;
        }),
        layout: "total_commissions_wide" as const,
      };
    }
    const suggestedHeaderRow0Based = findPayoutHeaderRowIndex(rows);
    const headerRow = rows[suggestedHeaderRow0Based] ?? [];
    const suggestedColumnMap = suggestPayoutColumnMapFromHeader(headerRow);
    const previewRows = rows.slice(0, maxPreviewRows).map((r) => {
      const arr = (r as unknown[]) ?? [];
      const out: string[] = [];
      for (let c = 0; c < maxCols; c++) {
        const v = arr[c];
        const s = v === null || v === undefined ? "" : String(v);
        out.push(s.length > 48 ? `${s.slice(0, 45)}…` : s);
      }
      return out;
    });
    return {
      sheetName,
      rowCount: rows.length,
      suggestedHeaderRow0Based,
      suggestedColumnMap,
      previewRows,
    };
  });
}
