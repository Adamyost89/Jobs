import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewAllJobs } from "@/lib/rbac";
import { loadWagerCardPayload } from "@/lib/wager-card-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewAllJobs(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await loadWagerCardPayload(prisma);
  if (!data) return NextResponse.json({ error: "Unavailable" }, { status: 404 });

  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
