/**
 * Offline self-test for Partner field normalizers (no network).
 * Run: npx tsx scripts/proline-partner-normalize-selftest.ts
 */
import {
  normalizePartnerInvoice,
  normalizePartnerPayment,
  normalizePartnerProject,
} from "../src/lib/proline-partner-normalize";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const pay = normalizePartnerPayment({
  id: "pay_1",
  project_id: "proj_1",
  net_revenue: 1234.5,
  created_at: "2026-09-29T15:00:00Z",
  status: "completed",
});
assert(pay?.paymentId === "pay_1", "payment id");
assert(pay?.projectId === "proj_1", "payment project");
assert(pay?.amount === 1234.5, "payment amount");
assert(pay?.createdAt?.toISOString().startsWith("2026-09-29"), "payment date");

const inv = normalizePartnerInvoice({
  id: "inv_1",
  project_id: "proj_1",
  total: 5000,
  balance: 1000,
});
assert(inv?.amountPaid === 4000, "invoice amount paid from total-balance");
assert(inv?.total === 5000, "invoice total");

const proj = normalizePartnerProject({
  id: "proj_1",
  project_name: "Test Roof",
  stage: { id: "st1", name: "Won" },
  status: "won",
  revenue: "18500",
});
assert(proj?.name === "Test Roof", "project name");
assert(proj?.stageName === "Won", "project stage");
assert(proj?.revenue === 18500, "project revenue");

console.log("proline-partner-normalize-selftest OK");
