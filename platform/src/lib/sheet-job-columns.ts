/**
 * Resolve Job Numbering “modern” tab column indices from the header row when labels differ slightly.
 * Falls back to the standard 2025/2026 layout (project A … update V).
 */

export type ModernJobColumnMap = {
  lead: number;
  jobNumber: number;
  name: number;
  date: number;
  contract: number;
  am: number;
  invoiced: number;
  amountPaid: number;
  changeOrders: number;
  cost: number;
  gp: number;
  gpPercent: number;
  retail: number;
  insurance: number;
  billed: number;
  paidInFull: number;
  commOwed: number;
  status: number;
  updateThis: number;
  drewParticipation: number;
  paidDate: number;
  projectRevenue: number;
};

/** Logical columns for the modern Job Numbering parser (0-based sheet column indices). */
export const MODERN_JOB_COLUMN_KEYS: (keyof ModernJobColumnMap)[] = [
  "lead",
  "jobNumber",
  "name",
  "date",
  "contract",
  "am",
  "invoiced",
  "amountPaid",
  "changeOrders",
  "cost",
  "gp",
  "gpPercent",
  "retail",
  "insurance",
  "billed",
  "paidInFull",
  "commOwed",
  "status",
  "updateThis",
  "drewParticipation",
  "paidDate",
  "projectRevenue",
];

