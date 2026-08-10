import { Prisma, type PrismaClient } from "@prisma/client";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";
import { normalizeStatus } from "@/lib/status";

/** Fields that can be reported / applied from a ProLine projects CSV. */
export const PROLINE_CSV_COMPARE_FIELDS = [
  "jobNumber",
  "leadNumber",
  "prolineJobId",
  "name",
  "status",
  "prolineStage",
  "contractAmount",
  "cost",
  "costingComplete",
  "amountPaid",
  "invoicedTotal",
] as const;

export type ProlineCsvCompareField = (typeof PROLINE_CSV_COMPARE_FIELDS)[number];

/** Default apply set: identity + status + money, excluding high-caution jobNumber. */
export const DEFAULT_APPLY_FIELDS: ProlineCsvCompareField[] = [
  "leadNumber",
  "prolineJobId",
  "name",
  "status",
  "prolineStage",
  "contractAmount",
  "cost",
  "costingComplete",
  "amountPaid",
  "invoicedTotal",
];

const FIELD_SET = new Set<string>(PROLINE_CSV_COMPARE_FIELDS);

export type MatchKey = "leadNumber" | "prolineJobId" | "jobNumber";

export type ProlineCsvRemoteValues = {
  jobNumber?: string;
  leadNumber?: string;
  prolineJobId?: string;
  name?: string;
  /** Normalized lifecycle status (SOLD, COMPLETE, …). */
  status?: string;
  /** Raw ProLine pipeline stage from CSV Stage column. */
  prolineStage?: string;
  contractAmount?: number;
  cost?: number;
  costingComplete?: boolean;
  amountPaid?: number;
  invoicedTotal?: number;
};

export type ProlineCsvLocalValues = {
  jobNumber: string;
  leadNumber: string | null;
  prolineJobId: string | null;
  name: string | null;
  status: string;
  prolineStage: string | null;
  contractAmount: number;
  cost: number;
  costingComplete: boolean;
  amountPaid: number | null;
  invoicedTotal: number;
};

export type ProlineCsvMismatch = {
  jobId: string;
  jobNumber: string;
  matchKey: MatchKey;
  fields: ProlineCsvCompareField[];
  local: ProlineCsvLocalValues;
  remote: ProlineCsvRemoteValues;
};

export type ProlineCsvMissingLocal = {
  matchAttempt: MatchKey | "none";
  jobNumber?: string;
  leadNumber?: string;
  prolineJobId?: string;
  name?: string;
};

export type ProlineCsvOrphanLocal = {
  jobId: string;
  jobNumber: string;
  leadNumber: string | null;
  prolineJobId: string | null;
};

export type CompareProlineCsvOpts = {
  csvText: string;
  apply: boolean;
  /** Subset of fields to apply (and to filter mismatch reporting when applying). Defaults to DEFAULT_APPLY_FIELDS when apply=true. */
  fields?: ProlineCsvCompareField[];
  tolerance?: number;
  /** Cap mismatch samples in the result (default 200). */
  sampleLimit?: number;
  /** When set, only these job IDs are updated on apply (and counted as mismatches if they differ). */
  onlyJobIds?: string[];
};

export type CompareProlineCsvResult = {
  rowsSeen: number;
  matchedJobs: number;
  mismatches: number;
  updated: number;
  missingLocalCount: number;
  orphanLocalCount: number;
  errors: string[];
  samples: ProlineCsvMismatch[];
  missingLocalSamples: ProlineCsvMissingLocal[];
  orphanLocalSamples: ProlineCsvOrphanLocal[];
};

type ParsedCsvRow = {
  jobNumber?: string;
  leadNumber?: string;
  prolineJobId?: string;
  name?: string;
  /** Raw ProLine Status column (won, complete, open, …). */
  statusRaw?: string;
  /** Raw ProLine Stage column. */
  stageRaw?: string;
  approvedValue?: number;
  contractValue?: number;
  projectCosts?: number;
  costingComplete?: boolean;
  netRevenue?: number;
  grossRevenue?: number;
  accountsReceivable?: number;
};

type JobSelect = {
  id: string;
  jobNumber: string;
  leadNumber: string | null;
  prolineJobId: string | null;
  name: string | null;
  status: string;
  prolineStage: string | null;
  contractAmount: Prisma.Decimal;
  cost: Prisma.Decimal;
  costingComplete: boolean;
  amountPaid: Prisma.Decimal | null;
  invoicedTotal: Prisma.Decimal;
};

