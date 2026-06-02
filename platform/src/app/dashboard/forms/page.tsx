import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Role, type Prisma } from "@prisma/client";
import { canClearEndOfJobForm, canViewAllJobs } from "@/lib/rbac";
import { RemoveEndOfJobFormButton } from "@/components/RemoveEndOfJobFormButton";
import { FormsNavTabs } from "@/components/FormsNavTabs";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { formatDateTimeInEastern } from "@/lib/payout-display";
import { formsListUrl, type FormsSort, type FormsView } from "@/lib/forms-list-url";
import { parseEndOfJobFormConfig } from "@/lib/end-of-job-form";
import { endOfJobResponseMatchesFilter } from "@/lib/end-of-job-form-analytics";

type Search = {
  view?: string;
  sp?: string;
  sort?: string;
  eojField?: string;
  eojValue?: string;
};

function pickString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function normalizeView(raw: string | undefined): FormsView {
  return raw === "submitted" ? "submitted" : "pending";
}

function normalizeSort(raw: string | undefined, view: FormsView): FormsSort {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "rep_desc") return "rep_desc";
  if (view === "submitted") {
    if (s === "rep" || s === "rep_asc") return "rep";
    if (s === "job" || s === "job_desc") return "job";
    if (s === "required") return "required";
    return "submitted";
  }
  if (s === "rep" || s === "rep_asc") return "rep";
  if (s === "job" || s === "job_asc") return "job";
  if (s === "required" || s === "required_asc") return "required";
  return "rep";
}

