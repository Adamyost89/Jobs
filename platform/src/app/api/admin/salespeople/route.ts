import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  loadSalespeopleWithKindForAdmin,
  updateSalespersonAdminRaw,
} from "@/lib/salespeople-kind-db";
import { firstTokenName } from "@/lib/salesperson-name";

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await loadSalespeopleWithKindForAdmin();
  return NextResponse.json({ salespeople: rows });
}

const patchSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["REP", "MANAGER"]).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.kind !== undefined || d.active !== undefined, { message: "Nothing to update" });

const postSchema = z.object({
  name: z.string().min(1).max(80).trim(),
});

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const name = firstTokenName(parsed.data.name);
  if (!name) {
    return NextResponse.json({ error: "Enter a valid first name." }, { status: 400 });
  }
  const existing = await prisma.salesperson.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json({ error: "That name is already in the list." }, { status: 409 });
  }
  const id = randomUUID();
  try {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "Salesperson" ("id", "name", "active", "kind", "createdAt", "updatedAt")
        VALUES (${id}, ${name}, true, 'REP'::"SalespersonKind", NOW(), NOW())
      `
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const row = await loadSalespeopleWithKindForAdmin().then((rows) => rows.find((r) => r.id === id));
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "SALESPERSON_CREATE",
      entityType: "Salesperson",
      entityId: id,
      payload: { name },
    },
  });
  return NextResponse.json({ salesperson: row });
}

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  let row;
  try {
    row = await updateSalespersonAdminRaw(parsed.data.id, {
      kind: parsed.data.kind,
      active: parsed.data.active,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "SALESPERSON_UPDATE",
      entityType: "Salesperson",
      entityId: row.id,
      payload: { kind: parsed.data.kind, active: parsed.data.active },
    },
  });
  return NextResponse.json({ salesperson: row });
}
