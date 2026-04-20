import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { defaultDashboardYear } from "@/lib/work-year";
import { getSignedContractsAnalytics } from "@/lib/report-analytics";

function parseYear(v: string | null, fallback: number): number {
  const t = v?.trim();
  if (t && /^\d{4}$/.test(t)) return parseInt(t, 10);
  return fallback;
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const def = defaultDashboardYear();
  const summaryYear = parseYear(url.searchParams.get("summaryYear"), def);
  const monthlyYear = parseYear(url.searchParams.get("monthlyYear"), def);

  const data = await getSignedContractsAnalytics(user, { summaryYear, monthlyYear });
  if ("error" in data) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(data);
}
