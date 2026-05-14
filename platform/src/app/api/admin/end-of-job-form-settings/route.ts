import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { parseEndOfJobFormConfig, parseEndOfJobFormTrigger } from "@/lib/end-of-job-form";

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const cfg = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { endOfJobForm: true, endOfJobFormTrigger: true },
  });
  return NextResponse.json({
    endOfJobForm: cfg?.endOfJobForm ?? { version: 1, fields: [] },
    endOfJobFormTrigger: parseEndOfJobFormTrigger(cfg?.endOfJobFormTrigger),
  });
}

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = json as Record<string, unknown>;
  const data: Prisma.SystemConfigUpdateInput = {};

  if (body.endOfJobForm !== undefined) {
    const parsed = parseEndOfJobFormConfig(body.endOfJobForm);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    data.endOfJobForm = parsed.value as unknown as Prisma.InputJsonValue;
  }
  if (body.endOfJobFormTrigger !== undefined) {
    const t = parseEndOfJobFormTrigger(body.endOfJobFormTrigger);
    data.endOfJobFormTrigger = t as unknown as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }

  await prisma.systemConfig.update({
    where: { id: "singleton" },
    data,
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "END_OF_JOB_FORM_SETTINGS",
      entityType: "SystemConfig",
      entityId: "singleton",
      payload: data as object,
    },
  });
  return NextResponse.json({ ok: true });
}
