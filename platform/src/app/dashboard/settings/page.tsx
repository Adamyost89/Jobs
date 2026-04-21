import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import { ToggleCutover } from "@/components/ToggleCutover";
import { SalesTeamSettings } from "@/components/SalesTeamSettings";
import { CommissionPlanSettings } from "@/components/CommissionPlanSettings";
import { UserManagementSettings } from "@/components/UserManagementSettings";
import { JobsDashboardPrefsSettingsCard } from "@/components/JobsDashboardPrefsSettingsCard";
import { loadSalespeopleWithKindForAdmin } from "@/lib/salespeople-kind-db";
import { ProLineConnectionAssistant } from "@/components/ProLineConnectionAssistant";
import { ProlineNameAliasSettings } from "@/components/ProlineNameAliasSettings";
import { StatusBadgeColorSettings } from "@/components/StatusBadgeColorSettings";
import Link from "next/link";

type Search = {
  section?: string;
};

type SettingsSection = "all" | "people" | "jobs" | "integrations" | "system";

function pickString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function normalizeSection(raw: string | undefined): SettingsSection {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "people" || s === "jobs" || s === "integrations" || s === "system" || s === "all") {
    return s;
  }
  return "all";
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    redirect("/dashboard");
  }
  const sp = await searchParams;
  const section = normalizeSection(pickString(sp.section));

  const cfg = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
  const salespeople = await loadSalespeopleWithKindForAdmin();
  const yearRows = await prisma.job.groupBy({
    by: ["year"],
    _count: { _all: true },
  });
  const yearsFromJobs = yearRows.map((r) => r.year).sort((a, b) => a - b);
  const years =
    yearsFromJobs.length > 0
      ? yearsFromJobs
      : [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];

  const spOptions = salespeople.map((s) => ({ id: s.id, name: s.name }));

  const envLooksReady = Boolean(
    process.env.PROLINE_API_KEY?.trim() &&
      process.env.PROLINE_API_BASE_URL?.trim() &&
      process.env.PROLINE_API_PROJECTS_PATH?.trim()
  );

  const showAll = section === "all";
  const showPeople = showAll || section === "people";
  const showJobs = showAll || section === "jobs";
  const showIntegrations = showAll || section === "integrations";
  const showSystem = showAll || section === "system";

  const sectionLinks: Array<{ id: SettingsSection; label: string }> = [
    { id: "all", label: "All" },
    { id: "people", label: "People & access" },
    { id: "jobs", label: "Jobs & commissions" },
    { id: "integrations", label: "Integrations" },
    { id: "system", label: "System" },
  ];

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ margin: 0 }}>Super admin</h1>
      <div className="card" style={{ display: "grid", gap: "0.65rem" }}>
        <h2 style={{ margin: 0 }}>Settings sections</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
          Use the sub-menu filters to focus one area at a time.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {sectionLinks.map((item) => {
            const active = section === item.id;
            return (
              <Link
                key={item.id}
                href={item.id === "all" ? "/dashboard/settings" : `/dashboard/settings?section=${item.id}`}
                className={`btn${active ? "" : " secondary"}`}
                style={{ textDecoration: "none" }}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {showPeople ? (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Users &amp; logins</h2>
            <p style={{ color: "var(--muted)" }}>Create accounts, assign roles, link salespeople, rotate passwords.</p>
            <UserManagementSettings salespeople={spOptions} />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Sales team</h2>
            <p style={{ color: "var(--muted)" }}>
              Who works here, who&apos;s a manager, and who&apos;s inactive. Then set commission rules by year below.
            </p>
            <SalesTeamSettings initial={salespeople} />
          </div>
        </>
      ) : null}

      {showJobs ? (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Commission plans by year</h2>
            <CommissionPlanSettings years={years} salespersonNames={salespeople.map((s) => s.name)} />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Jobs dashboard</h2>
            <p style={{ color: "var(--muted)" }}>
              Column layout, visibility, GP highlight thresholds, and row colors (same controls as on the Jobs page).
            </p>
            <JobsDashboardPrefsSettingsCard />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Status badge colors</h2>
            <p style={{ color: "var(--muted)" }}>
              Set shared colors for status chips on Jobs. Custom stage labels (for example ProLine stages) can be added.
            </p>
            <StatusBadgeColorSettings />
          </div>
        </>
      ) : null}

      {showSystem ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Cutover</h2>
          <p style={{ color: "var(--muted)" }}>
            Toggle when Sheets/Zapier are retired and this app is source of truth.
          </p>
          <ToggleCutover initial={cfg?.cutoverComplete ?? false} />
        </div>
      ) : null}

      {showIntegrations ? (
        <div className="card" id="proline-api-assistant">
          <h2 style={{ marginTop: 0 }}>Integrations</h2>
          <ul style={{ color: "var(--muted)", margin: 0 }}>
            <li>
              ProLine webhook: <code>POST /api/webhooks/proline</code> (header{" "}
              <code>x-proline-signature</code> when <code>PROLINE_WEBHOOK_SECRET</code> is set)
            </li>
            <li>
              ProLine REST sync: <code>POST /api/integrations/proline/sync-jobs</code> (Admin; set{" "}
              <code>PROLINE_API_KEY</code>, <code>PROLINE_API_BASE_URL</code>,{" "}
              <code>PROLINE_API_PROJECTS_PATH</code> — CLI: <code>npm run proline:probe</code>)
            </li>
            <li>
              ProLine connection test: <code>POST /api/integrations/proline/diagnose</code> (Super Admin only)
            </li>
            <li>
              ProLine Bubble type scan: <code>POST /api/integrations/proline/discover</code> (Super Admin; tries{" "}
              <code>/api/1.1/obj/&lt;typename&gt;</code> candidates)
            </li>
            <li>
              Zapier bridge: <code>POST /api/integrations/zapier-bridge</code> (Bearer{" "}
              <code>ZAPIER_BRIDGE_SECRET</code>)
            </li>
          </ul>
          <hr style={{ border: 0, borderTop: "1px solid var(--border, rgba(255,255,255,0.12))", margin: "1.25rem 0" }} />
          <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>ProLine API assistant</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Test outbound ProLine list credentials (read-only). Use this if you are not sure about base URL or path.
          </p>
          <ProLineConnectionAssistant envLooksReady={envLooksReady} />
          <hr style={{ border: 0, borderTop: "1px solid var(--border, rgba(255,255,255,0.12))", margin: "1.25rem 0" }} />
          <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>ProLine name aliases</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Control how ProLine names display in-app (for example full names to first names).
          </p>
          <ProlineNameAliasSettings />
        </div>
      ) : null}
    </div>
  );
}
