/**
 * Builds `/dashboard/jobs` query strings for drill-down from reports and rollups.
 *
 * Jobs page reads:
 * - `year` — job work year or `all`
 * - `sp` — salesperson id (admins / full job viewers only in the filter UI; RLS-style scope still applies server-side)
 * - `spn` — salesperson display name token (used when one display row combines multiple salesperson ids)
 * - `q` — search (job #, lead, customer)
 * - `status`, `sort` — same as the Jobs filter form
 * - `signedMonth` — 1–12: contract signed month in {@link CONTRACT_SIGN_CHART_TIMEZONE} (see contract-signed-month.ts)
 * - `signedUndated` — when present (e.g. `1`): `contractSignedAt` is null
 */

export type JobsDrilldownUrlInput = {
  year?: number | "all";
  salespersonId?: string | null;
  salespersonName?: string | null;
  signedMonth?: number | null;
  signedUndated?: boolean;
  q?: string;
  sort?: "asc" | "desc";
  status?: string;
};

export function jobsDrilldownUrl(params: JobsDrilldownUrlInput): string {
  const q = new URLSearchParams();
  if (params.year !== undefined) {
    q.set("year", params.year === "all" ? "all" : String(params.year));
  }
  const sp = params.salespersonId?.trim();
  if (sp) q.set("sp", sp);
  const spn = params.salespersonName?.trim();
  if (spn) q.set("spn", spn);
  if (params.signedMonth != null && params.signedMonth >= 1 && params.signedMonth <= 12) {
    q.set("signedMonth", String(params.signedMonth));
  }
  if (params.signedUndated) q.set("signedUndated", "1");
  const search = params.q?.trim();
  if (search) q.set("q", search);
  if (params.sort === "asc") q.set("sort", "asc");
  const st = params.status?.trim();
  if (st) q.set("status", st);
  const qs = q.toString();
  return qs ? `/dashboard/jobs?${qs}` : "/dashboard/jobs";
}
