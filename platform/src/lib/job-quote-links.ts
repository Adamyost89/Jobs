import { prisma } from "@/lib/db";

export type JobQuoteLinkOption = {
  quoteId: string;
  quoteName: string | null;
  shareLink: string;
  approvedDate: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

function asIsoDateOrNull(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asShareLink(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function optionFromPayload(payload: unknown): JobQuoteLinkOption | null {
  const p = asRecord(payload);
  if (!p) return null;
  const shareLink = asShareLink(p.shareLink ?? p.share_link);
  if (!shareLink) return null;
  const quoteId = asString(p.quoteId ?? p.quote_id) ?? shareLink;
  return {
    quoteId,
    quoteName: asString(p.quoteName ?? p.quote_name),
    shareLink,
    approvedDate: asIsoDateOrNull(p.approvedDate ?? p.approved_date),
  };
}

export async function quoteLinksByJobIds(jobIds: string[]): Promise<Map<string, JobQuoteLinkOption[]>> {
  const out = new Map<string, JobQuoteLinkOption[]>();
  if (jobIds.length === 0) return out;

  const events = await prisma.jobEvent.findMany({
    where: {
      jobId: { in: jobIds },
      source: "proline",
      OR: [
        { type: "PROLINE_QUOTE_APPROVED" },
        { type: "PROLINE_UPSERT" },
        { type: "PROLINE_JOB_UPDATED" },
      ],
    },
    select: { jobId: true, payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const dedupe = new Map<string, Set<string>>();
  for (const ev of events) {
    const option = optionFromPayload(ev.payload);
    if (!option) continue;
    if (!out.has(ev.jobId)) out.set(ev.jobId, []);
    if (!dedupe.has(ev.jobId)) dedupe.set(ev.jobId, new Set());
    const key = `${option.quoteId}|${option.shareLink}`;
    const seen = dedupe.get(ev.jobId)!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(ev.jobId)!.push(option);
  }
  return out;
}
