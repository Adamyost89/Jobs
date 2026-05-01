/**
 * Job Numbering workbook → Job rows (modern + legacy layouts).
 * Used by `scripts/import-jobs.ts` and the dashboard upload importer.
 */
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { normalizeStatus } from "@/lib/status";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";
import { pickJobScalarWriteFields } from "@/lib/job-prisma-write-fields";
import { deriveChangeOrdersNumber, moneyEq, MONEY_EPSILON } from "@/lib/change-orders";
import {
  buildModernColumnMapManualOnly,
  cell,
  mergeModernColumnMap,
  minModernRowLength,
  resolveModernJobColumns,
  suggestModernJobColumnMapFromHeader,
  type ModernJobColumnMap,
} from "@/lib/sheet-job-columns";
import { resolveOrCreateSalespersonByName } from "@/lib/salesperson-name";
import { isInsuranceCustomerName } from "@/lib/insurance-job";

export type JobSheetLayout = "modern" | "legacy2024";

export type JobImportTabOptions = {
  bookYear: number;
  headerMode: "auto" | "manual";
  /** Required when headerMode is "manual" (0-based row index of the header). */
  headerRow0Based?: number;
  /** First data row (0-based). Defaults to the row after the header. */
  dataStartRow0Based?: number;
  /** Exclusive end row index (same semantics as `Array.slice`). Omit = through last row. */
  dataEndExclusive?: number;
  /**
   * Modern layout only: 0-based column indices merged on top of header-based detection.
   * Omit a field to keep the auto-detected index for that field.
   */
  columnMap?: Partial<Record<keyof ModernJobColumnMap, number>>;
  /**
   * `merge` (default): detect columns from the header row, then apply `columnMap` overrides.
   * `manual_only`: ignore header detection; `columnMap` must list every `MODERN_JOB_COLUMN_KEYS` field.
   */
  columnMapMode?: "merge" | "manual_only";
};

export type JobImportTabResult = {
  layout: JobSheetLayout;
  headerRowUsed: number;
  dataStartUsed: number;
  dataEndExclusive: number;
  imported: number;
  /** Modern layout only: data rows skipped because project/lead # was empty. */
  skippedNoLead: number;
  signedAtOk: number;
  signedAtMissing: number;
};

function normHeaderCell(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^\ufeff/, "")
    .toLowerCase();
}

export function detectLayoutFromHeader(headerRow: unknown[]): JobSheetLayout {
  const c1 = normHeaderCell(headerRow[1]);
  if (c1.includes("job")) return "modern";
  return "legacy2024";
}

/**
 * Header is not always row 0 (title rows, logos, blank lines). Scan the top of the sheet for the real header row.
 */
export function findJobNumberingHeaderRowIndex(rows: unknown[][]): number {
  const maxScan = Math.min(rows.length, 40);
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r];
    if (!row || row.length < 2) continue;

    const c0 = normHeaderCell(row[0]);
    const c1 = normHeaderCell(row[1]);

    if (c1.includes("job") && !/^\d/.test(c1)) {
      const cells = row.map((c) => normHeaderCell(c)).filter(Boolean);
      const hasContractOrDate = cells.some(
        (h) =>
          h === "date" ||
          h.includes("contract") ||
          (h.includes("date") &&
            !h.includes("projected") &&
            !h.includes("project ") &&
            !h.includes("start") &&
            !h.includes("end"))
      );
      if (hasContractOrDate || c0.includes("project") || c0.includes("lead")) return r;
    }

    if (c0.includes("job") && (c1.includes("name") || c1.includes("customer") || c1.includes("client"))) {
      return r;
    }
  }
  return 0;
}

function num(v: unknown): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const x = parseFloat(v.replace(/[^0-9.-]+/g, ""));
    return isNaN(x) ? 0 : x;
  }
  return 0;
}

function percentCell(v: unknown): number | null {
  const n = num(v);
  if (!Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) <= 1.05) return n * 100;
  return n;
}

function plausibleSheetYear(y: number): boolean {
  return Number.isFinite(y) && y >= 1990 && y <= 2100;
}

function excelSerialToUtcDate(v: number): Date | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  const d = XLSX.SSF.parse_date_code(v);
  if (!d || !plausibleSheetYear(d.y)) return null;
  /** Noon UTC keeps the calendar day stable when reports bucket by local TZ. */
  return new Date(Date.UTC(d.y, d.m - 1, d.d, 12, 0, 0));
}

function parseUsShortDateString(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s|$|[Tt])/.exec(t);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const mo = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  if (!plausibleSheetYear(y)) return null;
  /** Civil calendar date (US M/D/Y), stored at noon UTC for stable month bucketing. */
  return new Date(Date.UTC(y, mo - 1, day, 12, 0, 0));
}

