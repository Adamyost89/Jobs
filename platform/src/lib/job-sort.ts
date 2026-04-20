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