/** Apply user overrides on top of header-resolved indices (modern layout only). */
export function mergeModernColumnMap(
  base: ModernJobColumnMap,
  overrides: Partial<Record<keyof ModernJobColumnMap, number>>
): ModernJobColumnMap {
  const out: ModernJobColumnMap = { ...base };
  for (const k of MODERN_JOB_COLUMN_KEYS) {
    const v = overrides[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Use when the user maps every modern column explicitly (no header-based template merge).
 * Throws with a clear list if any field is missing or invalid.
 */
export function buildModernColumnMapManualOnly(
  map: Partial<Record<keyof ModernJobColumnMap, number>>
): ModernJobColumnMap {
  const missing: string[] = [];
  const out = {} as ModernJobColumnMap;
  for (const k of MODERN_JOB_COLUMN_KEYS) {
    const v = map[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) missing.push(k);
    else out[k] = v;
  }
  if (missing.length) {
    throw new Error(
      `Manual-only column map needs a 0-based index (A=0) for every modern field. Missing or invalid: ${missing.join(", ")}`
    );
  }
  return out;
}

const DEFAULT_MODERN: ModernJobColumnMap = {
  lead: 0,
  jobNumber: 1,
  name: 2,
  date: 4,
  contract: 5,
  am: 8,
  invoiced: 9,
  amountPaid: 10,
  changeOrders: 11,
  cost: 12,
  gp: 13,
  gpPercent: 14,
  retail: 15,
  insurance: 16,
  billed: 17,
  paidInFull: 18,
  commOwed: 19,
  status: 20,
  updateThis: 21,
  projectRevenue: 23,
  drewParticipation: 26,
  paidDate: 28,
};

function normCell(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^\ufeff/, "")
    .toLowerCase();
}

/** Minimum row length to read core modern columns through Status (optional tail columns use `row.length` guards). */
const MODERN_CORE_KEYS: (keyof ModernJobColumnMap)[] = [
  "lead",
  "jobNumber",
  "name",
  "date",
  "contract",
  "am",
  "invoiced",
  "amountPaid",
  "changeOrders",
  "cost",
  "gp",
  "gpPercent",
  "retail",
  "insurance",
  "billed",
  "paidInFull",
  "commOwed",
  "status",
];

export function minModernCoreRowLength(col: ModernJobColumnMap): number {
  let max = 0;
  for (const k of MODERN_CORE_KEYS) {
    max = Math.max(max, col[k]);
  }
  return max + 1;
}

/** Widest column index across the full modern map (core + tail); use so rows are not rejected when tail cols are far right. */
export function minModernRowLength(col: ModernJobColumnMap): number {
  let max = 0;
  for (const k of MODERN_JOB_COLUMN_KEYS) {
    max = Math.max(max, col[k]);
  }
  return max + 1;
}

/**
 * Scan headers for “Comm Owed” vs “Update this” (or Zap wording) so checkboxes map correctly.
 */
function isFuzzyContractSignedDateHeader(h: string): boolean {
  if (!h.includes("date")) return false;
  if (h.includes("project") || h.includes("projected")) return false;
  if (h.includes("start") || h.includes("end")) return false;
  if (h.includes("last ") && h.includes("update")) return false;
  if (h.includes("invoice")) return false;
  if (h.includes("paid")) return false;
  return true;
}

/** Avoid matching "recorded" / "reordered" via a loose `includes("ord")` on change-order columns. */
function looksLikeChangeOrdersHeader(h: string): boolean {
  if (h === "co" || h === "c.o." || h === "c o") return true;
  if (/\bcost\b/.test(h) && /\bchange orders?\b/.test(h)) return false;
  return /\bchange orders?\b/.test(h) || /\bc\.?\s*o\.?\b/.test(h);
}

/**
 * Second-pass column detection from header cell text (0-based indices).
 * Merged after `resolveModernJobColumns` so template + date-shift stay, but mis-labeled columns can be fixed from labels.
 */
export function suggestModernJobColumnMapFromHeader(headerRow: unknown[]): Partial<ModernJobColumnMap> {
  const out: Partial<ModernJobColumnMap> = {};
  const taken = new Set<number>();

  const assign = (key: keyof ModernJobColumnMap, i: number) => {
    if (out[key] !== undefined || taken.has(i)) return;
    out[key] = i;
    taken.add(i);
  };

  for (let i = 0; i < headerRow.length; i++) {
    const h = normCell(headerRow[i]);
    if (!h) continue;

    if (h.includes("projected") || h.includes("project start") || h.includes("project end")) continue;
    if (h.includes("start date") && !h.includes("sign")) continue;
    if (h.includes("end date") && !h.includes("sign")) continue;

    if (
      (h.includes("job") && (h.includes("#") || h.includes("number") || h.includes("no"))) ||
      /^job\s*#/.test(h)
    ) {
      assign("jobNumber", i);
      continue;
    }
    if ((h.includes("project") || h.includes("lead")) && h.includes("#")) assign("lead", i);
    else if (h === "lead" || h === "lead #") assign("lead", i);
    else if (h.includes("customer") || h.includes("client") || h === "name" || h === "customer name")
      assign("name", i);
    else if (
      h === "date" ||
      h === "contract signed date" ||
      h === "signed date" ||
      h === "contract date" ||
      (h.includes("sign") && h.includes("date"))
    )
      assign("date", i);
    else if (
      (h.includes("contract") && (h.includes("amt") || h.includes("amount") || h.includes("$"))) ||
      h === "contract"
    )
      assign("contract", i);
    else if (h === "am" || (h.includes("account") && h.includes("manager")) || h.includes("sales rep"))
      assign("am", i);
    else if (h.includes("invoiced") || h === "invoiced total") assign("invoiced", i);
    else if (h.includes("amount") && h.includes("paid")) assign("amountPaid", i);
    else if (looksLikeChangeOrdersHeader(h)) assign("changeOrders", i);
    else if (h === "cost" || (h.includes("cost") && !h.includes("contract"))) assign("cost", i);
    else if (h.includes("gp") && (h.includes("%") || h.includes("percent"))) assign("gpPercent", i);
    else if (h === "gp" || h.includes("gross profit") || (h.includes("gp") && !h.includes("%")))
      assign("gp", i);
    else if (h.includes("retail")) assign("retail", i);
    else if (h.includes("insurance")) assign("insurance", i);
    else if (h.includes("billed") || (h.includes("invoice") && (h.includes("flag") || h.includes("sent"))))
      assign("billed", i);
    else if (h.includes("paid") && h.includes("full")) assign("paidInFull", i);
    else if (h.includes("comm") && h.includes("owed")) assign("commOwed", i);
    else if (h.includes("status")) assign("status", i);
    else if (h.includes("update") && (h.includes("this") || h.includes("zap"))) assign("updateThis", i);
    else if (h.includes("drew") && (h.includes("part") || h.includes("draw"))) assign("drewParticipation", i);
    else if (h.includes("paid") && h.includes("date") && !h.includes("full")) assign("paidDate", i);
    else if (h.includes("project") && (h.includes("revenue") || h.includes("rev"))) assign("projectRevenue", i);
    else if (h.includes("total") && h.includes("revenue")) assign("projectRevenue", i);
    else if (isFuzzyContractSignedDateHeader(h)) assign("date", i);
  }

  return out;
}

/** Columns from the template “Date” onward move together when an extra/missing column sits between Name and Date. */
const MODERN_DATE_ANCHOR = DEFAULT_MODERN.date;

export function resolveModernJobColumns(headerRow: unknown[]): ModernJobColumnMap {
  const map = { ...DEFAULT_MODERN };
  if (!headerRow?.length) return map;

  let commOwed: number | null = null;
  let updateThis: number | null = null;
  let amCol: number | null = null;
  let signedDateCol: number | null = null;

  for (let i = 0; i < headerRow.length; i++) {
    const h = normCell(headerRow[i]);
    if (!h) continue;
    if (h.includes("comm") && h.includes("owed")) commOwed = i;
    if (h.includes("update") && (h.includes("this") || h.includes("zap"))) updateThis = i;
    if (h === "am" || (h.includes("account") && h.includes("manager"))) amCol = i;
  }

  for (let i = 0; i < headerRow.length; i++) {
    const h = normCell(headerRow[i]);
    if (!h) continue;
    if (
      h === "date" ||
      h === "contract signed date" ||
      h === "signed date" ||
      h === "contract date"
    ) {
      signedDateCol = i;
      break;
    }
  }

  if (signedDateCol === null) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = normCell(headerRow[i]);
      if (!h) continue;
      if (isFuzzyContractSignedDateHeader(h)) {
        signedDateCol = i;
        break;
      }
    }
  }

  if (signedDateCol !== null) {
    const delta = signedDateCol - MODERN_DATE_ANCHOR;
    (Object.keys(DEFAULT_MODERN) as (keyof ModernJobColumnMap)[]).forEach((k) => {
      if (DEFAULT_MODERN[k] >= MODERN_DATE_ANCHOR) {
        map[k] = DEFAULT_MODERN[k] + delta;
      }
    });
    map.date = signedDateCol;
  }

  if (commOwed !== null) map.commOwed = commOwed;
  if (updateThis !== null) map.updateThis = updateThis;
  if (amCol !== null) map.am = amCol;

  return map;
}

export function cell(row: unknown[], col: number | undefined): unknown {
  if (col === undefined || col < 0) return undefined;
  if (!row || col >= row.length) return undefined;
  return row[col];
}
