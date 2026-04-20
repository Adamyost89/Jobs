import { Prisma } from "@prisma/client";

const JOB_SCALAR_KEYS = new Set<string>(Object.keys(Prisma.JobScalarFieldEnum));

/**
 * Drops keys the current generated client does not know (e.g. after schema adds a field but `prisma generate`
 * was not run, or an old `.next` bundle). Prevents `Unknown argument` on upsert while still sending all known fields.
 */
export function pickJobScalarWriteFields<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (JOB_SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out as T;
}

const COMMISSION_PAYOUT_SCALAR_KEYS = new Set<string>(Object.keys(Prisma.CommissionPayoutScalarFieldEnum));

export function pickCommissionPayoutScalarWriteFields<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (COMMISSION_PAYOUT_SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out as T;
}
