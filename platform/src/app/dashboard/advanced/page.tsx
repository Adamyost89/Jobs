import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import { canEditJobs, canViewExcelSnapshots } from "@/lib/rbac";

export default async function AdvancedHubPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === Role.HR) redirect("/dashboard/hr/commissions");

  return (
    <div className="page-stack">
      <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Advanced</h1>
      <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)", maxWidth: 640 }}>
        Deeper tools and exports. Use <Link href="/dashboard">Home</Link> for the year overview and{" "}
        <Link href="/dashboard/jobs">Jobs</Link> for the full job grid.
      </p>
      <ul className="card" style={{ margin: 0, padding: "1rem 1.25rem 1rem 1.5rem", lineHeight: 1.8 }}>
        <li>
          <Link href="/dashboard/reports">Reports &amp; analytics</Link>
        </li>
        <li>
          <Link href="/dashboard/archives">Archives</Link>
        </li>
        {canEditJobs(user) ? (
          <li>
            <Link href="/dashboard/data/import-jobs">Import jobs from uploaded .xlsx</Link>
          </li>
        ) : null}
        {canEditJobs(user) ? (
          <li>
            <Link href="/dashboard/data/import-payouts">Import commission payouts from uploaded .xlsx</Link>
          </li>
        ) : null}
        {canViewExcelSnapshots(user) ? (
          <li>
            <Link href="/dashboard/data/excel">Excel capture (snapshots)</Link>
          </li>
        ) : null}
        {user.role === Role.SUPER_ADMIN ? (
          <li>
            <Link href="/dashboard/settings">Settings</Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
