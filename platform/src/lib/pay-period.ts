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

export function getCurrentPayPeriodLabel(now = new Date()): string {
  return getPayPeriodContaining(now).label;
}
