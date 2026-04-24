import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { reconcileProlinePaymentsFromApi } from "@/lib/proline-payment-reconcile";

export const maxDuration = 300;

const bodySchema = z
  .object({
    apply: z.boolean().optional(),
    maxPages: z.number().int().min(1).max(500).optional(),
    tolerance: z.number().min(0).max(100).optional(),
  })
  .optional();

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data ?? {};
  try {
    const result = await reconcileProlinePaymentsFromApi(prisma, {
      apply: body.apply === true,
      maxPages: body.maxPages ?? 200,
      tolerance: body.tolerance,
    });

    return NextResponse.json({
      ok: true as const,
      apply: body.apply === true,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: message }, { status: 400 });
  }
}
