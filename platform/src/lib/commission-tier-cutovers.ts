import { prisma } from "./db";
import type {
  CommissionPlanConfigV1,
  CommissionRunningMetric,
  CommissionTierCutovers,
  CommissionTierTotals,
} from "./commission-plan-types";
import { countsTowardSignedTotals } from "./insurance-job";
import { formatIsoDateForPayrollTz } from "./pay-period";
import { PAYROLL_DISPLAY_TZ } from "./payout-display";
import { inferPayoutYear, parsePayPeriodSortDate } from "./payout-summary";
import { normalizeProlineWebhookBody } from "./proline-webhook";

/** Dated record of `Job.amountPaid`, written by `recalculateJobAndCommissions` whenever it changes. */
export const CUSTOMER_PAID_SNAPSHOT_EVENT = "CUSTOMER_PAID_SNAPSHOT";
const PAYMENT_DELTA_EVENT_PREFIX = "PROLINE_PAYMENT_DELTA_";
/** Partner API dated payments (`proline-partner-payment-reconcile.ts`). */
const PARTNER_PAYMENT_EVENT_PREFIX = "PROLINE_PARTNER_PAYMENT_";
/** Job edit from the app; `payload.patch.amountPaid` is the new value when it was changed. */
const MANUAL_PAYMENT_EVENT = "MANUAL_PAYMENT_UPDATE";
/** Bulk corrections that log `{ changed, local, remote }` after setting `amountPaid` to `remote.amountPaid`. */
const PAYMENT_CORRECTION_EVENTS = new Set([
  "PROLINE_PAYMENT_RECONCILE",
  "PROLINE_CSV_COMPARE",
  "PROLINE_PARTNER_RECONCILE",
]);
const DATED_TIER_METRICS: CommissionRunningMetric[] = ["ytd_paid_commissions", "ytd_primary_paid_amount"];
const REACHED_CACHE_TTL_MS = 5 * 60_000;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/** Midnight at the start of `iso` in the payroll timezone. */
function payrollDayStart(iso: string): number {
  const noonUtc = new Date(`${iso}T12:00:00.000Z`);
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: PAYROLL_DISPLAY_TZ, hour: "2-digit", hourCycle: "h23" }).format(
      noonUtc
    )
  );
  return noonUtc.getTime() - localHour * 3_600_000;
}

// ---------------------------------------------------------------------------
// Per-job customer cash timeline
// ---------------------------------------------------------------------------

type PaymentHistoryEvent = { jobId: string; type: string; payload: unknown; createdAt: Date };

/** `initial` = cash before the first dated event; `steps` = cumulative amount paid after each dated event. */
type PaidTimeline = { initial: number; steps: { at: number; value: number }[] };

