import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  commissionPlanForJobYear,
  defaultCommissionPlanConfig,
} from "@/lib/commission-plan-defaults";
import { isCommissionPlanConfigV1 } from "@/lib/commission-plan-types";

function parseYear(raw: string): number | null {
  const y = parseInt(raw, 10);
  if (y < 2000 || y > 2100) return null;
  return y;
}

export async function GET(_req: Request, ctx: { params: Promise<{ year: string }> }) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { year: ys } = await ctx.params;
  const year = parseYear(ys);
  if (year === null) return NextResponse.json({ error: "Invalid year" }, { status: 400 });

  const row = await prisma.commissionPlan.findUnique({ where: { year } });
  const effective = commissionPlanForJobYear(year, row?.config);
  return NextResponse.json({
    year,
    hasStoredOverride: !!row,
    plan: effective,
    defaults: defaultCommissionPlanConfig(year),
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ year: string }> }) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { year: ys } = await ctx.params;
  const year = parseYear(ys);
  if (year === null) return NextResponse.json({ error: "Invalid year" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || !isCommissionPlanConfigV1(body)) {
    return NextResponse.json({ error: "Body must be a valid commission plan (version 1)" }, { status: 400 });
  }

  await prisma.commissionPlan.upsert({
    where: { year },
    create: { year, config: body as Prisma.InputJsonValue },
    update: { config: body as Prisma.InputJsonValue },
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "COMMISSION_PLAN_UPSERT",
      entityType: "CommissionPlan",
      entityId: String(year),
      payload: { year },
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ year: string }> }) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { year: ys } = await ctx.params;
  const year = parseYear(ys);
  if (year === null) return NextResponse.json({ error: "Invalid year" }, { status: 400 });

  await prisma.commissionPlan.deleteMany({ where: { year } });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "COMMISSION_PLAN_DELETE",
      entityType: "CommissionPlan",
      entityId: String(year),
      payload: { year },
    },
  });
  return NextResponse.json({ ok: true });
}
