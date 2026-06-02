import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { canRunFullReports, canViewEndOfJobFormAnalytics } from "@/lib/rbac";
import { displaySalespersonName } from "@/lib/salesperson-name";
import {
  parseEndOfJobFormConfig,
  type EndOfJobFormField,
  type EndOfJobFormConfig,
} from "@/lib/end-of-job-form";
import {
  CONTRACT_SIGN_CHART_TIMEZONE,
  CONTRACT_SIGN_MONTH_LABELS,
  signedCalendarMonthForChart,
} from "@/lib/contract-signed-month";

const UNANSWERED = "Unanswered";
const OTHER = "Other";
const NO_REP = "— No rep —";

export type EojFunnelSummary = {
  required: number;
  submitted: number;
  pending: number;
  completionRate: number | null;
  avgDaysToSubmit: number | null;
};

export type EojCountBucket = { label: string; count: number };

export type EojSelectFieldAnalytics = {
  fieldId: string;
  label: string;
  options: string[];
  overall: EojCountBucket[];
  byRep: Array<{
    salespersonId: string | null;
    repName: string;
    total: number;
    counts: EojCountBucket[];
  }>;
};

export type EojBooleanFieldAnalytics = {
  fieldId: string;
  label: string;
  overall: { yes: number; no: number; unanswered: number };
  byRep: Array<{
    salespersonId: string | null;
    repName: string;
    yes: number;
    no: number;
    unanswered: number;
  }>;
};

export type EojNumberFieldAnalytics = {
  fieldId: string;
  label: string;
  answered: number;
  sum: number;
  average: number | null;
};

export type EojTextFieldFootnote = {
  fieldId: string;
  label: string;
  answered: number;
};

export type EojSubmissionTrendPoint = {
  month: string;
  monthIndex: number;
  count: number;
};

export type EojSalespersonOption = { id: string; name: string };

export type EndOfJobFormAnalytics = {
  scope: "company" | "mine";
  year: number | null;
  salespersonId: string | null;
  submittedFrom: string | null;
  submittedTo: string | null;
  availableYears: number[];
  salespersonOptions: EojSalespersonOption[];
  formSchema: EndOfJobFormConfig;
  funnel: EojFunnelSummary;
  selectFields: EojSelectFieldAnalytics[];
  booleanFields: EojBooleanFieldAnalytics[];
  numberFields: EojNumberFieldAnalytics[];
  textFootnotes: EojTextFieldFootnote[];
  submissionTrend: EojSubmissionTrendPoint[];
};

export type EndOfJobFormAnalyticsOpts = {
  year?: number | null;
  salespersonId?: string | null;
  submittedFrom?: Date | null;
  submittedTo?: Date | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readResponses(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_meta") continue;
    out[k] = v;
  }
  return out;
}

function isMissingValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function coerceBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return null;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function classifySelectValue(
  raw: unknown,
  options: string[]
): string {
  if (isMissingValue(raw)) return UNANSWERED;
  const s = String(raw).trim();
  if (!s) return UNANSWERED;
  if (options.includes(s)) return s;
  return OTHER;
}

function initCountMap(labels: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of labels) m.set(l, 0);
  return m;
}

function bump(m: Map<string, number>, key: string) {
  m.set(key, (m.get(key) ?? 0) + 1);
}

function mapToBuckets(m: Map<string, number>, order: string[]): EojCountBucket[] {
  const seen = new Set(order);
  const rows: EojCountBucket[] = order.map((label) => ({
    label,
    count: m.get(label) ?? 0,
  }));
  for (const [label, count] of m) {
    if (!seen.has(label) && count > 0) rows.push({ label, count });
  }
  return rows.filter((r) => r.count > 0 || order.includes(r.label));
}

type JobRow = {
  id: string;
  year: number;
  endOfJobFormRequiredAt: Date | null;
  endOfJobFormSubmittedAt: Date | null;
  endOfJobFormResponses: unknown;
  salespersonId: string | null;
  salesperson: { id: string; name: string } | null;
};

