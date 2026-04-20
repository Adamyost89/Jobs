import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { preferredDashboardJobYear } from "@/lib/work-year";
import { getFinancialMetricsAnalytics } from "@/lib/report-financial-metrics";

function parseYear(v: string | null, fallback: number): number {
  const t = v?.trim();
  if (t && /^\d{4}$/.test(t)) return parseInt(t, 10);
  return fallback;
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const def = await preferredDashboardJobYear(prisma);
  const summaryYear = parseYear(url.searchParams.get("summaryYear"), def);
  const jobId = url.searchParams.get("jobId")?.trim() || null;
  const jobNumber = url.searchParams.get("jobNumber")?.trim() || null;

  const data = await getFinancialMetricsAnalytics(user, { summaryYear, jobId, jobNumber });
  if ("error" in data) {
    if (data.error === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(data);
}
