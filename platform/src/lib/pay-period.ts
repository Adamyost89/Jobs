/**
 * Biweekly pay periods from a fixed anchor date (matches typical payroll blocks).
 * Override anchor with env PAY_PERIOD_ANCHOR=YYYY-MM-DD (first day of period 0).
 */

import { PAYROLL_DISPLAY_TZ } from "./payout-display";

const MS_PER_DAY = 86400000;
const DAYS = 14;

function parseAnchor(): Date {
  const raw = process.env.PAY_PERIOD_ANCHOR?.trim();
  if (raw) {
    const d = new Date(raw + "T12:00:00.000Z");
    if (!isNaN(d.getTime())) return d;
  }
  return new Date("2025-01-06T12:00:00.000Z");
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PAYROLL_DISPLAY_TZ,
  });
}

function addDaysUtc(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

export function formatIsoDateForPayrollTz(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PAYROLL_DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseIsoDateAtNoonUtc(value: string): Date | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getPayPeriodContaining(date = new Date()): {
  start: Date;
  end: Date;
  label: string;
} {
  const anchor = parseAnchor();
  const t = date.getTime();
  const days = Math.floor((t - anchor.getTime()) / MS_PER_DAY);
  const idx = Math.floor(days / DAYS);
  const start = new Date(anchor.getTime() + idx * DAYS * MS_PER_DAY);
  const end = new Date(anchor.getTime() + (idx + 1) * DAYS * MS_PER_DAY - MS_PER_DAY);
  const label = `${fmt(start)} – ${fmt(end)}`;
  return { start, end, label };
}

/**
 * Payroll posting rule for a payday date:
 * use the two full weeks immediately before the week containing the payday.
 */
export function getPayPeriodForPayday(payday: Date): {
  start: Date;
  end: Date;
  label: string;
} {
  const dayOfWeek = payday.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStart = addDaysUtc(payday, -daysSinceMonday);
  const end = addDaysUtc(weekStart, -1);
  const start = addDaysUtc(end, -(DAYS - 1));
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

export function getCurrentPayPeriodLabel(now = new Date()): string {
  return getPayPeriodContaining(now).label;
}

/** Returns the next Friday in payroll timezone (today if already Friday). */
export function getUpcomingFridayIsoForPayrollTz(now = new Date()): string {
  const localIso = formatIsoDateForPayrollTz(now);
  const localDate = parseIsoDateAtNoonUtc(localIso);
  if (!localDate) return localIso;
  const dayOfWeek = localDate.getUTCDay(); // 0=Sun..6=Sat
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  return formatIsoDateForPayrollTz(addDaysUtc(localDate, daysUntilFriday));
}
