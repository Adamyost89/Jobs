export const JOB_STATUSES = [
  "UNKNOWN",
  "IN_BILLING",
  "SOLD",
  "IN_PROGRESS",
  "COMPLETE",
  "CANCELLED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export function normalizeStatus(raw: string | null | undefined): JobStatus {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("billing")) return "IN_BILLING";
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("lost") || s.includes("disqual")) return "CANCELLED";
  if (s.includes("complete")) return "COMPLETE";
  if (s.includes("closed")) return "COMPLETE";
  if (s.includes("progress")) return "IN_PROGRESS";
  if (s.includes("open")) return "IN_PROGRESS";
  if (s.includes("sold")) return "SOLD";
  if (s.includes("won")) return "SOLD";
  return "UNKNOWN";
}
