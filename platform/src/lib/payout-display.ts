/** Match `pay-period.ts` payroll display (US Eastern). */
export const PAYROLL_DISPLAY_TZ = "America/New_York";

export function formatDateInEastern(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PAYROLL_DISPLAY_TZ,
  });
}

export function formatDateTimeInEastern(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PAYROLL_DISPLAY_TZ,
  });
}
