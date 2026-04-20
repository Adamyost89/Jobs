import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { defaultDashboardYear } from "@/lib/work-year";

function jobYearFilterFromQuery(
  yearParam: string | undefined,
  defaultYear: number
): {
  jobWhere: Prisma.JobWhereInput;
  label: number | "all";
} {
  const y = yearParam?.trim().toLowerCase();
  if (y === "all" || y === "") return { jobWhere: {}, label: "all" };
  if (y && /^\d{4}$/.test(y)) return { jobWhere: { year: parseInt(y, 10) }, label: parseInt(y, 10) };
  return { jobWhere: { year: defaultYear }, label: defaultYear };
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.salespersonId) {
    return NextResponse.json({ error: "No salesperson linked" }, { status: 400 });
  }

  const url = new URL(request.url);
  const preferred = defaultDashboardYear();
  const { jobWhere: yearSlice, label: yearLabel } = jobYearFilterFromQuery(
    url.searchParams.get("year") ?? undefined,
    preferred
  );

  const jobs = await prisma.job.findMany({
    where: { salespersonId: user.salespersonId, ...yearSlice },
    select: {
      jobNumber: true,
      name: true,
      contractAmount: true,
      gp: true,
      year: true,
      status: true,
    },
  });

  const commissionJobFilter: Prisma.JobWhereInput =
    Object.keys(yearSlice).length === 0 ? {} : yearSlice;

  const commissions = await prisma.commission.findMany({
    where: {
      salespersonId: user.salespersonId,
      ...(Object.keys(commissionJobFilter).length === 0
        ? {}
        : { job: commissionJobFilter }),
    },
    include: { job: { select: { jobNumber: true, name: true } } },
  });

  return NextResponse.json({ year: yearLabel, jobs, commissions });
}