async function loadPaymentHistory(jobIds: string[]): Promise<Map<string, PaymentHistoryEvent[]>> {
  const out = new Map<string, PaymentHistoryEvent[]>();
  if (!jobIds.length) return out;
  const rows = await prisma.jobEvent.findMany({
    where: {
      jobId: { in: jobIds },
      OR: [
        { type: { startsWith: "PROLINE_" } },
        { type: { in: [CUSTOMER_PAID_SNAPSHOT_EVENT, MANUAL_PAYMENT_EVENT] } },
      ],
      NOT: [
        { type: { startsWith: "PROLINE_INVOICE_DELTA_" } },
        { type: { startsWith: "PROLINE_NAME_WRITEBACK" } },
        { type: { startsWith: "PROLINE_API_SYNC_" } },
        { type: "PROLINE_PARTNER_PROJECT_SYNC" },
      ],
    },
    select: { jobId: true, type: true, payload: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    const list = out.get(r.jobId) ?? [];
    list.push(r);
    out.set(r.jobId, list);
  }
  return out;
}

/** Cumulative amount paid observed by an event, or a per-payment increment. */
function readPaymentEvent(
  e: PaymentHistoryEvent
): { kind: "observed"; value: number; authoritative: boolean } | { kind: "delta"; amount: number } | null {
  const p = asRecord(e.payload);
  if (!p) return null;
  if (e.type === CUSTOMER_PAID_SNAPSHOT_EVENT) {
    const v = num(p.amountPaid);
    return v === null ? null : { kind: "observed", value: v, authoritative: true };
  }
  if (e.type === MANUAL_PAYMENT_EVENT) {
    const v = num(asRecord(p.patch)?.amountPaid);
    return v === null ? null : { kind: "observed", value: Math.max(0, v), authoritative: true };
  }
  if (e.type.startsWith(PAYMENT_DELTA_EVENT_PREFIX) || e.type.startsWith(PARTNER_PAYMENT_EVENT_PREFIX)) {
    const d = num(p.paymentDelta) ?? num(p.amount);
    return d === null ? null : { kind: "delta", amount: d };
  }
  if (PAYMENT_CORRECTION_EVENTS.has(e.type)) {
    const changed = Array.isArray(p.changed) ? p.changed : [];
    const v = num(asRecord(p.remote)?.amountPaid);
    if (!changed.includes("amountPaid") || v === null) return null;
    return { kind: "observed", value: v, authoritative: true };
  }
  let normalized: ReturnType<typeof normalizeProlineWebhookBody>;
  try {
    normalized = normalizeProlineWebhookBody(p, {});
  } catch {
    return null;
  }
  if (!normalized.ok) return null;
  const ev = normalized.event;
  const incoming = ev.amountPaid ?? ev.grossRevenue;
  if (incoming === undefined || ev.paymentId) return null;
  return { kind: "observed", value: Math.max(0, incoming), authoritative: !!ev.authoritativeNetPaid };
}

/**
 * Rebuilds when the job's cash came in from snapshots, ProLine webhook payloads, per-payment markers,
 * reconciles and manual edits. Cash not explained by any dated event is treated as collected before the first
 * event. A job's first snapshot is only a baseline (taken whenever snapshots started), not a payment moment, so
 * any jump it reveals is also treated as early cash.
 */
function paymentIdFromDeltaEventType(type: string): string | null {
  if (type.startsWith(PAYMENT_DELTA_EVENT_PREFIX)) return type.slice(PAYMENT_DELTA_EVENT_PREFIX.length) || null;
  if (type.startsWith(PARTNER_PAYMENT_EVENT_PREFIX)) return type.slice(PARTNER_PAYMENT_EVENT_PREFIX.length) || null;
  return null;
}

function buildPaidTimeline(currentPaid: number, history: PaymentHistoryEvent[]): PaidTimeline {
  const steps: { at: number; value: number }[] = [];
  const pending: { at: number; amount: number }[] = [];
  const seenPaymentIds = new Set<string>();
  let initial = 0;
  let value = 0;
  let known = false;
  let sawSnapshot = false;

  for (const e of history) {
    const read = readPaymentEvent(e);
    if (e.type === CUSTOMER_PAID_SNAPSHOT_EVENT && !sawSnapshot) {
      sawSnapshot = true;
      if (known && read?.kind === "observed") {
        const shift = read.value - value;
        initial += shift;
        for (const s of steps) s.value += shift;
        value = read.value;
        continue;
      }
    }
    if (!read) continue;
    const at = e.createdAt.getTime();
    if (read.kind === "delta") {
      const payId = paymentIdFromDeltaEventType(e.type);
      if (payId) {
        if (seenPaymentIds.has(payId)) continue;
        seenPaymentIds.add(payId);
      }
      if (known) {
        value += read.amount;
        steps.push({ at, value });
      } else {
        pending.push({ at, amount: read.amount });
      }
      continue;
    }
    if (!known) {
      initial = Math.max(0, read.value - pending.reduce((s, x) => s + x.amount, 0));
      let v = initial;
      for (const x of pending) {
        v += x.amount;
        steps.push({ at: x.at, value: v });
      }
      known = true;
      value = read.value;
    } else {
      value = read.authoritative ? read.value : Math.max(value, read.value);
    }
    steps.push({ at, value });
  }
  if (!known) {
    initial = Math.max(0, currentPaid - pending.reduce((s, x) => s + x.amount, 0));
    value = initial;
    for (const x of pending) {
      value += x.amount;
      steps.push({ at: x.at, value });
    }
  }

  const unexplained = currentPaid - value;
  const clamp = (v: number) => Math.min(currentPaid, Math.max(0, v));
  return {
    initial: clamp(initial + unexplained),
    steps: steps.map((s) => ({ at: s.at, value: clamp(s.value + unexplained) })),
  };
}

function paidBefore(tl: PaidTimeline, boundary: number): number {
  let v = tl.initial;
  for (const s of tl.steps) {
    if (s.at >= boundary) break;
    v = s.value;
  }
  return v;
}

// ---------------------------------------------------------------------------
// When each tier was reached
// ---------------------------------------------------------------------------

/** `at` = first moment the tier counts; `crossingJobId` + `crossingExtra` = cash on that job still below the tier. */
type TierReached = { at: number; reachedOn: string; crossingJobId?: string; crossingExtra?: number } | null;

const reachedCache = new Map<string, { value: TierReached; expires: number }>();

async function cached(key: string, load: () => Promise<TierReached>): Promise<TierReached> {
  const hit = reachedCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  reachedCache.set(key, { value, expires: Date.now() + REACHED_CACHE_TTL_MS });
  return value;
}

function payoutPaydayIso(row: {
  payPeriodLabel: string;
  notes: string | null;
  importSourceKey: string | null;
  createdAt: Date;
}): string {
  const explicit = (row.notes ?? "").match(/payday\s+(\d{4}-\d{2}-\d{2})/i);
  if (explicit) return explicit[1];
  return formatIsoDateForPayrollTz(parsePayPeriodSortDate(row.payPeriodLabel, inferPayoutYear(row), row.createdAt));
}

/**
 * Payday on which the rep's paid-commission running total first reached the tier. Commissions already marked
 * paid without a payout row are treated as paid before the first recorded payout.
 */
async function reachedByPaidCommissions(
  year: number,
  salespersonName: string,
  minTotal: number,
  ytdPaid: number
): Promise<TierReached> {
  const payouts = await prisma.commissionPayout.findMany({
    where: { salesperson: { name: salespersonName }, job: { year } },
    select: { amount: true, payPeriodLabel: true, notes: true, importSourceKey: true, createdAt: true },
  });
  const dated = payouts
    .map((p) => ({ amount: p.amount.toNumber(), iso: payoutPaydayIso(p), createdAt: p.createdAt.getTime() }))
    .sort((a, b) => a.iso.localeCompare(b.iso) || a.createdAt - b.createdAt);
  let running = Math.max(0, ytdPaid - dated.reduce((s, p) => s + p.amount, 0));
  if (running >= minTotal) return null;
  for (const p of dated) {
    running += p.amount;
    if (running >= minTotal - 0.005) return { at: payrollDayStart(p.iso), reachedOn: p.iso };
  }
  return null;
}

/** Exact moment customer cash on the rep's sold jobs for the year first reached the tier. */
async function reachedByPrimaryCashCollected(
  year: number,
  salespersonName: string,
  minTotal: number
): Promise<TierReached> {
  const jobs = (
    await prisma.job.findMany({
      where: { year, salesperson: { name: salespersonName } },
      select: { id: true, name: true, amountPaid: true },
    })
  ).filter((j) => countsTowardSignedTotals(j.name));
  const history = await loadPaymentHistory(jobs.map((j) => j.id));

  const current = new Map<string, number>();
  const allSteps: { jobId: string; at: number; value: number }[] = [];
  let total = 0;
  for (const j of jobs) {
    const tl = buildPaidTimeline(Math.max(0, j.amountPaid?.toNumber() ?? 0), history.get(j.id) ?? []);
    current.set(j.id, tl.initial);
    total += tl.initial;
    for (const s of tl.steps) allSteps.push({ jobId: j.id, ...s });
  }
  if (total >= minTotal) return null;
  allSteps.sort((a, b) => a.at - b.at);
  for (const s of allSteps) {
    const before = total;
    total += s.value - (current.get(s.jobId) ?? 0);
    current.set(s.jobId, s.value);
    if (total >= minTotal - 0.005) {
      return {
        at: s.at,
        reachedOn: formatIsoDateForPayrollTz(new Date(s.at)),
        crossingJobId: s.jobId,
        crossingExtra: Math.max(0, minTotal - before),
      };
    }
  }
  return null;
}

/** Commission checks to the rep on this job posted (or paid) on or before `reachedOn`. */
async function commissionPaidOnJobBy(jobId: string, salespersonName: string, reachedOn: string): Promise<number> {
  const payouts = await prisma.commissionPayout.findMany({
    where: { jobId, salesperson: { name: salespersonName } },
    select: { amount: true, payPeriodLabel: true, notes: true, importSourceKey: true, createdAt: true },
  });
  let sum = 0;
  for (const p of payouts) {
    const posted = formatIsoDateForPayrollTz(p.createdAt);
    const payday = payoutPaydayIso(p);
    const earliest = posted < payday ? posted : payday;
    if (earliest <= reachedOn) sum += p.amount.toNumber();
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function recordCustomerPaidSnapshot(jobId: string, amountPaid: number): Promise<void> {
  const last = await prisma.jobEvent.findFirst({
    where: { jobId, type: CUSTOMER_PAID_SNAPSHOT_EVENT },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const lastAmount = num(asRecord(last?.payload)?.amountPaid);
  if (lastAmount !== null && Math.abs(lastAmount - amountPaid) < 0.005) return;
  await prisma.jobEvent.create({
    data: {
      jobId,
      type: CUSTOMER_PAID_SNAPSHOT_EVENT,
      source: "workflow",
      payload: { amountPaid: Math.round(amountPaid * 100) / 100 },
    },
  });
}

/** Tier cutovers for every rep with a paid-commission or cash-collected goal tier they have already met. */
export async function loadRunningTierCutoversForJob(args: {
  jobId: string;
  year: number;
  plan: CommissionPlanConfigV1;
  tierTotals: CommissionTierTotals;
  customerPaid: number;
}): Promise<CommissionTierCutovers> {
  const out: CommissionTierCutovers = {};
  let jobTimeline: PaidTimeline | null = null;
  const timeline = async () => {
    if (!jobTimeline) {
      const history = await loadPaymentHistory([args.jobId]);
      jobTimeline = buildPaidTimeline(Math.max(0, args.customerPaid), history.get(args.jobId) ?? []);
    }
    return jobTimeline;
  };

  for (const [name, rule] of Object.entries(args.plan.people)) {
    const pack = rule.runningTiers;
    if (!pack || !DATED_TIER_METRICS.includes(pack.metric)) continue;
    const totals = args.tierTotals[name];
    const running = pack.metric === "ytd_paid_commissions" ? (totals?.ytdPaid ?? 0) : (totals?.ytdPrimaryPaidAmount ?? 0);
    const met = pack.tiers.filter((t) => t.minTotal > 0 && running >= t.minTotal);
    if (!met.length) continue;

    const rows: CommissionTierCutovers[string] = [];
    for (const t of met) {
      try {
        let reached: TierReached;
        if (isIsoDate(t.reachedOn)) {
          const iso = t.reachedOn.trim();
          reached = { at: payrollDayStart(iso), reachedOn: iso };
        } else {
          const key = `${pack.metric}|${args.year}|${name}|${t.minTotal}`;
          reached = await cached(key, () =>
            pack.metric === "ytd_paid_commissions"
              ? reachedByPaidCommissions(args.year, name, t.minTotal, running)
              : reachedByPrimaryCashCollected(args.year, name, t.minTotal)
          );
        }
        if (!reached) {
          rows.push({ minTotal: t.minTotal, reachedOn: null, customerPaidBefore: null });
          continue;
        }
        const tl = await timeline();
        const extra = reached.crossingJobId === args.jobId ? (reached.crossingExtra ?? 0) : 0;
        rows.push({
          minTotal: t.minTotal,
          reachedOn: reached.reachedOn,
          customerPaidBefore: Math.min(Math.max(0, args.customerPaid), paidBefore(tl, reached.at) + extra),
          commissionPaidBefore: await commissionPaidOnJobBy(args.jobId, name, reached.reachedOn),
        });
      } catch (error) {
        console.error("commission tier cutover failed", { jobId: args.jobId, salesperson: name, error });
        rows.push({ minTotal: t.minTotal, reachedOn: null, customerPaidBefore: null });
      }
    }
    out[name] = rows;
  }
  return out;
}
