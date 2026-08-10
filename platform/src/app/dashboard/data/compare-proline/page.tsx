import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canEditJobs } from "@/lib/rbac";
import { ProlineCsvCompareForm } from "@/components/ProlineCsvCompareForm";

export default async function CompareProlineCsvPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canEditJobs(user)) redirect("/dashboard");

  return (
    <div className="page-stack">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Compare ProLine CSV</h1>
        <Link href="/dashboard/advanced" style={{ fontSize: "0.9rem" }}>
          ← Advanced
        </Link>
        <Link href="/dashboard/jobs" style={{ fontSize: "0.9rem" }}>
          Jobs
        </Link>
      </div>
      <p className="help" style={{ margin: 0 }}>
        Scan a ProLine projects export against local jobs for identity, status, and money mismatches, then
        optionally apply selected fixes (same dry-run → apply flow as payment reconcile).
      </p>
      <ProlineCsvCompareForm />
    </div>
  );
}