function parseIsoDateOnly(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(t);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  if (!plausibleSheetYear(y)) return null;
  return new Date(Date.UTC(y, mo - 1, day, 12, 0, 0));
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const x = v;
    /** xlsx `cellDates` is often UTC midnight for the sheet’s calendar day — prefer UTC parts in that case. */
    const utcMid =
      x.getUTCHours() === 0 &&
      x.getUTCMinutes() === 0 &&
      x.getUTCSeconds() === 0 &&
      x.getUTCMilliseconds() === 0;
    const y = utcMid ? x.getUTCFullYear() : x.getFullYear();
    const mo = utcMid ? x.getUTCMonth() : x.getMonth();
    const day = utcMid ? x.getUTCDate() : x.getDate();
    if (plausibleSheetYear(y)) return new Date(Date.UTC(y, mo, day, 12, 0, 0));
    return x;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const fromSerial = excelSerialToUtcDate(v);
    if (fromSerial) return fromSerial;
  }
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    const iso = parseIsoDateOnly(t);
    if (iso) return iso;
    const us = parseUsShortDateString(t);
    if (us) return us;
    if (/^\d{5,7}(\.\d+)?$/.test(t)) {
      const n = parseFloat(t);
      const fromSerial = excelSerialToUtcDate(n);
      if (fromSerial) return fromSerial;
    }
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function boolish(v: unknown): boolean {
  return v === true || v === "TRUE" || v === "true";
}

function looksPaidAndClosedStatus(statusRaw: string): boolean {
  const s = statusRaw.trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes("paid in full") ||
    s.includes("invoice paid") ||
    (s.includes("paid") && s.includes("closed")) ||
    s.includes("complete")
  );
}

function marginPctFromFinancials(revenue: number, cost: number, gp: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= MONEY_EPSILON) return null;
  if (Number.isFinite(cost) && Math.abs(cost) > MONEY_EPSILON) {
    return ((revenue - cost) / revenue) * 100;
  }
  return (gp / revenue) * 100;
}

function normalizePercentValue(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) <= 1.05) return v * 100;
  return v;
}

function normalizeLead(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !isNaN(value)) {
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) > 1e12) return null;
    const n = Math.trunc(value);
    if (n === 0) return null;
    return String(n);
  }
  const s = String(value).trim();
  if (!s || s === "0") return null;
  return s;
}

type ParsedRow = {
  leadNumber: string | null;
  jobNumber: string;
  name: string | null;
  contractSignedAt: Date | null;
  contractAmount: number;
  amountPaid: number | null;
  salespersonCell: string;
  invoicedTotal: number;
  projectRevenue: number;
  changeOrders: number;
  cost: number;
  gp: number;
  gpPercent: number;
  retailPercent: number | null;
  insurancePercent: number | null;
  invoiceFlag: boolean;
  paidInFull: boolean;
  updateMarker: boolean;
  commOwedFlag: boolean;
  statusRaw: string;
  drewParticipation: string | null;
  paidDate: Date | null;
};

/**
 * Import safety net:
 * When Amount Paid is present, derive Change Orders from paid vs contract.
 * This keeps CO aligned even if source CO columns are mis-mapped.
 */
function normalizeParsedFinancials(p: ParsedRow): ParsedRow {
  const derived = deriveChangeOrdersNumber(p.contractAmount, p.amountPaid);
  if (derived !== null && !moneyEq(derived, p.changeOrders)) {
    return { ...p, changeOrders: derived };
  }
  return p;
}

function looksLikeJobNumber(s: string): boolean {
  return /^\d{8}/.test(s) || /^202[4-9]/.test(s);
}

/** Template + date-shift resolution, then header-label hints (tail columns). User overrides merge on top in `importJobBookTab`. */
function modernColumnMapFromHeaderRow(headerRow: unknown[]): ModernJobColumnMap {
  return mergeModernColumnMap(
    resolveModernJobColumns(headerRow),
    suggestModernJobColumnMapFromHeader(headerRow)
  );
}

