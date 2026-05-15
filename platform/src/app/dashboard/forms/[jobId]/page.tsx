import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import { canEditJobs, canSubmitEndOfJobForm, canViewEndOfJobForm } from "@/lib/rbac";
import {
  parseEndOfJobFormConfig,
  commissionPayoutBlockedForJob,
  type EndOfJobFormConfig,
} from "@/lib/end-of-job-form";
import { EndOfJobFormFill } from "@/components/EndOfJobFormFill";
import { EndOfJobFormRequireButton } from "@/components/EndOfJobFormRequireButton";
import { EndOfJobFormResponsesView } from "@/components/EndOfJobFormResponsesView";
import { displaySalespersonName } from "@/lib/salesperson-name";

export default async function FormForJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === Role.HR) redirect("/dashboard/hr/commissions");

  const { jobId } = await params;

  const [job, cfgRow] = await Promise.all([
    prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        year: true,
        name: true,
        leadNumber: true,
        prolineJobId: true,
        prolineStage: true,
        salespersonId: true,
        endOfJobFormRequiredAt: true,
        endOfJobFormSubmittedAt: true,
        endOfJobFormResponses: true,
        salesperson: { select: { name: true } },
      },
    }),
    prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { endOfJobForm: true },
    }),
  ]);

  if (!job) redirect("/dashboard/forms");

  if (!canViewEndOfJobForm(user, job)) {
    redirect("/dashboard/forms");
  }

  const parsed = parseEndOfJobFormConfig(cfgRow?.endOfJobForm);
  const emptyForm: EndOfJobFormConfig = { version: 1, fields: [] };
  const formConfig = parsed.ok ? parsed.value : emptyForm;

  const pending = commissionPayoutBlockedForJob(job);
  const alreadyDone = Boolean(job.endOfJobFormSubmittedAt);
  const backHref = alreadyDone ? "/dashboard/forms?view=submitted" : "/dashboard/forms";

  return (
    <div className="page-stack">
      <p style={{ margin: 0, fontSize: "0.88rem" }}>
        <Link href={backHref}>← Forms</Link>
        {" · "}
        <Link href="/dashboard/jobs">Jobs</Link>
      </p>

      <div className="card" style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>{job.jobNumber}</strong>
        {job.name ? ` · ${job.name}` : ""}
        {job.salesperson ? ` · ${displaySalespersonName(job.salesperson.name)}` : ""}
        {job.leadNumber ? ` · Lead ${job.leadNumber}` : ""}
      </div>

      {alreadyDone ? (
        <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Submitted checklist</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Submitted{" "}
            {job.endOfJobFormSubmittedAt
              ? job.endOfJobFormSubmittedAt.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : ""}
            {job.endOfJobFormRequiredAt ? (
              <>
                {" "}
                · Required since{" "}
                {job.endOfJobFormRequiredAt.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </>
            ) : null}
          </p>
          <EndOfJobFormResponsesView config={formConfig} responses={job.endOfJobFormResponses} />
        </div>
      ) : !job.endOfJobFormRequiredAt ? (
        <div className="card">
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>{job.jobNumber}</h1>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            This job does not require the checklist yet (ProLine stage has not triggered it).
          </p>
          {canEditJobs(user) ? <EndOfJobFormRequireButton jobId={job.id} jobNumber={job.jobNumber} /> : null}
        </div>
      ) : formConfig.fields.length === 0 ? (
        <div className="card">
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>{job.jobNumber}</h1>
          <p style={{ margin: "0.5rem 0 0", color: "salmon" }}>
            Checklist is required but no form fields are configured. A super admin must add fields under Settings →
            Jobs &amp; commissions → End-of-job checklist form.
          </p>
        </div>
      ) : (
        <>
          {pending ? (
            <p className="card" style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)" }}>
              Commission payouts for this job are on hold until this checklist is submitted.
            </p>
          ) : null}
          <EndOfJobFormFill
            jobId={job.id}
            jobNumber={job.jobNumber}
            fields={formConfig.fields}
            canSubmit={canSubmitEndOfJobForm(user, job)}
          />
        </>
      )}
    </div>
  );
}