export default async function FormsQueuePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === Role.HR) redirect("/dashboard/hr/commissions");

  const sp = await searchParams;
  const view = normalizeView(pickString(sp.view));
  const spId = pickString(sp.sp)?.trim() || "";
  const sort = normalizeSort(pickString(sp.sort), view);
  const eojField = pickString(sp.eojField)?.trim() || "";
  const eojValue = pickString(sp.eojValue)?.trim() || "";
  const canRemove = canClearEndOfJobForm(user);

  const roleParts: Prisma.JobWhereInput[] = [];
  if (!canViewAllJobs(user)) {
    roleParts.push(
      user.salespersonIds.length > 0
        ? { salespersonId: { in: user.salespersonIds } }
        : { id: "__none__" }
    );
  }
  if (spId && canViewAllJobs(user)) {
    roleParts.push({ salespersonId: spId });
  }

  const viewPart: Prisma.JobWhereInput =
    view === "submitted"
      ? { endOfJobFormSubmittedAt: { not: null } }
      : {
          endOfJobFormRequiredAt: { not: null },
          endOfJobFormSubmittedAt: null,
        };

  const where: Prisma.JobWhereInput =
    roleParts.length === 0 ? viewPart : { AND: [viewPart, ...roleParts] };

  const orderBy: Prisma.JobOrderByWithRelationInput[] = (() => {
    switch (sort) {
      case "rep":
        return [{ salesperson: { name: "asc" } }, { jobNumber: "desc" }];
      case "rep_desc":
        return [{ salesperson: { name: "desc" } }, { jobNumber: "desc" }];
      case "job":
        return [{ jobNumber: "desc" }];
      case "required":
        return [{ endOfJobFormRequiredAt: "asc" }, { jobNumber: "desc" }];
      case "submitted":
        return [{ endOfJobFormSubmittedAt: "desc" }, { jobNumber: "desc" }];
      default:
        return [{ salesperson: { name: "asc" } }, { jobNumber: "desc" }];
    }
  })();

  let eojFieldOptions: string[] | undefined;
  if (view === "submitted" && eojField && eojValue) {
    const cfgRow = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { endOfJobForm: true },
    });
    const parsed = parseEndOfJobFormConfig(cfgRow?.endOfJobForm);
    if (parsed.ok) {
      const field = parsed.value.fields.find((f) => f.id === eojField && f.type === "select");
      eojFieldOptions = field?.options;
    }
  }

  const [jobsRaw, salespersonRows] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy,
      take: eojField && eojValue ? 500 : 300,
      select: {
        id: true,
        jobNumber: true,
        year: true,
        name: true,
        leadNumber: true,
        prolineStage: true,
        endOfJobFormRequiredAt: true,
        endOfJobFormSubmittedAt: true,
        endOfJobFormResponses: true,
        salesperson: { select: { id: true, name: true } },
      },
    }),
    canViewAllJobs(user)
      ? prisma.job.findMany({
          where: {
            OR: [
              { endOfJobFormRequiredAt: { not: null } },
              { endOfJobFormSubmittedAt: { not: null } },
            ],
          },
          select: { salesperson: { select: { id: true, name: true } } },
          take: 5000,
        })
      : Promise.resolve([]),
  ]);

  const jobs =
    view === "submitted" && eojField && eojValue
      ? jobsRaw.filter((j) =>
          endOfJobResponseMatchesFilter(j.endOfJobFormResponses, eojField, eojValue, eojFieldOptions)
        )
      : jobsRaw;

  const salespersonOptions = (() => {
    const byName = new Map<string, { id: string; name: string }>();
    for (const row of salespersonRows) {
      if (!row.salesperson) continue;
      const name = displaySalespersonName(row.salesperson.name);
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { id: row.salesperson.id, name });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  const currentSortValue =
    sort === "rep" && view === "pending"
      ? "rep"
      : sort === "rep" || sort === "rep_desc"
        ? sort === "rep_desc"
          ? "rep_desc"
          : "rep"
        : sort;

  return (
    <div className="page-stack">
      <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Forms</h1>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--muted)", maxWidth: 720, lineHeight: 1.5 }}>
        End-of-job checklists. Pending jobs block commission payouts until the form is submitted. Completed forms are
        listed under <strong>Submitted</strong>. Use <strong>Analytics</strong> for category counts and rep breakdowns.
      </p>

      <FormsNavTabs active={view === "submitted" ? "submitted" : "pending"} />

      <form method="get" className="card" style={{ padding: "1rem 1.15rem" }}>
        <input type="hidden" name="view" value={view} />
        {eojField ? <input type="hidden" name="eojField" value={eojField} /> : null}
        {eojValue ? <input type="hidden" name="eojValue" value={eojValue} /> : null}
        <div className="filter-bar">
          {canViewAllJobs(user) ? (
            <label>
              Rep
              <select name="sp" defaultValue={spId}>
                <option value="">All reps</option>
                {salespersonOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Sort
            <select name="sort" defaultValue={currentSortValue}>
              {view === "pending" ? (
                <>
                  <option value="rep">Rep A → Z</option>
                  <option value="rep_desc">Rep Z → A</option>
                  <option value="job">Job # newest first</option>
                  <option value="required">Required since (oldest first)</option>
                </>
              ) : (
                <>
                  <option value="submitted">Submitted (newest first)</option>
                  <option value="rep">Rep A → Z</option>
                  <option value="rep_desc">Rep Z → A</option>
                  <option value="job">Job # newest first</option>
                  <option value="required">Originally required (oldest first)</option>
                </>
              )}
            </select>
          </label>
          <div className="filter-bar__actions">
            <button className="btn" type="submit">
              Apply
            </button>
            <Link
              href={formsListUrl({ view })}
              className="btn secondary"
              style={{ textDecoration: "none" }}
            >
              Reset filters
            </Link>
          </div>
        </div>
      </form>

      {eojField && eojValue ? (
        <p className="card" style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          Filtered by answer: <strong style={{ color: "var(--text)" }}>{eojValue}</strong> ({eojField})
          {" · "}
          <Link href={formsListUrl({ view: "submitted", sp: spId || undefined })}>Clear answer filter</Link>
          {" · "}
          <Link href="/dashboard/forms/analytics">Back to analytics</Link>
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <p className="card" style={{ margin: 0, color: "var(--muted)" }}>
          {view === "pending"
            ? "No pending checklists for this filter."
            : eojField && eojValue
              ? "No submitted checklists match this answer filter."
              : "No submitted checklists for this filter."}
        </p>
      ) : (
        <div className="table-responsive card" style={{ padding: 0 }}>
          <p style={{ margin: "0.65rem 1rem 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            Showing {jobs.length} job{jobs.length === 1 ? "" : "s"}
            {spId ? ` · filtered by rep` : ""}
            {eojField && eojValue ? ` · answer filter` : ""}
          </p>
          <table className="table table-data">
            <thead>
              <tr>
                <th>Job</th>
                <th>Year</th>
                <th>Rep</th>
                <th>Customer</th>
                <th>Stage</th>
                <th>{view === "pending" ? "Required since (ET)" : "Submitted (ET)"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="cell-nowrap cell-strong">{j.jobNumber}</td>
                  <td>{j.year}</td>
                  <td className="cell-nowrap">
                    {j.salesperson ? displaySalespersonName(j.salesperson.name) : "—"}
                  </td>
                  <td style={{ maxWidth: 220 }}>{j.name?.trim() || "—"}</td>
                  <td style={{ maxWidth: 200 }}>{j.prolineStage?.trim() || "—"}</td>
                  <td className="cell-nowrap">
                    {view === "pending"
                      ? j.endOfJobFormRequiredAt
                        ? formatDateTimeInEastern(j.endOfJobFormRequiredAt)
                        : "—"
                      : j.endOfJobFormSubmittedAt
                        ? formatDateTimeInEastern(j.endOfJobFormSubmittedAt)
                        : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "flex-start" }}>
                      <Link
                        href={`/dashboard/forms/${j.id}`}
                        className="btn secondary"
                        style={{ textDecoration: "none" }}
                      >
                        {view === "pending" ? "Open" : "View"}
                      </Link>
                      {canRemove ? (
                        <RemoveEndOfJobFormButton jobId={j.id} jobNumber={j.jobNumber} view={view} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
