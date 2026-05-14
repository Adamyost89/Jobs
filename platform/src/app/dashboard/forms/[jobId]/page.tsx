import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import { canEditJobs, canSubmitEndOfJobForm } from "@/lib/rbac";
import { parseEndOfJobFormConfig, commissionPayoutBlockedForJob, type EndOfJobFormConfig } from "@/lib/end-of-job-form";
import { EndOfJobFormFill } from "@/components/EndOfJobFormFill";
import { EndOfJobFormRequireButton } from "@/components/EndOfJobFormRequireButton";

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
        prolineStage: true,
        salespersonId: true,
        endOfJobFormRequiredAt: true,
        endOfJobFormSubmittedAt: true,
      },
    }),
    prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { endOfJobForm: true },
    }),
  ]);

  if (!job) redirect("/dashboard/forms");

  if (!canSubmitEndOfJobForm(user, job)) {
    redirect("/dashboard/forms");
  }

  const parsed = parseEndOfJobFormConfig(cfgRow?.endOfJobForm);
  const emptyForm: EndOfJobFormConfig = { version: 1, fields: [] };
  const formConfig = parsed.ok ? parsed.value : emptyForm;

  const pending = commissionPayoutBlockedForJob(job);
  const alreadyDone = Boolean(job.endOfJobFormSubmittedAt);

  return (
    <div className="page-stack">
      <p style={{ margin: 0, fontSize: "0.88rem" }}>
        <Link href="/dashboard/forms">← Forms queue</Link>
        {" · "}
        <Link href="/dashboard/jobs">Jobs</Link>
      </p>

      {alreadyDone ? (
        <div className="card">
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Checklist complete</h1>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            Job <strong>{job.jobNumber}</strong> already has a submitted end-of-job checklist
            {job.endOfJobFormSubmittedAt
              ? ` (${job.endOfJobFormSubmittedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })})`
              : ""}
            .
          </p>
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
