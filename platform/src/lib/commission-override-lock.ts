import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { customerPaidAsOf } from "./commission-tier-cutovers";

export type CommissionOverrideLock = {
  /** Customer cash the manual owed/paid amounts apply through. */
  customerPaid: number;
  owed: number;
  paid: number;
};

export type CommissionLockSource = {
  id: string;
  override: boolean;
  owedAmount: Prisma.Decimal | number | string;
  paidAmount: Prisma.Decimal | number | string;
  overrideCustomerPaid?: Prisma.Decimal | number | string | null;
  overrideOwedAmount?: Prisma.Decimal | number | string | null;
  overridePaidAmount?: Prisma.Decimal | number | string | null;
  updatedAt: Date;
  salesperson: { name: string };
};

function dec(n: Prisma.Decimal | number | string | null | undefined): number {
  if (n == null) return 0;
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fields written when a super admin or admin locks a commission against the cash collected so far. */
export function overrideLockWrite(customerPaid: number, owed: number, paid: number) {
  const paidThrough = round2(Math.max(0, customerPaid));
  const owedAmount = round2(Math.max(0, owed));
  const paidAmount = round2(Math.max(0, paid));
  return {
    override: true as const,
    overrideCustomerPaid: new Prisma.Decimal(paidThrough.toFixed(2)),
    overrideOwedAmount: new Prisma.Decimal(owedAmount.toFixed(2)),
    overridePaidAmount: new Prisma.Decimal(paidAmount.toFixed(2)),
    overrideSyncedPaid: new Prisma.Decimal(paidThrough.toFixed(2)),
  };
}

async function commissionLockTimestamp(commissionId: string, fallback: Date): Promise<Date> {
  const audit = await prisma.auditLog.findFirst({
    where: {
      entityType: "Commission",
      entityId: commissionId,
      action: { in: ["COMMISSION_ADMIN_EDIT", "COMMISSION_ADDED_ON_JOB"] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return audit?.createdAt ?? fallback;
}

/**
 * Lock snapshot for every override line. Missing snapshots (adjustments made before the snapshot
 * columns existed) are inferred from the customer-payment history at the time of the edit.
 */
export async function resolveOverrideLocks(
  jobId: string,
  currentCustomerPaid: number,
  commissions: CommissionLockSource[],
  opts: { persist: boolean }
): Promise<Record<string, CommissionOverrideLock>> {
  const locks: Record<string, CommissionOverrideLock> = {};
  const currentPaid = Math.max(0, currentCustomerPaid);
  for (const c of commissions) {
    if (!c.override) continue;
    let customerPaid = c.overrideCustomerPaid == null ? null : dec(c.overrideCustomerPaid);
    let owed = c.overrideOwedAmount == null ? null : dec(c.overrideOwedAmount);
    let paid = c.overridePaidAmount == null ? null : dec(c.overridePaidAmount);
    if (customerPaid == null || owed == null || paid == null) {
      if (customerPaid == null) {
        const lockedAt = await commissionLockTimestamp(c.id, c.updatedAt);
        customerPaid = await customerPaidAsOf(jobId, currentPaid, lockedAt);
      }
      owed = owed ?? dec(c.owedAmount);
      paid = paid ?? dec(c.paidAmount);
      if (opts.persist) {
        await prisma.commission.update({
          where: { id: c.id },
          data: {
            overrideCustomerPaid: new Prisma.Decimal(round2(customerPaid).toFixed(2)),
            overrideOwedAmount: new Prisma.Decimal(round2(owed).toFixed(2)),
            overridePaidAmount: new Prisma.Decimal(round2(paid).toFixed(2)),
          },
        });
      }
    }
    locks[c.salesperson.name] = {
      customerPaid: round2(customerPaid),
      owed: round2(owed),
      paid: round2(paid),
    };
  }
  return locks;
}