function parseModernRow(row: unknown[], col: ReturnType<typeof resolveModernJobColumns>): ParsedRow | null {
  const minLen = minModernRowLength(col);
  if (!row || row.length < minLen) return null;
  const jobNumber = String(cell(row, col.jobNumber) ?? "").trim();
  if (!jobNumber || !looksLikeJobNumber(jobNumber)) return null;

  const leadNumber = normalizeLead(cell(row, col.lead));
  const name = cell(row, col.name) != null ? String(cell(row, col.name)) : null;
  const contractSignedAt = parseDate(cell(row, col.date));
  const contractAmount = num(cell(row, col.contract));
  const salespersonCell =
    cell(row, col.am) != null ? String(cell(row, col.am)).trim() : "";
  const invoicedTotal = num(cell(row, col.invoiced));
  const amountPaidRaw = num(cell(row, col.amountPaid));
  const amountPaid = amountPaidRaw > 0.005 || amountPaidRaw < -0.005 ? amountPaidRaw : null;
  const changeOrders = num(cell(row, col.changeOrders));
  const cost = num(cell(row, col.cost));
  const gp = num(cell(row, col.gp));
  const gpPercent = num(cell(row, col.gpPercent));
  const retailPercentRaw = percentCell(cell(row, col.retail));
  const insurancePercentRaw = percentCell(cell(row, col.insurance));
  const invoiceFlag = boolish(cell(row, col.billed));
  const paidInFullCell = boolish(cell(row, col.paidInFull));
  const commOwedFlag =
    row.length > col.commOwed ? boolish(cell(row, col.commOwed)) : false;
  const updateMarker =
    row.length > col.updateThis ? boolish(cell(row, col.updateThis)) : false;
  const statusRaw = cell(row, col.status) != null ? String(cell(row, col.status)) : "";
  const paidInFullByStatus = looksPaidAndClosedStatus(statusRaw);
  const paidInFullByAmounts =
    amountPaid != null && invoicedTotal > MONEY_EPSILON && Math.abs(amountPaid - invoicedTotal) <= MONEY_EPSILON;
  const paidInFull = paidInFullCell || paidInFullByStatus || paidInFullByAmounts;
  const drewParticipation =
    row.length > col.drewParticipation &&
    cell(row, col.drewParticipation) != null &&
    String(cell(row, col.drewParticipation)).trim()
      ? String(cell(row, col.drewParticipation))
      : null;
  const paidDate = row.length > col.paidDate ? parseDate(cell(row, col.paidDate)) : null;

  const projectRevenue =
    row.length > col.projectRevenue && num(cell(row, col.projectRevenue)) > 0
      ? num(cell(row, col.projectRevenue))
      : invoicedTotal > 0
        ? invoicedTotal
        : contractAmount + changeOrders;

  const revenue = contractAmount + changeOrders;
  const gpPercentNormalized = normalizePercentValue(gpPercent);
  const gpMarginPct = gpPercentNormalized ?? marginPctFromFinancials(revenue, cost, gp);
  let retailPercentFinal: number | null = null;
  let insurancePercentFinal: number | null = null;
  if (gpMarginPct != null) {
    if (isInsuranceCustomerName(name)) insurancePercentFinal = gpMarginPct;
    else retailPercentFinal = gpMarginPct;
  } else {
    // Keep raw values only when GP margin cannot be computed.
    retailPercentFinal = retailPercentRaw;
    insurancePercentFinal = insurancePercentRaw;
  }

  return {
    leadNumber,
    jobNumber,
    name,
    contractSignedAt,
    contractAmount,
    amountPaid,
    salespersonCell,
    invoicedTotal,
    projectRevenue,
    changeOrders,
    cost,
    gp,
    gpPercent,
    retailPercent: retailPercentFinal,
    insurancePercent: insurancePercentFinal,
    invoiceFlag,
    paidInFull,
    updateMarker,
    commOwedFlag,
    statusRaw,
    drewParticipation,
    paidDate,
  };
}

function parseLegacy2024Row(row: unknown[]): ParsedRow | null {
  if (!row || row.length < 17) return null;
  const jobNumber = String(row[0] ?? "").trim();
  if (!jobNumber || !looksLikeJobNumber(jobNumber)) return null;

  const name = row[1] != null ? String(row[1]) : null;
  const contractSignedAt = parseDate(row[3]);
  const contractAmount = num(row[4]);
  const salespersonCell = row[7] != null ? String(row[7]).trim() : "";
  const invoicedTotal = num(row[8]);
  const changeOrders = num(row[9]);
  const cost = num(row[10]);
  const gp = row.length > 11 ? num(row[11]) : 0;
  const gpPercent = num(row[12]);
  const invoiceFlag = boolish(row[15]);
  const statusRaw = row[16] != null ? String(row[16]) : "";
  const updateMarker = row.length > 17 ? boolish(row[17]) : false;
  const paidInFull =
    boolish(row[15]) || statusRaw.toLowerCase().includes("paid in full");
  const revenue = contractAmount + changeOrders;
  const gpPercentNormalized = normalizePercentValue(gpPercent);
  const gpMarginPct = gpPercentNormalized ?? marginPctFromFinancials(revenue, cost, gp);
  let retailPercent: number | null = null;
  let insurancePercent: number | null = null;
  if (gpMarginPct != null) {
    if (isInsuranceCustomerName(name)) insurancePercent = gpMarginPct;
    else retailPercent = gpMarginPct;
  }

  return {
    leadNumber: null,
    jobNumber,
    name,
    contractSignedAt,
    contractAmount,
    amountPaid: null,
    salespersonCell,
    invoicedTotal,
    projectRevenue: invoicedTotal > 0 ? invoicedTotal : contractAmount + changeOrders,
    changeOrders,
    cost,
    gp,
    gpPercent,
    retailPercent,
    insurancePercent,
    invoiceFlag,
    paidInFull,
    updateMarker,
    commOwedFlag: false,
    statusRaw,
    drewParticipation: null,
    paidDate: null,
  };
}

