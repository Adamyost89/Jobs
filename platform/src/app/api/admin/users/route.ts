import { NextResponse } from "next/server";
import { z } from "zod";
import { PasswordTokenType, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { issuePasswordToken } from "@/lib/password-tokens";
import { getAppBaseUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";

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
      salespersonName: u.salesperson?.name ? displaySalespersonName(u.salesperson.name) : null,
      createdAt: u.createdAt,
    })),
  });
}

const createSchema = z.object({
  email: z.string().email(),
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
  const { email, role, salespersonId } = parsed.data;

  if (role === Role.SALESMAN && !salespersonId) {
    return NextResponse.json({ error: "Account manager users must be linked to a salesperson" }, { status: 400 });
  }
  if (salespersonId) {
    const sp = await prisma.salesperson.findUnique({ where: { id: salespersonId } });
    if (!sp) return NextResponse.json({ error: "Invalid salespersonId" }, { status: 400 });
    const taken = await prisma.user.findUnique({ where: { salespersonId } });
    if (taken) return NextResponse.json({ error: "That salesperson is already linked to a user" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();
  let created;
  try {
    created = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: null,
        role,
        salespersonId: salespersonId ?? null,
      },
      include: { salesperson: { select: { name: true } } },
    });
  } catch {
    return NextResponse.json({ error: "Email may already be in use" }, { status: 409 });
  }

  const resetToken = await issuePasswordToken(created.id, PasswordTokenType.SETUP);
  const baseUrl = await getAppBaseUrl();
  const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const setupEmailSent = await sendEmail({
    to: normalizedEmail,
    subject: "Set up your Elevated Sheets password",
    text: `You've been invited to Elevated Sheets.\n\nSet your password using this link (valid for 24 hours):\n${setupUrl}\n\nIf you did not expect this invite, ignore this email.`,
  });

  return NextResponse.json({
    user: {
      id: created.id,
      email: created.email,
      role: created.role,
      salespersonId: created.salespersonId,
      salespersonName: created.salesperson?.name
        ? displaySalespersonName(created.salesperson.name)
        : null,
    },
    setupEmailSent,
  });
}
