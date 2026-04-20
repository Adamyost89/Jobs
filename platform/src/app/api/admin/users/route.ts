import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

function requireSuperAdmin() {
  return getSession().then((u) => (u?.role === Role.SUPER_ADMIN ? u : null));
}

export async function GET() {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.user.findMany({
    orderBy: { email: "asc" },
    include: { salesperson: { select: { id: true, name: true } } },
  });
  return NextResponse.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      salespersonId: u.salespersonId,
      salespersonName: u.salesperson?.name ?? null,
      createdAt: u.createdAt,
    })),
  });
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  salespersonId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, role, salespersonId } = parsed.data;

  if (role === Role.SALESMAN && !salespersonId) {
    return NextResponse.json({ error: "Salesman users must be linked to a salesperson" }, { status: 400 });
  }
  if (salespersonId) {
    const sp = await prisma.salesperson.findUnique({ where: { id: salespersonId } });
    if (!sp) return NextResponse.json({ error: "Invalid salespersonId" }, { status: 400 });
    const taken = await prisma.user.findUnique({ where: { salespersonId } });
    if (taken) return NextResponse.json({ error: "That salesperson is already linked to a user" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const created = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        role,
        salespersonId: salespersonId ?? null,
      },
      include: { salesperson: { select: { name: true } } },
    });
    return NextResponse.json({
      user: {
        id: created.id,
        email: created.email,
        role: created.role,
        salespersonId: created.salespersonId,
        salespersonName: created.salesperson?.name ?? null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Email may already be in use" }, { status: 409 });
  }
}
