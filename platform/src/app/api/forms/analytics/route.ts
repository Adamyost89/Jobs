import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/session";
import { canRunFullReports } from "@/lib/rbac";
import { getEndOfJobFormAnalytics } from "@/lib/end-of-job-form-analytics";

function parseYear(v: string | null): number | null {
  const t = v?.trim();
  if (!t || t === "all") return null;
  if (/^\d{4}$/.test(t)) return parseInt(t, 10);
  return null;
}

function parseDate(v: string | null): Date | null {
  const t = v?.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === Role.HR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const year = parseYear(url.searchParams.get("year"));
  const submittedFrom = parseDate(url.searchParams.get("submittedFrom"));
  const submittedTo = parseDate(url.searchParams.get("submittedTo"));

  let salespersonId: string | null = url.searchParams.get("sp")?.trim() || null;
  if (salespersonId && !canRunFullReports(user)) {
    salespersonId = null;
  }

  const data = await getEndOfJobFormAnalytics(user, {
    year,
    salespersonId,
    submittedFrom,
    submittedTo,
  });

  if ("error" in data) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(data);
}
