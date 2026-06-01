import { CONTRACT_SIGN_CHART_TIMEZONE } from "@/lib/contract-signed-month";

export const WAGER_TARGET = 232;
export const WAGER_WORK_YEAR = 2026;

export type WagerPrediction = {
  name: string;
  /** Calendar date in America/Chicago, YYYY-MM-DD */
  dateKey: string;
};

export const WAGER_PREDICTIONS: WagerPrediction[] = [
  { name: "Adam", dateKey: "2026-06-26" },
  { name: "Chris", dateKey: "2026-07-10" },
  { name: "Cale", dateKey: "2026-07-28" },
  { name: "Drew", dateKey: "2026-08-06" },
];

/** Timeline axis for the home card (Chicago calendar dates). */
export const WAGER_TIMELINE_START = "2026-06-01";
export const WAGER_TIMELINE_END = "2026-08-06";

export const WAGER_YTD_START = "2026-01-01";

export type WagerPersonStatus =
  | "in_running"
  | "needs_miracle"
  | "called_it"
  | "close_but_late";

export type WagerPersonRow = WagerPrediction & {
  status: WagerPersonStatus;
  statusLabel: string;
};

export type WagerSnapshot = {
  current: number;
  target: number;
  reachedTarget: boolean;
  todayKey: string;
  rows: WagerPersonRow[];
  winner: WagerPrediction | null;
  projectedHitDateKey: string | null;
};

const STATUS_LABELS: Record<WagerPersonStatus, string> = {
  in_running: "In the running",
  needs_miracle: "Needs a miracle",
  called_it: "Called it",
  close_but_late: "Close but late",
};

/** Chicago calendar date as YYYY-MM-DD (en-CA locale). */
export function chicagoDateKey(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: CONTRACT_SIGN_CHART_TIMEZONE });
}

function parseDateKey(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

/** Inclusive calendar-day count from `startKey` through `endKey`. */
export function calendarDaysInclusive(startKey: string, endKey: string): number {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diff + 1;
}

export function addCalendarDays(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/** 0–1 position on the Jun 1 – Aug 6 wager timeline; clamped. */
export function timelinePosition(dateKey: string): number {
  const start = parseDateKey(WAGER_TIMELINE_START).getTime();
  const end = parseDateKey(WAGER_TIMELINE_END).getTime();
  const t = parseDateKey(dateKey).getTime();
  if (end <= start) return 0;
  const raw = (t - start) / (end - start);
  return Math.min(1, Math.max(0, raw));
}

export function formatWagerDate(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function personStatus(
  predictionKey: string,
  todayKey: string,
  hitDateKey: string | null
): WagerPersonStatus {
  if (hitDateKey) {
    return predictionKey >= hitDateKey ? "called_it" : "close_but_late";
  }
  return todayKey <= predictionKey ? "in_running" : "needs_miracle";
}

function calendarDaysApart(a: string, b: string): number {
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  return Math.abs(Math.round((db.getTime() - da.getTime()) / 86_400_000));
}

/** Closest prediction to the actual hit date (minimum absolute day difference). */
export function wagerWinner(
  predictions: WagerPrediction[],
  hitDateKey: string
): WagerPrediction | null {
  if (predictions.length === 0) return null;
  let best = predictions[0];
  let bestDiff = calendarDaysApart(predictions[0].dateKey, hitDateKey);
  for (let i = 1; i < predictions.length; i++) {
    const p = predictions[i];
    const diff = calendarDaysApart(p.dateKey, hitDateKey);
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

/** YTD pace from Jan 1 through `todayKey`; null if no pace or already at target. */
export function projectedHitDate(
  current: number,
  todayKey: string,
  target: number = WAGER_TARGET
): string | null {
  if (current >= target) return null;
  const daysElapsed = calendarDaysInclusive(WAGER_YTD_START, todayKey);
  if (daysElapsed <= 0 || current <= 0) return null;
  const pace = current / daysElapsed;
  const remaining = target - current;
  const daysToGo = remaining / pace;
  if (!Number.isFinite(daysToGo) || daysToGo <= 0) return null;
  return addCalendarDays(todayKey, daysToGo);
}

export function wagerSnapshot(
  current: number,
  today: Date = new Date(),
  target: number = WAGER_TARGET
): WagerSnapshot {
  const todayKey = chicagoDateKey(today);
  const reachedTarget = current >= target;
  const hitDateKey = reachedTarget ? todayKey : null;

  const rows: WagerPersonRow[] = WAGER_PREDICTIONS.map((p) => {
    const status = personStatus(p.dateKey, todayKey, hitDateKey);
    return { ...p, status, statusLabel: STATUS_LABELS[status] };
  });

  const winner = hitDateKey ? wagerWinner(WAGER_PREDICTIONS, hitDateKey) : null;
  const projectedHitDateKey = projectedHitDate(current, todayKey, target);

  return {
    current,
    target,
    reachedTarget,
    todayKey,
    rows,
    winner,
    projectedHitDateKey,
  };
}
