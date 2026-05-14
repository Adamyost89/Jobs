import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import { canViewAllJobs } from "@/lib/rbac";

export default async function FormsQueuePage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === Role.HR) redirect("/dashboard/hr/commissions");

  const spFilter =
    !canViewAllJobs(user) && user.salespersonIds.length > 0
      ? { salespersonId: { in: user.salespersonIds } }
      : !canViewAllJobs(user)
        ? { id: "__none__" as const }
        : {};

  const jobs = await prisma.job.findMany({
    where: {
      AND: [
        { endOfJobFormRequiredAt: { not: null } },
        { endOfJobFormSubmittedAt: null },
        spFilter,
      ],
    },
    orderBy: [{ year: "desc" }, { jobNumber: "desc" }],
    take: 200,
    select: {
      id: true,
      jobNumber: true,
      year: true,
      name: true,
      leadNumber: true,
      prolineStage: true,
      endOfJobFormRequiredAt: true,
      salesperson: { select: { name: true } },
    },
  });

  return (
    <div className="page-stack">
      <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>Forms</h1>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--muted)", maxWidth: 640, lineHeight: 1.5 }}>
        Jobs that require the end-of-job checklist before commission payouts show here. Open a job to fill out and
        submit the form.
      </p>

      {jobs.length === 0 ? (
        <p className="card" style={{ margin: 0, color: "var(--muted)" }}>
          No pending checklists.
        </p>
      ) : (
        <div className="table-responsive card" style={{ padding: 0 }}>
          <table className="table table-data">
            <thead>
              <tr>
                <th>Job</th>
                <th>Year</th>
                <th>Rep</th>
                <th>Customer</th>
                <th>Stage</th>
                <th>Required since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="cell-nowrap cell-strong">{j.jobNumber}</td>
                  <td>{j.year}</td>
                  <td>{j.salesperson?.name ?? "—"}</td>
                  <td style={{ maxWidth: 220 }}>{j.name?.trim() || "—"}</td>
                  <td style={{ maxWidth: 200 }}>{j.prolineStage?.trim() || "—"}</td>
                  <td className="cell-nowrap">
                    {j.endOfJobFormRequiredAt
                      ? j.endOfJobFormRequiredAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                      : "—"}
                  </td>
                  <td>
                    <Link href={`/dashboard/forms/${j.id}`} className="btn secondary" style={{ textDecoration: "none" }}>
                      Open
                    </Link>
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
