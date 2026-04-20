import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canEditJobs } from "@/lib/rbac";
import { JobWorkbookImportForm } from "@/components/JobWorkbookImportForm";

export default async function ImportJobsFromWorkbookPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canEditJobs(user)) redirect("/dashboard");

  return (
    <div className="page-stack">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Import jobs from workbook</h1>
        <Link href="/dashboard/advanced" style={{ fontSize: "0.9rem" }}>
          ← Advanced
        </Link>
        <Link href="/dashboard/jobs" style={{ fontSize: "0.9rem" }}>
          Jobs
        </Link>
        <Link href="/dashboard/data/import-payouts" style={{ fontSize: "0.9rem" }}>
          Import payouts
        </Link>
      </div>
      <p className="help" style={{ margin: 0 }}>
        Upload an <code>.xlsx</code>, choose which tabs to load, and set the <strong>book year</strong> and optional{" "}
        <strong>row range</strong> for each tab. Data is written to the <code>Job</code> table (same rules as{" "}
        <code>npm run import:jobs</code>).
      </p>
      <JobWorkbookImportForm />
    </div>
  );
}