const JOB_SELECT = {
  id: true,
  jobNumber: true,
  leadNumber: true,
  prolineJobId: true,
  name: true,
  status: true,
  prolineStage: true,
  contractAmount: true,
  cost: true,
  costingComplete: true,
  amountPaid: true,
  invoicedTotal: true,
} as const;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Map ProLine export headers → internal keys. */
const HEADER_MAP: Record<string, keyof ParsedCsvRow> = {
  "project name": "name",
  "job number": "jobNumber",
  "job number2": "jobNumber",
  "project number": "leadNumber",
  "proline project id": "prolineJobId",
  status: "statusRaw",
  stage: "stageRaw",
  "approved value": "approvedValue",
  "contract value": "contractValue",
  "project costs": "projectCosts",
  "costing complete": "costingComplete",
  "net revenue": "netRevenue",
  "gross revenue": "grossRevenue",
  "accounts receivable": "accountsReceivable",
};

function parseMoney(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const n = parseFloat(s.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
}

function parseStr(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const s = raw.trim();
  return s || undefined;
}

/**
 * RFC4180-ish CSV parse: handles quoted fields, escaped quotes, CRLF/LF.
 * Returns rows as string arrays (including header).
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function mapCsvRowsToParsed(rows: string[][]): ParsedCsvRow[] {
  if (rows.length === 0) return [];
  const header = rows[0].map(normalizeHeader);
  const indexes: Partial<Record<keyof ParsedCsvRow, number>> = {};
  for (let col = 0; col < header.length; col++) {
    const h = header[col];
    if (!h || h.startsWith("column")) continue;
    const key = HEADER_MAP[h];
    if (key && indexes[key] === undefined) indexes[key] = col;
  }

  const out: ParsedCsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => !c?.trim())) continue;
    const get = (k: keyof ParsedCsvRow): string | undefined => {
      const idx = indexes[k];
      if (idx === undefined) return undefined;
      return cells[idx];
    };
    out.push({
      name: parseStr(get("name")),
      jobNumber: parseStr(get("jobNumber")),
      leadNumber: parseStr(get("leadNumber")),
      prolineJobId: parseStr(get("prolineJobId")),
      statusRaw: parseStr(get("statusRaw")),
      stageRaw: parseStr(get("stageRaw")),
      approvedValue: parseMoney(get("approvedValue")),
      contractValue: parseMoney(get("contractValue")),
      projectCosts: parseMoney(get("projectCosts")),
      costingComplete: parseBool(get("costingComplete")),
      netRevenue: parseMoney(get("netRevenue")),
      grossRevenue: parseMoney(get("grossRevenue")),
      accountsReceivable: parseMoney(get("accountsReceivable")),
    });
  }
  return out;
}

export function remoteValuesFromParsed(row: ParsedCsvRow): ProlineCsvRemoteValues {
  const contractAmount =
    row.approvedValue !== undefined ? row.approvedValue : row.contractValue;
  let invoicedTotal = row.grossRevenue;
  if (invoicedTotal === undefined) {
    if (row.netRevenue !== undefined || row.accountsReceivable !== undefined) {
      invoicedTotal = Math.max(0, (row.netRevenue ?? 0) + (row.accountsReceivable ?? 0));
    }
  }
  return {
    jobNumber: row.jobNumber,
    leadNumber: row.leadNumber,
    prolineJobId: row.prolineJobId,
    name: row.name,
    status: row.statusRaw ? normalizeStatus(row.statusRaw) : undefined,
    prolineStage: row.stageRaw,
    contractAmount,
    cost: row.projectCosts,
    costingComplete: row.costingComplete,
    amountPaid: row.netRevenue,
    invoicedTotal,
  };
}

function approxEqual(a: number | null | undefined, b: number | null | undefined, tolerance: number): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

function namesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  return na === nb;
}

function localSnapshot(job: JobSelect): ProlineCsvLocalValues {
  return {
    jobNumber: job.jobNumber,
    leadNumber: job.leadNumber,
    prolineJobId: job.prolineJobId,
    name: job.name,
    status: job.status,
    prolineStage: job.prolineStage,
    contractAmount: job.contractAmount.toNumber(),
    cost: job.cost.toNumber(),
    costingComplete: job.costingComplete,
    amountPaid: job.amountPaid ? job.amountPaid.toNumber() : null,
    invoicedTotal: job.invoicedTotal.toNumber(),
  };
}

function statusEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
}

function stageEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function diffFields(
  local: ProlineCsvLocalValues,
  remote: ProlineCsvRemoteValues,
  tolerance: number
): ProlineCsvCompareField[] {
  const changed: ProlineCsvCompareField[] = [];

  if (remote.jobNumber !== undefined && remote.jobNumber !== local.jobNumber) {
    changed.push("jobNumber");
  }
  if (remote.leadNumber !== undefined && (local.leadNumber ?? "") !== remote.leadNumber) {
    changed.push("leadNumber");
  }
  if (remote.prolineJobId !== undefined && (local.prolineJobId ?? "") !== remote.prolineJobId) {
    changed.push("prolineJobId");
  }
  if (remote.name !== undefined && !namesEqual(local.name, remote.name)) {
    changed.push("name");
  }
  if (remote.status !== undefined && !statusEqual(local.status, remote.status)) {
    changed.push("status");
  }
  if (remote.prolineStage !== undefined && !stageEqual(local.prolineStage, remote.prolineStage)) {
    changed.push("prolineStage");
  }
  if (remote.contractAmount !== undefined && !approxEqual(local.contractAmount, remote.contractAmount, tolerance)) {
    changed.push("contractAmount");
  }
  if (remote.cost !== undefined && !approxEqual(local.cost, remote.cost, tolerance)) {
    changed.push("cost");
  }
  if (remote.costingComplete !== undefined && local.costingComplete !== remote.costingComplete) {
    changed.push("costingComplete");
  }
  if (remote.amountPaid !== undefined && !approxEqual(local.amountPaid, remote.amountPaid, tolerance)) {
    changed.push("amountPaid");
  }
  if (remote.invoicedTotal !== undefined && !approxEqual(local.invoicedTotal, remote.invoicedTotal, tolerance)) {
    changed.push("invoicedTotal");
  }

  return changed;
}

export function parseCompareFields(raw: string[] | string | undefined | null): ProlineCsvCompareField[] | undefined {
  if (raw == null) return undefined;
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const out: ProlineCsvCompareField[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (!FIELD_SET.has(t)) continue;
    if (!out.includes(t as ProlineCsvCompareField)) out.push(t as ProlineCsvCompareField);
  }
  return out.length ? out : undefined;
}

async function findLocalJob(
  db: PrismaClient,
  row: ParsedCsvRow
): Promise<{ job: JobSelect; matchKey: MatchKey } | null> {
  if (row.leadNumber) {
    const leadNorm = row.leadNumber;
    const byLead = await db.job.findFirst({
      where: {
        OR: [{ leadNumber: leadNorm }, { leadNumber: { equals: leadNorm, mode: "insensitive" } }],
      },
      select: JOB_SELECT,
    });
    if (byLead) return { job: byLead, matchKey: "leadNumber" };
  }
  if (row.prolineJobId) {
    const byId = await db.job.findFirst({
      where: { prolineJobId: row.prolineJobId },
      select: JOB_SELECT,
    });
    if (byId) return { job: byId, matchKey: "prolineJobId" };
  }
  if (row.jobNumber) {
    const byJob = await db.job.findFirst({
      where: { jobNumber: row.jobNumber },
      select: JOB_SELECT,
    });
    if (byJob) return { job: byJob, matchKey: "jobNumber" };
  }
  return null;
}

function buildUpdateData(
  fields: ProlineCsvCompareField[],
  remote: ProlineCsvRemoteValues
): Prisma.JobUpdateInput {
  const data: Prisma.JobUpdateInput = {};
  for (const f of fields) {
    switch (f) {
      case "jobNumber":
        if (remote.jobNumber) data.jobNumber = remote.jobNumber;
        break;
      case "leadNumber":
        if (remote.leadNumber) data.leadNumber = remote.leadNumber;
        break;
      case "prolineJobId":
        if (remote.prolineJobId) data.prolineJobId = remote.prolineJobId;
        break;
      case "name":
        if (remote.name) data.name = remote.name;
        break;
      case "status":
        if (remote.status) data.status = remote.status;
        break;
      case "prolineStage":
        if (remote.prolineStage) data.prolineStage = remote.prolineStage;
        break;
      case "contractAmount":
        if (remote.contractAmount !== undefined) {
          data.contractAmount = new Prisma.Decimal(remote.contractAmount.toFixed(2));
        }
        break;
      case "cost":
        if (remote.cost !== undefined) {
          data.cost = new Prisma.Decimal(remote.cost.toFixed(2));
        }
        break;
      case "costingComplete":
        if (remote.costingComplete !== undefined) data.costingComplete = remote.costingComplete;
        break;
      case "amountPaid":
        if (remote.amountPaid !== undefined) {
          data.amountPaid = new Prisma.Decimal(remote.amountPaid.toFixed(2));
        }
        break;
      case "invoicedTotal":
        if (remote.invoicedTotal !== undefined) {
          data.invoicedTotal = new Prisma.Decimal(remote.invoicedTotal.toFixed(2));
        }
        break;
    }
  }
  return data;
}

/**
 * Compare a ProLine projects CSV export against local Job rows.
 * Dry-run by default (`apply: false`); when applying, only writes requested fields
 * and never overwrites with blank remote values.
 */
export async function compareProlineCsvToJobs(
  db: PrismaClient,
  opts: CompareProlineCsvOpts
): Promise<CompareProlineCsvResult> {
  const tolerance = opts.tolerance ?? 0.005;
  const sampleLimit = opts.sampleLimit ?? 200;
  const applyFields = opts.fields ?? (opts.apply ? DEFAULT_APPLY_FIELDS : [...PROLINE_CSV_COMPARE_FIELDS]);
  const onlyJobIds = opts.onlyJobIds?.length ? new Set(opts.onlyJobIds) : null;

  const result: CompareProlineCsvResult = {
    rowsSeen: 0,
    matchedJobs: 0,
    mismatches: 0,
    updated: 0,
    missingLocalCount: 0,
    orphanLocalCount: 0,
    errors: [],
    samples: [],
    missingLocalSamples: [],
    orphanLocalSamples: [],
  };

  let parsed: ParsedCsvRow[];
  try {
    const grid = parseCsvText(opts.csvText);
    parsed = mapCsvRowsToParsed(grid);
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }

  result.rowsSeen = parsed.length;

  const csvLeadNumbers = new Set<string>();
  const csvProlineIds = new Set<string>();

  for (const row of parsed) {
    if (row.leadNumber) csvLeadNumbers.add(row.leadNumber.toLowerCase());
    if (row.prolineJobId) csvProlineIds.add(row.prolineJobId);

    const matched = await findLocalJob(db, row);
    if (!matched) {
      result.missingLocalCount += 1;
      if (result.missingLocalSamples.length < 50) {
        const matchAttempt: MatchKey | "none" = row.leadNumber
          ? "leadNumber"
          : row.prolineJobId
            ? "prolineJobId"
            : row.jobNumber
              ? "jobNumber"
              : "none";
        result.missingLocalSamples.push({
          matchAttempt,
          jobNumber: row.jobNumber,
          leadNumber: row.leadNumber,
          prolineJobId: row.prolineJobId,
          name: row.name,
        });
      }
      continue;
    }

    result.matchedJobs += 1;
    const { job, matchKey } = matched;
    if (onlyJobIds && !onlyJobIds.has(job.id)) continue;

    const remote = remoteValuesFromParsed(row);
    const local = localSnapshot(job);
    const allChanged = diffFields(local, remote, tolerance);
    const changed = allChanged.filter((f) => applyFields.includes(f));
    if (!changed.length) continue;

    result.mismatches += 1;
    if (result.samples.length < sampleLimit) {
      result.samples.push({
        jobId: job.id,
        jobNumber: job.jobNumber,
        matchKey,
        fields: changed,
        local,
        remote,
      });
    }

    if (!opts.apply) continue;

    const data = buildUpdateData(changed, remote);
    if (Object.keys(data).length === 0) continue;

    try {
      await db.job.update({ where: { id: job.id }, data });
      await db.jobEvent.create({
        data: {
          jobId: job.id,
          type: "PROLINE_CSV_COMPARE",
          source: "proline_csv",
          payload: {
            matchKey,
            changed,
            local,
            remote,
          },
        },
      });
      const paymentFieldsChanged =
        changed.includes("amountPaid") ||
        changed.includes("invoicedTotal") ||
        changed.includes("contractAmount") ||
        changed.includes("cost");
      await recalculateJobAndCommissions(job.id, {
        forceCommissionRecalc: paymentFieldsChanged,
        forceCommissionRecalcReason: "proline.csv_compare.changed_money_fields",
      });
      result.updated += 1;
    } catch (e) {
      result.errors.push(
        `Failed to update job ${job.jobNumber}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Orphan locals: jobs with proline/lead identifiers not present in this CSV export.
  try {
    const locals = await db.job.findMany({
      where: {
        OR: [{ prolineJobId: { not: null } }, { leadNumber: { not: null } }],
      },
      select: { id: true, jobNumber: true, leadNumber: true, prolineJobId: true },
      take: 5000,
    });
    for (const j of locals) {
      const leadOk = j.leadNumber ? csvLeadNumbers.has(j.leadNumber.toLowerCase()) : false;
      const idOk = j.prolineJobId ? csvProlineIds.has(j.prolineJobId) : false;
      if (leadOk || idOk) continue;
      // Only flag if the job has at least one identifier we could have matched from CSV.
      if (!j.leadNumber && !j.prolineJobId) continue;
      result.orphanLocalCount += 1;
      if (result.orphanLocalSamples.length < 50) {
        result.orphanLocalSamples.push({
          jobId: j.id,
          jobNumber: j.jobNumber,
          leadNumber: j.leadNumber,
          prolineJobId: j.prolineJobId,
        });
      }
    }
  } catch (e) {
    result.errors.push(`Orphan scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
