/** Numeric sort key for job numbers like 20265001 (digits only, stable for ordering). */
export function jobNumberSortKey(jobNumber: string): number {
  const digits = jobNumber.replace(/\D/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

export function sortJobsByJobNumber<T extends { jobNumber: string }>(
  jobs: T[],
  direction: "asc" | "desc"
): T[] {
  const mul = direction === "asc" ? 1 : -1;
  return [...jobs].sort(
    (a, b) => mul * (jobNumberSortKey(a.jobNumber) - jobNumberSortKey(b.jobNumber))
  );
}

export type JobsSortKey =
  | "job_desc"
  | "job_asc"
  | "amount_paid_desc"
  | "amount_paid_asc"
  | "contract_desc"
  | "contract_asc"
  | "invoiced_desc"
  | "invoiced_asc"
  | "gp_desc"
  | "gp_asc";

type SortableJob = {
  jobNumber: string;
  amountPaid?: { toNumber(): number } | null;
  contractAmount: { toNumber(): number };
  invoicedTotal: { toNumber(): number };
  gp: { toNumber(): number };
};

/** Supports legacy asc/desc params used for job-number sorting. */
export function normalizeJobsSortParam(sortRaw: string | undefined): JobsSortKey {
  switch (sortRaw) {
    case "job_desc":
    case "job_asc":
    case "amount_paid_desc":
    case "amount_paid_asc":
    case "contract_desc":
    case "contract_asc":
    case "invoiced_desc":
    case "invoiced_asc":
    case "gp_desc":
    case "gp_asc":
      return sortRaw;
    case "asc":
      return "job_asc";
    case "desc":
    default:
      return "job_desc";
  }
}

export function sortJobs<T extends SortableJob>(jobs: T[], sortKey: JobsSortKey): T[] {
  const sorted = [...jobs];
  const byJobNumber = (a: T, b: T) => jobNumberSortKey(a.jobNumber) - jobNumberSortKey(b.jobNumber);
  switch (sortKey) {
    case "job_asc":
      return sorted.sort(byJobNumber);
    case "job_desc":
      return sorted.sort((a, b) => byJobNumber(b, a));
    case "amount_paid_asc":
      return sorted.sort(
        (a, b) => (a.amountPaid?.toNumber() ?? 0) - (b.amountPaid?.toNumber() ?? 0) || byJobNumber(b, a)
      );
    case "amount_paid_desc":
      return sorted.sort(
        (a, b) => (b.amountPaid?.toNumber() ?? 0) - (a.amountPaid?.toNumber() ?? 0) || byJobNumber(b, a)
      );
    case "contract_asc":
      return sorted.sort(
        (a, b) => a.contractAmount.toNumber() - b.contractAmount.toNumber() || byJobNumber(b, a)
      );
    case "contract_desc":
      return sorted.sort(
        (a, b) => b.contractAmount.toNumber() - a.contractAmount.toNumber() || byJobNumber(b, a)
      );
    case "invoiced_asc":
      return sorted.sort(
        (a, b) => a.invoicedTotal.toNumber() - b.invoicedTotal.toNumber() || byJobNumber(b, a)
      );
    case "invoiced_desc":
      return sorted.sort(
        (a, b) => b.invoicedTotal.toNumber() - a.invoicedTotal.toNumber() || byJobNumber(b, a)
      );
    case "gp_asc":
      return sorted.sort((a, b) => a.gp.toNumber() - b.gp.toNumber() || byJobNumber(b, a));
    case "gp_desc":
      return sorted.sort((a, b) => b.gp.toNumber() - a.gp.toNumber() || byJobNumber(b, a));
    default:
      return sorted.sort((a, b) => byJobNumber(b, a));
  }
}