function buildScopeWhere(
  user: SessionUser,
  opts: EndOfJobFormAnalyticsOpts
): Prisma.JobWhereInput | { error: "forbidden" } {
  const full = canRunFullReports(user);
  const repIds = user.salespersonIds;

  if (!full && repIds.length === 0) return { error: "forbidden" };

  const parts: Prisma.JobWhereInput[] = [];

  if (!full) {
    parts.push({ salespersonId: { in: repIds } });
  } else if (opts.salespersonId?.trim()) {
    parts.push({ salespersonId: opts.salespersonId.trim() });
  }

  if (opts.year != null && Number.isFinite(opts.year)) {
    parts.push({ year: opts.year });
  }

  if (opts.submittedFrom || opts.submittedTo) {
    const submittedAt: Prisma.DateTimeFilter = {};
    if (opts.submittedFrom) submittedAt.gte = opts.submittedFrom;
    if (opts.submittedTo) submittedAt.lte = opts.submittedTo;
    parts.push({ endOfJobFormSubmittedAt: submittedAt });
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return { AND: parts };
}

function repKey(job: JobRow): { id: string | null; name: string } {
  if (!job.salesperson) return { id: null, name: NO_REP };
  return {
    id: job.salesperson.id,
    name: displaySalespersonName(job.salesperson.name),
  };
}

function selectBucketOrder(field: EndOfJobFormField): string[] {
  const opts = field.options ?? [];
  return [...opts, OTHER, UNANSWERED];
}

function aggregateSelectField(
  field: EndOfJobFormField,
  submittedJobs: JobRow[]
): EojSelectFieldAnalytics {
  const order = selectBucketOrder(field);
  const overall = initCountMap(order);
  const byRepMap = new Map<
    string,
    { salespersonId: string | null; repName: string; counts: Map<string, number> }
  >();

  for (const job of submittedJobs) {
    const responses = readResponses(job.endOfJobFormResponses);
    const bucket = classifySelectValue(responses[field.id], field.options ?? []);
    bump(overall, bucket);

    const rk = repKey(job);
    const mapKey = rk.id ?? `__none__:${rk.name}`;
    let repRow = byRepMap.get(mapKey);
    if (!repRow) {
      repRow = {
        salespersonId: rk.id,
        repName: rk.name,
        counts: initCountMap(order),
      };
      byRepMap.set(mapKey, repRow);
    }
    bump(repRow.counts, bucket);
  }

  const byRep = [...byRepMap.values()]
    .map((r) => {
      const counts = mapToBuckets(r.counts, order);
      const total = counts.reduce((s, c) => s + c.count, 0);
      return {
        salespersonId: r.salespersonId,
        repName: r.repName,
        total,
        counts,
      };
    })
    .sort((a, b) => b.total - a.total || a.repName.localeCompare(b.repName));

  return {
    fieldId: field.id,
    label: field.label,
    options: field.options ?? [],
    overall: mapToBuckets(overall, order).filter((b) => b.count > 0),
    byRep,
  };
}

function aggregateBooleanField(
  field: EndOfJobFormField,
  submittedJobs: JobRow[]
): EojBooleanFieldAnalytics {
  const overall = { yes: 0, no: 0, unanswered: 0 };
  const byRepMap = new Map<
    string,
    {
      salespersonId: string | null;
      repName: string;
      yes: number;
      no: number;
      unanswered: number;
    }
  >();

  for (const job of submittedJobs) {
    const responses = readResponses(job.endOfJobFormResponses);
    const raw = responses[field.id];
    const rk = repKey(job);
    const mapKey = rk.id ?? `__none__:${rk.name}`;
    let repRow = byRepMap.get(mapKey);
    if (!repRow) {
      repRow = { salespersonId: rk.id, repName: rk.name, yes: 0, no: 0, unanswered: 0 };
      byRepMap.set(mapKey, repRow);
    }

    if (isMissingValue(raw)) {
      overall.unanswered += 1;
      repRow.unanswered += 1;
    } else {
      const b = coerceBoolean(raw);
      if (b === true) {
        overall.yes += 1;
        repRow.yes += 1;
      } else if (b === false) {
        overall.no += 1;
        repRow.no += 1;
      } else {
        overall.unanswered += 1;
        repRow.unanswered += 1;
      }
    }
  }

  return {
    fieldId: field.id,
    label: field.label,
    overall,
    byRep: [...byRepMap.values()].sort((a, b) => {
      const ta = a.yes + a.no + a.unanswered;
      const tb = b.yes + b.no + b.unanswered;
      return tb - ta || a.repName.localeCompare(b.repName);
    }),
  };
}

function aggregateNumberField(
  field: EndOfJobFormField,
  submittedJobs: JobRow[]
): EojNumberFieldAnalytics {
  let answered = 0;
  let sum = 0;
  for (const job of submittedJobs) {
    const responses = readResponses(job.endOfJobFormResponses);
    const n = coerceNumber(responses[field.id]);
    if (n === null) continue;
    answered += 1;
    sum += n;
  }
  return {
    fieldId: field.id,
    label: field.label,
    answered,
    sum,
    average: answered > 0 ? sum / answered : null,
  };
}

function buildSubmissionTrend(submittedJobs: JobRow[], trendYear: number | null): EojSubmissionTrendPoint[] {
  const byMonth = new Map<number, number>();
  for (let i = 1; i <= 12; i++) byMonth.set(i, 0);

  for (const job of submittedJobs) {
    const at = job.endOfJobFormSubmittedAt;
    if (!at) continue;
    if (trendYear != null) {
      const y = parseInt(
        at.toLocaleString("en-US", { timeZone: CONTRACT_SIGN_CHART_TIMEZONE, year: "numeric" }),
        10
      );
      if (y !== trendYear) continue;
    }
    const mo = signedCalendarMonthForChart(at);
    byMonth.set(mo, (byMonth.get(mo) ?? 0) + 1);
  }

  return CONTRACT_SIGN_MONTH_LABELS.map((month, i) => ({
    month,
    monthIndex: i + 1,
    count: byMonth.get(i + 1) ?? 0,
  }));
}

export async function getEndOfJobFormAnalytics(
  user: SessionUser,
  opts: EndOfJobFormAnalyticsOpts
): Promise<EndOfJobFormAnalytics | { error: "forbidden" }> {
  if (!canViewEndOfJobFormAnalytics(user)) {
    return { error: "forbidden" };
  }

  const scopeWhere = buildScopeWhere(user, opts);
  if ("error" in scopeWhere) return scopeWhere;

  const cfgRow = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { endOfJobForm: true },
  });
  const parsedForm = parseEndOfJobFormConfig(cfgRow?.endOfJobForm);
  const formSchema: EndOfJobFormConfig = parsedForm.ok ? parsedForm.value : { version: 1, fields: [] };

  const funnelWhere: Prisma.JobWhereInput = {
    ...scopeWhere,
    endOfJobFormRequiredAt: { not: null },
  };

  const submittedWhere: Prisma.JobWhereInput = {
    ...scopeWhere,
    endOfJobFormSubmittedAt: { not: null },
  };

  const [funnelJobs, submittedJobs, yearRows] = await Promise.all([
    prisma.job.findMany({
      where: funnelWhere,
      select: {
        id: true,
        year: true,
        endOfJobFormRequiredAt: true,
        endOfJobFormSubmittedAt: true,
        endOfJobFormResponses: true,
        salespersonId: true,
        salesperson: { select: { id: true, name: true } },
      },
      take: 10000,
    }),
    prisma.job.findMany({
      where: submittedWhere,
      select: {
        id: true,
        year: true,
        endOfJobFormRequiredAt: true,
        endOfJobFormSubmittedAt: true,
        endOfJobFormResponses: true,
        salespersonId: true,
        salesperson: { select: { id: true, name: true } },
      },
      take: 10000,
    }),
    prisma.job.findMany({
      where: {
        ...scopeWhere,
        OR: [
          { endOfJobFormRequiredAt: { not: null } },
          { endOfJobFormSubmittedAt: { not: null } },
        ],
      },
      select: { year: true },
      distinct: ["year"],
      take: 50,
    }),
  ]);

  const required = funnelJobs.length;
  const submitted = funnelJobs.filter((j) => j.endOfJobFormSubmittedAt != null).length;
  const pending = required - submitted;
  const completionRate = required > 0 ? (submitted / required) * 100 : null;

  const dayDiffs: number[] = [];
  for (const j of funnelJobs) {
    if (!j.endOfJobFormRequiredAt || !j.endOfJobFormSubmittedAt) continue;
    const ms = j.endOfJobFormSubmittedAt.getTime() - j.endOfJobFormRequiredAt.getTime();
    if (ms >= 0) dayDiffs.push(ms / (1000 * 60 * 60 * 24));
  }
  const avgDaysToSubmit =
    dayDiffs.length > 0 ? dayDiffs.reduce((a, b) => a + b, 0) / dayDiffs.length : null;

  const selectFields = formSchema.fields
    .filter((f) => f.type === "select")
    .map((f) => aggregateSelectField(f, submittedJobs));

  const booleanFields = formSchema.fields
    .filter((f) => f.type === "boolean")
    .map((f) => aggregateBooleanField(f, submittedJobs));

  const numberFields = formSchema.fields
    .filter((f) => f.type === "number")
    .map((f) => aggregateNumberField(f, submittedJobs));

  const textFootnotes = formSchema.fields
    .filter((f) => f.type === "text" || f.type === "textarea")
    .map((f) => {
      let answered = 0;
      for (const job of submittedJobs) {
        const responses = readResponses(job.endOfJobFormResponses);
        if (!isMissingValue(responses[f.id])) answered += 1;
      }
      return { fieldId: f.id, label: f.label, answered };
    })
    .filter((t) => t.answered > 0);

  const trendYear = opts.year ?? null;
  const submissionTrend = buildSubmissionTrend(submittedJobs, trendYear);

  const availableYears = [...new Set(yearRows.map((r) => r.year))].sort((a, b) => b - a);

  const salespersonOptionsMap = new Map<string, string>();
  for (const j of [...funnelJobs, ...submittedJobs]) {
    if (!j.salesperson) continue;
    salespersonOptionsMap.set(j.salesperson.id, displaySalespersonName(j.salesperson.name));
  }
  const salespersonOptions = [...salespersonOptionsMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    scope: canRunFullReports(user) ? "company" : "mine",
    year: opts.year ?? null,
    salespersonId: opts.salespersonId?.trim() || null,
    submittedFrom: opts.submittedFrom?.toISOString() ?? null,
    submittedTo: opts.submittedTo?.toISOString() ?? null,
    availableYears,
    salespersonOptions,
    formSchema,
    funnel: {
      required,
      submitted,
      pending,
      completionRate,
      avgDaysToSubmit,
    },
    selectFields,
    booleanFields,
    numberFields,
    textFootnotes,
    submissionTrend,
  };
}

/** Match submitted jobs for forms list drill-down from analytics. */
export function endOfJobResponseMatchesFilter(
  responses: unknown,
  fieldId: string,
  valueLabel: string,
  fieldOptions?: string[]
): boolean {
  const responsesMap = readResponses(responses);
  const raw = responsesMap[fieldId];
  if (valueLabel === UNANSWERED) return isMissingValue(raw);
  if (valueLabel === OTHER) {
    if (isMissingValue(raw)) return false;
    const s = String(raw).trim();
    const opts = fieldOptions ?? [];
    return opts.length > 0 && !opts.includes(s);
  }
  return String(raw).trim() === valueLabel;
}

export { UNANSWERED, OTHER };
