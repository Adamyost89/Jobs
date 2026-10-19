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
  payment_id: "pay_1",
  payment_project_id: "1767054228890x717983713573208000",
  payment_net_revenue: 1234.5,
  payment_date: "2026-09-29T15:00:00Z",
  created_at: "2026-09-29T15:00:00Z",
});
assert(pay?.paymentId === "pay_1", "payment id");
assert(pay?.projectId === "1767054228890x717983713573208000", "payment project");
assert(pay?.amount === 1234.5, "payment amount");
assert(pay?.createdAt?.toISOString().startsWith("2026-09-29"), "payment date");

const payNested = normalizePartnerPayment({
  id: "pay_2",
  project: { id: "proj_nested", project_number: "2140" },
  amount: 50,
});
assert(payNested?.projectId === "proj_nested", "nested project id");
assert(payNested?.projectNumber === "2140", "nested project number");

const payBare = normalizePartnerPayment({
  id: "pay_3",
  project: "proj_bare",
  total_amount: 10,
});
assert(payBare?.projectId === "proj_bare", "bare string project id");

const inv = normalizePartnerInvoice({
  id: "inv_1",
  project_id: "proj_1",
  total: 5000,
  balance: 1000,
});
assert(inv?.amountPaid === 4000, "invoice amount paid from total-balance");
assert(inv?.total === 5000, "invoice total");

const proj = normalizePartnerProject({
  id: "vs_new_id",
  legacy_id: "1767054228890x717983713573208000",
  project_name: "Test Roof",
  project_number: "2140",
  stage: { id: "st1", name: "Won" },
  status: "won",
  revenue: "18500",
});
assert(proj?.name === "Test Roof", "project name");
assert(proj?.stageName === "Won", "project stage");
assert(proj?.revenue === 18500, "project revenue");
assert(proj?.aliasIds.includes("vs_new_id"), "alias includes new id");
assert(proj?.aliasIds.includes("1767054228890x717983713573208000"), "alias includes legacy id");
assert(proj?.projectNumber === "2140", "project number");

console.log("proline-partner-normalize-selftest OK");
