import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  cutoverComplete: z.boolean(),
});

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const cfg = await prisma.systemConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", cutoverComplete: parsed.data.cutoverComplete },
    update: { cutoverComplete: parsed.data.cutoverComplete },
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "CUTOVER_TOGGLE",
      entityType: "SystemConfig",
      entityId: "singleton",
      payload: parsed.data,
    },
  });
  return NextResponse.json({ cutoverComplete: cfg.cutoverComplete });
}
