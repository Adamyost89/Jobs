import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canEditJobs } from "@/lib/rbac";
import { PayoutImportForm } from "@/components/PayoutImportForm";

export default async function ImportPayoutsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canEditJobs(user)) redirect("/dashboard");

  return (
    <div className="page-stack">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Import commission payouts</h1>
        <Link href="/dashboard/advanced" style={{ fontSize: "0.9rem" }}>
          ← Advanced
        </Link>
        <Link href="/dashboard/data/import-jobs" style={{ fontSize: "0.9rem" }}>
          Import jobs
        </Link>
        <Link href="/dashboard/commissions/payout-summary" style={{ fontSize: "0.9rem" }}>
          Payout summary
        </Link>
      </div>
      <p className="help" style={{ margin: 0 }}>
        Tabular payout sheets map columns to <code>CommissionPayout</code>. Tabs named <strong>Total Commissions YYYY</strong>{" "}
        (e.g. Commissions.xlsx) use the wide layout automatically — pay period in column A, one column per rep, multiline{" "}
        <code>job - customer - $amount</code> per cell — same as <code>npm run import:payouts</code>.
      </p>
      <PayoutImportForm />
    </div>
  );
}
