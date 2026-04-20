/** Per-browser Jobs grid layout + row-highlight styling (localStorage). */

export const JOBS_TABLE_PREFS_STORAGE_KEY = "elevatedSheets.jobsTablePrefs.v1";

export const JOB_TABLE_COLUMN_IDS = [
  "jobNumber",
  "year",
  "leadNumber",
  "name",
  "sales",
  "status",
  "contract",
  "changeOrders",
  "invoiced",
  "amountPaid",
  "retail",
  "insurance",
  "cost",
  "paidInFull",
  "gp",
  "gpPct",
  "commPaid",
  "commOwed",
] as const;

export type JobTableColumnId = (typeof JOB_TABLE_COLUMN_IDS)[number];

export const JOB_TABLE_COLUMN_LABELS: Record<JobTableColumnId, string> = {
  jobNumber: "Job #",
  year: "Year",
  leadNumber: "Lead / project #",
  name: "Customer",
  sales: "Sales",
  status: "Status",
  contract: "Contract",
  changeOrders: "CO",
  invoiced: "Invoiced",
  amountPaid: "Amt paid",
  retail: "Retail %",
  insurance: "Ins. %",
  cost: "Cost",
  paidInFull: "Paid in full",
  gp: "GP",
  gpPct: "GP %",
  commPaid: "Comm. paid",
  commOwed: "Comm. owed",
};

export type HlColors = {
  border: string;
  rowBg: string;
  legendBg: string;
  legendText: string;
};

export type JobsTableHighlightPrefs = {
  strongGpPct: number;
  thinGpPct: number;
  /** Lower bound for GP% when status includes COMPLETE (green highlight). */
  completeMinGpPct: number;
  /** Minimum revenue (contract+CO, invoiced, or project revenue) before GP% band highlights apply. */
  minRevenue: number;
  colors: {
    good: HlColors;
    bad: HlColors;
    warn: HlColors;
  };
};

export type JobsTablePrefsV1 = {
  version: 1;
  columnOrder: JobTableColumnId[];
  hiddenColumns: JobTableColumnId[];
  highlights: JobsTableHighlightPrefs;
};

const DEFAULT_COLORS: JobsTableHighlightPrefs["colors"] = {
  good: {
    border: "#22c55e",
    rowBg: "rgba(34, 197, 94, 0.07)",
    legendBg: "rgba(34, 197, 94, 0.2)",
    legendText: "#86efac",
  },
  bad: {
    border: "#ef4444",
    rowBg: "rgba(239, 68, 68, 0.08)",
    legendBg: "rgba(239, 68, 68, 0.2)",
    legendText: "#fca5a5",
  },
  warn: {
    border: "#eab308",
    rowBg: "rgba(234, 179, 8, 0.08)",
    legendBg: "rgba(234, 179, 8, 0.2)",
    legendText: "#fde047",
  },
};

export const DEFAULT_JOBS_TABLE_PREFS: JobsTablePrefsV1 = {
  version: 1,
  columnOrder: [...JOB_TABLE_COLUMN_IDS],
  hiddenColumns: [],
  highlights: {
    strongGpPct: 35,
    thinGpPct: 15,
    completeMinGpPct: 25,
    minRevenue: 500,
    colors: DEFAULT_COLORS,
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseHlColors(v: unknown, fallback: HlColors): HlColors {
  if (!isRecord(v)) return fallback;
  const border = typeof v.border === "string" ? v.border : fallback.border;
  const rowBg = typeof v.rowBg === "string" ? v.rowBg : fallback.rowBg;
  const legendBg = typeof v.legendBg === "string" ? v.legendBg : fallback.legendBg;
  const legendText = typeof v.legendText === "string" ? v.legendText : fallback.legendText;
  return { border, rowBg, legendBg, legendText };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseColumnId(v: unknown): JobTableColumnId | null {
  if (typeof v !== "string") return null;
  return (JOB_TABLE_COLUMN_IDS as readonly string[]).includes(v) ? (v as JobTableColumnId) : null;
}

export function normalizeJobsTablePrefs(raw: unknown): JobsTablePrefsV1 {
  const base = DEFAULT_JOBS_TABLE_PREFS;
  if (!isRecord(raw) || raw.version !== 1) return structuredClone(base);

  const orderIn = Array.isArray(raw.columnOrder) ? raw.columnOrder : [];
  const orderParsed = orderIn.map(parseColumnId).filter(Boolean) as JobTableColumnId[];
  const orderSet = new Set(orderParsed);
  const columnOrder: JobTableColumnId[] = [
    ...orderParsed,
    ...JOB_TABLE_COLUMN_IDS.filter((id) => !orderSet.has(id)),
  ];

  const hiddenIn = Array.isArray(raw.hiddenColumns) ? raw.hiddenColumns : [];
  const hiddenColumns = hiddenIn.map(parseColumnId).filter(Boolean) as JobTableColumnId[];

  const hlRaw = isRecord(raw.highlights) ? raw.highlights : {};
  const colorsRaw = isRecord(hlRaw.colors) ? hlRaw.colors : {};
  const highlights: JobsTableHighlightPrefs = {
    strongGpPct: clamp(Number(hlRaw.strongGpPct), 0, 100) || base.highlights.strongGpPct,
    thinGpPct: clamp(Number(hlRaw.thinGpPct), 0, 100) || base.highlights.thinGpPct,
    completeMinGpPct: clamp(Number(hlRaw.completeMinGpPct), 0, 100) || base.highlights.completeMinGpPct,
    minRevenue: Math.max(0, Number(hlRaw.minRevenue) || base.highlights.minRevenue),
    colors: {
      good: parseHlColors(colorsRaw.good, base.highlights.colors.good),
      bad: parseHlColors(colorsRaw.bad, base.highlights.colors.bad),
      warn: parseHlColors(colorsRaw.warn, base.highlights.colors.warn),
    },
  };

  if (highlights.thinGpPct > highlights.strongGpPct) {
    const t = highlights.thinGpPct;
    highlights.thinGpPct = highlights.strongGpPct;
    highlights.strongGpPct = t;
  }

  return { version: 1, columnOrder, hiddenColumns, highlights };
}

export function loadJobsTablePrefsFromStorage(): JobsTablePrefsV1 {
  if (typeof window === "undefined") return structuredClone(DEFAULT_JOBS_TABLE_PREFS);
  try {
    const s = window.localStorage.getItem(JOBS_TABLE_PREFS_STORAGE_KEY);
    if (!s) return structuredClone(DEFAULT_JOBS_TABLE_PREFS);
    return normalizeJobsTablePrefs(JSON.parse(s) as unknown);
  } catch {
    return structuredClone(DEFAULT_JOBS_TABLE_PREFS);
  }
}

export function saveJobsTablePrefsToStorage(prefs: JobsTablePrefsV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(JOBS_TABLE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function visibleColumnOrder(prefs: JobsTablePrefsV1): JobTableColumnId[] {
  const hidden = new Set(prefs.hiddenColumns);
  const seen = new Set<JobTableColumnId>();
  const out: JobTableColumnId[] = [];
  for (const id of prefs.columnOrder) {
    if (hidden.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of JOB_TABLE_COLUMN_IDS) {
    if (hidden.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