/** Blank template rows with no money and no identifying cells; not used to drop $0 real jobs when lead/name/AM is set. */
function isShellPlaceholderFromParsed(p: ParsedRow): boolean {
  const hasMoney =
    p.contractAmount > 0.005 ||
    p.invoicedTotal > 0.005 ||
    p.changeOrders > 0.005 ||
    p.projectRevenue > 0.005;
  if (hasMoney) return false;
  if (p.leadNumber?.trim()) return false;
  if (p.name?.trim()) return false;
  if (p.salespersonCell.trim()) return false;
  return true;
}

function decimalOrNull(n: number | null | undefined): Prisma.Decimal | null {
  if (n === null || n === undefined) return null;
  return new Prisma.Decimal(n.toFixed(4));
}

export function readWorkbookFromBuffer(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: false, cellText: false });
}

export function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
}

export type JobSheetPreviewRow = {
  sheetName: string;
  rowCount: number;
  suggestedHeaderRow0Based: number;
  suggestedLayout: JobSheetLayout;
  previewRows: string[][];
  /** Present when `suggestedLayout` is `modern` — 0-based column indices after header scan. */
  suggestedColumnMap?: ModernJobColumnMap;
};

export function previewJobSheetsFromWorkbook(wb: XLSX.WorkBook, maxPreviewRows = 6, maxCols = 14): JobSheetPreviewRow[] {
  return wb.SheetNames.map((sheetName) => {
    const sh = wb.Sheets[sheetName];
    if (!sh) {
      return {
        sheetName,
        rowCount: 0,
        suggestedHeaderRow0Based: 0,
        suggestedLayout: "legacy2024",
        previewRows: [],
      };
    }
    const rows = sheetToRows(sh);
    const suggestedHeaderRow0Based = findJobNumberingHeaderRowIndex(rows);
    const headerRow = rows[suggestedHeaderRow0Based] ?? [];
    const suggestedLayout = detectLayoutFromHeader(headerRow);
    const suggestedColumnMap =
      suggestedLayout === "modern" ? modernColumnMapFromHeaderRow(headerRow) : undefined;
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
      suggestedLayout,
      previewRows,
      suggestedColumnMap,
    };
  });
}

/**
 * Upsert all job rows from one worksheet grid into `Job` for `opts.bookYear`.
 */
