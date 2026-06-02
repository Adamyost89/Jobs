import { redirect } from "next/navigation";
import Link from "next/link";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewAllJobs, canViewEndOfJobFormAnalytics } from "@/lib/rbac";
import { preferredDashboardJobYear } from "@/lib/work-year";
import { FormsNavTabs } from "@/components/FormsNavTabs";
import { EndOfJobFormAnalyticsDashboard } from "@/components/EndOfJobFormAnalyticsDashboard";

export default async function FormsAnalyticsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === Role.HR) redirect("/dashboard/hr/commissions");
  if (!canViewEndOfJobFormAnalytics(user)) redirect("/dashboard/forms");

  const defaultYear = await preferredDashboardJobYear(prisma);

  return (
    <div className="page-stack">
      <p style={{ margin: 0, fontSize: "0.88rem" }}>
        <Link href="/dashboard/forms">← Forms</Link>
      </p>
      <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Checklist analytics</h1>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--muted)", maxWidth: 720, lineHeight: 1.5 }}>
        Counts and breakdowns from submitted end-of-job checklists. Category fields drive per-rep tables; use the links to
        drill into matching jobs.
      </p>

      <FormsNavTabs active="analytics" />

      <EndOfJobFormAnalyticsDashboard
        defaultYear={defaultYear}
        canFilterByRep={canViewAllJobs(user)}
      />
    </div>
  );
}
