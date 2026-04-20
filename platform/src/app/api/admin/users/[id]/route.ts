import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

const patchSchema = z
  .object({
    role: z.nativeEnum(Role).optional(),
    salespersonId: z.string().nullable().optional(),
    newPassword: z.string().min(8).optional(),
  })
  .partial();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSession();
  if (!me || me.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const p = parsed.data;
  const nextRole = p.role ?? target.role;
  const nextSpId =
    p.salespersonId !== undefined ? p.salespersonId : nextRole === Role.SALESMAN ? target.salespersonId : null;

  if (nextRole === Role.SALESMAN && !nextSpId) {
    return NextResponse.json({ error: "Salesman users must be linked to a salesperson" }, { status: 400 });
  }

  if (nextSpId) {
    const sp = await prisma.salesperson.findUnique({ where: { id: nextSpId } });
    if (!sp) return NextResponse.json({ error: "Invalid salespersonId" }, { status: 400 });
    const taken = await prisma.user.findFirst({
      where: { salespersonId: nextSpId, NOT: { id } },
    });
    if (taken) return NextResponse.json({ error: "Salesperson already linked to another user" }, { status: 400 });
  }

  const data: { role?: Role; salespersonId?: string | null; passwordHash?: string } = {};
  if (p.role !== undefined) data.role = p.role;
  if (p.role !== undefined && p.role !== Role.SALESMAN) {
    data.salespersonId = null;
  } else if (p.salespersonId !== undefined) {
    data.salespersonId = p.salespersonId;
  }
  if (p.newPassword) data.passwordHash = await bcrypt.hash(p.newPassword, 12);

  const updated = await prisma.user.update({
    where: { id },
    data,
    include: { salesperson: { select: { name: true } } },
  });

  return NextResponse.json({
    user: {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      salespersonId: updated.salespersonId,
      salespersonName: updated.salesperson?.name ?? null,
    },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSession();
  if (!me || me.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (id === me.id) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (target.role === Role.SUPER_ADMIN) {
    const superAdminCount = await prisma.user.count({ where: { role: Role.SUPER_ADMIN } });
    if (superAdminCount <= 1) {
      return NextResponse.json({ error: "Cannot delete the last super admin" }, { status: 400 });
    }
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
