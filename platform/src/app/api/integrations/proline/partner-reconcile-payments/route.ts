import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  getPartnerReconcileJob,
  startPartnerReconcileJob,
} from "@/lib/partner-reconcile-job";

/** Background job returns immediately; polling does the wait (avoids Cloudflare 524). */
export const maxDuration = 60;

const bodySchema = z
  .object({
    apply: z.boolean().optional(),
    maxPages: z.number().int().min(1).max(200).optional(),
    tolerance: z.number().min(0).max(100).optional(),
    createdAfter: z.string().nullable().optional(),
    createdBefore: z.string().nullable().optional(),
    includeInvoices: z.boolean().optional(),
  })
  .optional();

function requireAdmin() {
  return getSession().then((user) => {
    if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
      return null;
    }
    return user;
  });
}

export async function GET(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const runId = new URL(req.url).searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const job = getPartnerReconcileJob(runId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Unknown or expired runId" }, { status: 404 });
  }

  if (job.status === "running") {
    return NextResponse.json({
      ok: true as const,
      status: "running" as const,
      runId: job.id,
      apply: job.apply,
      startedAt: job.startedAt,
    });
  }

  if (job.status === "error") {
    return NextResponse.json({
      ok: false as const,
      status: "error" as const,
      runId: job.id,
      apply: job.apply,
      error: job.error ?? "Partner reconcile failed",
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
  }

  return NextResponse.json({
    ok: true as const,
    status: "done" as const,
    runId: job.id,
    apply: job.apply,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ...(job.result ?? {}),
  });
}

export async function POST(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data ?? {};
  const job = startPartnerReconcileJob(
    prisma,
    {
      apply: body.apply === true,
      maxPages: body.maxPages ?? 80,
      tolerance: body.tolerance,
      createdAfter: body.createdAfter,
      createdBefore: body.createdBefore,
      includeInvoices: body.includeInvoices === true,
    },
    { userId: user.id }
  );

  return NextResponse.json({
    ok: true as const,
    status: job.status,
    runId: job.id,
    apply: job.apply,
    startedAt: job.startedAt,
    message:
      job.status === "running"
        ? "Partner reconcile started in the background. Poll with ?runId=…"
        : undefined,
  });
}
