/**
 * A locked commission on the first customer payment must still show commission
 * when a second payment arrives. Run: npx tsx scripts/commission-override-selftest.ts
 */
import assert from "node:assert/strict";
import { defaultCommissionPlanConfig } from "../src/lib/commission-plan-defaults";
import { computeCommissionsForJob, type CommissionComputeContext } from "../src/lib/commission-rules";
import { customerPaidAsOfFromEvents } from "../src/lib/commission-tier-cutovers";

function ctx(patch: Partial<CommissionComputeContext> = {}): CommissionComputeContext {
  return {
    year: 2026,
    leadNumber: "2000",
    jobIdNum: 2000,
    basis: 20_000,
    customerPaid: 20_000,
    commissionableTotal: 20_000,
    paidInFull: false,
    primarySalespersonName: "Brett",
    drewParticipation: null,
    existingPaidBySalesperson: { Brett: 400 },
    overrides: { Brett: true },
    overrideLocks: { Brett: { customerPaid: 10_000, owed: 0, paid: 400 } },
    plan: defaultCommissionPlanConfig(2026),
    tierTotals: {},
    kindBySalespersonName: { Brett: "REP" },
    activeBySalespersonName: { Brett: true },
    existingCommissionNamesOnJob: new Set(["Brett"]),
    ...patch,
  };
}

function brett(rows: ReturnType<typeof computeCommissionsForJob>) {
  const row = rows.find((r) => r.salespersonName === "Brett");
  assert.ok(row, "expected a Brett commission row");
  return row;
}

const secondPayment = brett(computeCommissionsForJob(ctx()));
assert.equal(secondPayment.overrideSkip, false);
assert.equal(secondPayment.owed, 500);
assert.equal(secondPayment.paid, 400);

const stillFirstPayment = brett(computeCommissionsForJob(ctx({ customerPaid: 10_000 })));
assert.equal(stillFirstPayment.overrideSkip, true);

const reducedFirstOwed = brett(
  computeCommissionsForJob(
    ctx({
      existingPaidBySalesperson: { Brett: 0 },
      overrideLocks: { Brett: { customerPaid: 10_000, owed: 300, paid: 0 } },
    })
  )
);
assert.equal(reducedFirstOwed.overrideSkip, false);
assert.equal(reducedFirstOwed.owed, 800);

const unlocked = brett(
  computeCommissionsForJob(
    ctx({
      overrides: {},
      overrideLocks: {},
      existingPaidBySalesperson: { Brett: 0 },
    })
  )
);
assert.equal(unlocked.overrideSkip, false);
assert.equal(unlocked.owed, 1000);

const snapshots = [
  {
    jobId: "j",
    type: "CUSTOMER_PAID_SNAPSHOT",
    payload: { amountPaid: 10_000 },
    createdAt: new Date(1_000),
  },
  {
    jobId: "j",
    type: "CUSTOMER_PAID_SNAPSHOT",
    payload: { amountPaid: 20_000 },
    createdAt: new Date(5_000),
  },
];
assert.equal(customerPaidAsOfFromEvents(20_000, snapshots, 2_000), 10_000);

const deltas = [
  {
    jobId: "j",
    type: "PROLINE_PAYMENT_DELTA_pay1",
    payload: { paymentDelta: 10_000 },
    createdAt: new Date(1_000),
  },
  {
    jobId: "j",
    type: "PROLINE_PAYMENT_DELTA_pay2",
    payload: { paymentDelta: 10_000 },
    createdAt: new Date(5_000),
  },
];
assert.equal(customerPaidAsOfFromEvents(20_000, deltas, 2_000), 10_000);

console.log("commission override selftest ok");
