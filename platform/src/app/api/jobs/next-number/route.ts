import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/session";
import { allocateNextJobNumber } from "@/lib/job-workflow";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const year = z.coerce.number().int().parse(url.searchParams.get("year") || "2026");
  const next = await allocateNextJobNumber(year);
  return NextResponse.json({ jobNumber: next, year });
}
