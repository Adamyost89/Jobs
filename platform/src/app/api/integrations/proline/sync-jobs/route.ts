import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { syncProlineJobsFromApi } from "@/lib/proline-api-job-sync";

export const maxDuration = 300;

const bodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    maxPages: z.number().int().min(1).max(500).optional(),
    defaultYear: z.number().int().min(2020).max(2035).optional(),
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

  const defaultYear =
    body.defaultYear ??
    (process.env.PROLINE_SYNC_DEFAULT_YEAR
      ? parseInt(process.env.PROLINE_SYNC_DEFAULT_YEAR, 10)
      : new Date().getFullYear());
  if (Number.isNaN(defaultYear)) {
    return NextResponse.json({ error: "Invalid PROLINE_SYNC_DEFAULT_YEAR" }, { status: 500 });
  }

  try {
    const result = await syncProlineJobsFromApi(prisma, {
      dryRun: body.dryRun === true,
      maxPages: body.maxPages ?? 200,
      defaultYear,
      userMapJson: process.env.PROLINE_USER_MAP,
    });
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: message }, { status: 400 });
  }
}
