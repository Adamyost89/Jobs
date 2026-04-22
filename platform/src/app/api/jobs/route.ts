import { NextResponse } from "next/server";
import { z } from "zod";
import { Role, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewAllJobs } from "@/lib/rbac";
import { allocateNextJobNumber, recalculateJobAndCommissions } from "@/lib/job-workflow";
import { normalizeStatus } from "@/lib/status";
import { sortJobsByJobNumber } from "@/lib/job-sort";
import { resolveOrCreateSalespersonByName } from "@/lib/salesperson-name";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where = canViewAllJobs(user)
    ? {}
    : user.salespersonIds.length > 0
      ? { salespersonId: { in: user.salespersonIds } }
      : { id: "__none__" };

  const jobsRaw = await prisma.job.findMany({
    where,
    take: 5000,
    include: { salesperson: true },
  });
  const jobs = sortJobsByJobNumber(jobsRaw, "desc");
  return NextResponse.json({ jobs });
}

const createSchema = z.object({
  year: z.number().int().min(2020).max(2035),
  leadNumber: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  contractAmount: z.number().optional(),
  salespersonName: z.string().optional(),
  prolineJobId: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const jobNumber = await allocateNextJobNumber(d.year);
  let salespersonId: string | null = null;
  if (d.salespersonName) {
    const sp = await resolveOrCreateSalespersonByName(prisma, d.salespersonName, {
      preferFirstToken: true,
    });
    salespersonId = sp?.id ?? null;
  }
  const contract = new Prisma.Decimal((d.contractAmount ?? 0).toFixed(2));
  const job = await prisma.job.create({
    data: {
      jobNumber,
      year: d.year,
      leadNumber: d.leadNumber ?? null,
      name: d.name ?? null,
      contractAmount: contract,
      projectRevenue: contract,
      salespersonId,
      prolineJobId: d.prolineJobId ?? null,
      status: normalizeStatus(""),
    },
  });
  await prisma.jobEvent.create({
    data: {
      jobId: job.id,
      type: "JOB_CREATED",
      source: "api",
      payload: { by: user.id },
    },
  });
  await recalculateJobAndCommissions(job.id);
  const full = await prisma.job.findUnique({
    where: { id: job.id },
    include: { salesperson: true },
  });
  return NextResponse.json({ job: full });
}