export async function importJobBookTab(
  db: PrismaClient,
  rowsInput: unknown[][],
  opts: JobImportTabOptions
): Promise<JobImportTabResult> {
  const year = opts.bookYear;

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
    headerIdx = findJobNumberingHeaderRowIndex(rowsInput);
  }

  const headerRow = rowsInput[headerIdx] ?? [];
  const layout = detectLayoutFromHeader(headerRow);
  const mode = opts.columnMapMode ?? "merge";
  let mergedModern: ModernJobColumnMap | null = null;
  if (layout === "modern") {
    if (mode === "manual_only") {
      mergedModern = buildModernColumnMapManualOnly(opts.columnMap ?? {});
    } else {
      const modernCols = modernColumnMapFromHeaderRow(headerRow);
      mergedModern = mergeModernColumnMap(modernCols, opts.columnMap ?? {});
    }
  }

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
  let skippedNoLead = 0;
  let signedOk = 0;
  let signedMissing = 0;

  for (let i = dataStart; i < dataEnd; i++) {
    const row = rowsInput[i] as unknown[];
    const parsed =
      layout === "modern" && mergedModern
        ? parseModernRow(row, mergedModern)
        : parseLegacy2024Row(row);
    const p = parsed ? normalizeParsedFinancials(parsed) : null;
    if (!p) continue;
    if (layout === "modern" && !p.leadNumber) {
      skippedNoLead += 1;
      continue;
    }
    if (isShellPlaceholderFromParsed(p)) continue;

    /** Empty sheet cells used to wipe a good DB sign date — keep prior value for reporting. */
    let contractSignedAt = p.contractSignedAt;
    if (!contractSignedAt) {
      const prior = await db.job.findUnique({
        where: { jobNumber: p.jobNumber },
        select: { contractSignedAt: true },
      });
      contractSignedAt = prior?.contractSignedAt ?? null;
    }

    if (contractSignedAt) signedOk += 1;
    else signedMissing += 1;

    let salespersonId: string | null = null;
    if (p.salespersonCell) {
      const sp = await resolveOrCreateSalespersonByName(db, p.salespersonCell, {
        preferFirstToken: true,
      });
      salespersonId = sp?.id ?? null;
    }

    const createRaw = {
      jobNumber: p.jobNumber,
      year,
      leadNumber: p.leadNumber,
      name: p.name,
      contractSignedAt,
      contractAmount: new Prisma.Decimal(p.contractAmount.toFixed(2)),
      amountPaid: p.amountPaid != null ? new Prisma.Decimal(p.amountPaid.toFixed(2)) : null,
      changeOrders: new Prisma.Decimal(p.changeOrders.toFixed(2)),
      invoicedTotal: new Prisma.Decimal(p.invoicedTotal.toFixed(2)),
      projectRevenue: new Prisma.Decimal(p.projectRevenue.toFixed(2)),
      cost: new Prisma.Decimal(p.cost.toFixed(2)),
      gp: new Prisma.Decimal(p.gp.toFixed(2)),
      gpPercent: new Prisma.Decimal(p.gpPercent.toFixed(4)),
      retailPercent: decimalOrNull(p.retailPercent),
      insurancePercent: decimalOrNull(p.insurancePercent),
      invoiceFlag: p.invoiceFlag,
      paidInFull: p.paidInFull,
      updateMarker: p.updateMarker,
      commOwedFlag: p.commOwedFlag,
      status: normalizeStatus(p.statusRaw),
      drewParticipation: p.drewParticipation,
      paidDate: p.paidDate,
      salespersonId,
      sourceSheet: String(year),
    };
    const updateRaw = {
      leadNumber: p.leadNumber,
      name: p.name,
      contractSignedAt,
      contractAmount: new Prisma.Decimal(p.contractAmount.toFixed(2)),
      amountPaid: p.amountPaid != null ? new Prisma.Decimal(p.amountPaid.toFixed(2)) : null,
      changeOrders: new Prisma.Decimal(p.changeOrders.toFixed(2)),
      invoicedTotal: new Prisma.Decimal(p.invoicedTotal.toFixed(2)),
      projectRevenue: new Prisma.Decimal(p.projectRevenue.toFixed(2)),
      cost: new Prisma.Decimal(p.cost.toFixed(2)),
      gp: new Prisma.Decimal(p.gp.toFixed(2)),
      gpPercent: new Prisma.Decimal(p.gpPercent.toFixed(4)),
      retailPercent: decimalOrNull(p.retailPercent),
      insurancePercent: decimalOrNull(p.insurancePercent),
      invoiceFlag: p.invoiceFlag,
      paidInFull: p.paidInFull,
      updateMarker: p.updateMarker,
      commOwedFlag: p.commOwedFlag,
      status: normalizeStatus(p.statusRaw),
      drewParticipation: p.drewParticipation,
      paidDate: p.paidDate,
      salespersonId,
    };

    const upserted = await db.job.upsert({
      where: { jobNumber: p.jobNumber },
      create: pickJobScalarWriteFields(createRaw as Record<string, unknown>) as Prisma.JobCreateInput,
      update: pickJobScalarWriteFields(updateRaw as Record<string, unknown>) as Prisma.JobUpdateInput,
    });
    await recalculateJobAndCommissions(upserted.id);
    await db.jobEvent.create({
      data: {
        jobId: upserted.id,
        type: "JOB_SHEET_SYNC",
        source: "job-sheet-import",
        payload: {
          bookYear: year,
          contractSignedAt: contractSignedAt ? contractSignedAt.toISOString() : null,
          contractAmount: p.contractAmount,
          changeOrders: p.changeOrders,
          invoicedTotal: p.invoicedTotal,
          cost: p.cost,
          gp: p.gp,
        },
      },
    });
    imported++;
  }

  return {
    layout,
    headerRowUsed: headerIdx,
    dataStartUsed: dataStart,
    dataEndExclusive: dataEnd,
    imported,
    skippedNoLead,
    signedAtOk: signedOk,
    signedAtMissing: signedMissing,
  };
}
