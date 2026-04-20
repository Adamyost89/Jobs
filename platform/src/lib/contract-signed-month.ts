/** IANA zone for “which calendar month did this contract sign in?” — must match signed-contracts reports. */
export const CONTRACT_SIGN_CHART_TIMEZONE = "America/Chicago";

/** Short labels used in monthly stacked charts (Jan–Dec). */
export const CONTRACT_SIGN_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Calendar month index 1–12 for `d` in {@link CONTRACT_SIGN_CHART_TIMEZONE}, matching
 * `Date.prototype.toLocaleString(..., { timeZone, month: "numeric" })` used in reports.
 */
export function signedCalendarMonthForChart(d: Date): number {
  const mo = parseInt(
    d.toLocaleString("en-US", { timeZone: CONTRACT_SIGN_CHART_TIMEZONE, month: "numeric" }),
    10
  );
  return Number.isFinite(mo) && mo >= 1 && mo <= 12 ? mo : d.getUTCMonth() + 1;
}

/** Map chart row label ("Jan" … "Dec" or "Undated") to signed-month filter semantics. */
export function chartMonthLabelToDrill(
  monthLabel: string
): { signedMonth?: number; signedUndated?: true } {
  if (monthLabel === "Undated") return { signedUndated: true };
  const idx = CONTRACT_SIGN_MONTH_LABELS.indexOf(monthLabel as (typeof CONTRACT_SIGN_MONTH_LABELS)[number]);
  if (idx >= 0) return { signedMonth: idx + 1 };
  return {};
}
