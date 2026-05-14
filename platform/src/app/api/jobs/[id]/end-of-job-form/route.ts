import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canSubmitEndOfJobForm } from "@/lib/rbac";
import {
  parseEndOfJobFormConfig,
  validateEndOfJobFormSubmission,
} from "@/lib/end-of-job-form";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";
import { sendEndOfJobFormZapWebhook } from "@/lib/end-of-job-form-zap";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: jobId } = await ctx.params;
  const json = await req.json().catch(() => null);
  if (!isRecord(json)) {
    return NextResponse.json({ error: "Expected JSON object body" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      leadNumber: true,
      prolineJobId: true,
      year: true,
      name: true,
      endOfJobFormRequiredAt: true,
      endOfJobFormSubmittedAt: true,
      salespersonId: true,
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!job.endOfJobFormRequiredAt) {
    return NextResponse.json(
      { error: "End-of-job checklist is not required for this job yet." },
      { status: 400 }
    );
  }

  if (job.endOfJobFormSubmittedAt) {
    return NextResponse.json(
      { ok: true, alreadySubmitted: true, submittedAt: job.endOfJobFormSubmittedAt.toISOString() },
      { status: 200 }
    );
  }

  if (!canSubmitEndOfJobForm(user, job)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cfgRow = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { endOfJobForm: true },
  });
  const parsedForm = parseEndOfJobFormConfig(cfgRow?.endOfJobForm);
  if (!parsedForm.ok) {
    return NextResponse.json({ error: "Invalid form configuration", detail: parsedForm.error }, { status: 500 });
  }
  const formConfig = parsedForm.value;
  if (formConfig.fields.length === 0) {
    return NextResponse.json(
      { error: "No checklist fields are configured. Ask a super admin to add fields in Settings." },
      { status: 503 }
    );
  }

  const validated = validateEndOfJobFormSubmission(formConfig, json);
  if (!validated.ok) {
    return NextResponse.json({ error: "Validation failed", details: validated.errors }, { status: 400 });
  }

  const submittedAt = new Date();
  const responsesPayload = {
    ...validated.values,
    _meta: {
      formVersion: formConfig.version,
      submittedByUserId: user.id,
      submittedByEmail: user.email,
      submittedAt: submittedAt.toISOString(),
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: {
        endOfJobFormSubmittedAt: submittedAt,
        endOfJobFormResponses: responsesPayload as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.jobEvent.create({
      data: {
        jobId,
        type: "END_OF_JOB_FORM_SUBMITTED",
        source: "api",
        payload: responsesPayload as object,
      },
    });
  });

  await recalculateJobAndCommissions(jobId);

  const zapPayload = {
    jobId: job.id,
    jobNumber: job.jobNumber,
    leadNumber: job.leadNumber,
    prolineJobId: job.prolineJobId,
    year: job.year,
    customerName: job.name,
    responses: validated.values,
    submittedAt: submittedAt.toISOString(),
    submittedByUserId: user.id,
    submittedByEmail: user.email,
  };

  const zap = await sendEndOfJobFormZapWebhook(zapPayload);
  if (!zap.ok && !zap.skipped) {
    await prisma.jobEvent.create({
      data: {
        jobId,
        type: "END_OF_JOB_FORM_ZAP_FAILED",
        source: "api",
        payload: {
          status: zap.status ?? null,
          error: zap.error ?? "unknown",
        },
      },
    });
    console.error("End-of-job form Zap webhook failed:", zap);
  }

  return NextResponse.json({ ok: true, submittedAt: submittedAt.toISOString(), zap: zap.skipped ? "skipped" : zap.ok ? "sent" : "failed" });
}
