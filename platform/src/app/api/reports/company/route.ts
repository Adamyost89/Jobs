import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canRunFullReports, canViewCompanyRevenue } from "@/lib/rbac";
import { preferredDashboardJobYear } from "@/lib/work-year";
import type { Prisma } from "@prisma/client";

function jobYearFilterFromQuery(
  yearParam: string | undefined,
  defaultYear: number
): {
  where: Prisma.JobWhereInput;
  label: number | "all";
} {
  const y = yearParam?.trim().toLowerCase();
  if (y === "all" || y === "") return { where: {}, label: "all" };
  if (y && /^\d{4}$/.test(y)) return { where: { year: parseInt(y, 10) }, label: parseInt(y, 10) };
  return { where: { year: defaultYear }, label: defaultYear };
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewCompanyRevenue(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const preferred = await preferredDashboardJobYear(prisma);
  const { where: jobYearWhere, label: yearLabel } = jobYearFilterFromQuery(
    url.searchParams.get("year") ?? undefined,
    preferred
  );

  const allJobs = await prisma.job.findMany({
    where: jobYearWhere,
    select: { contractAmount: true, invoicedTotal: true, gp: true },
  });

  let contract = 0;
  let invoiced = 0;
  let gp = 0;
  for (const j of allJobs) {
    contract += j.contractAmount.toNumber();
    invoiced += j.invoicedTotal.toNumber();
    gp += j.gp.toNumber();
  }

  const companyPublic = {
    year: yearLabel,
    jobCount: allJobs.length,
    totalContract: contract,
    totalInvoiced: invoiced,
  };

  if (!canRunFullReports(user)) {
    return NextResponse.json({ company: companyPublic });
  }

  const commissionJobWhere: Prisma.JobWhereInput =
    Object.keys(jobYearWhere).length === 0 ? {} : jobYearWhere;

  const owed = await prisma.commission.aggregate({
    where:
      Object.keys(commissionJobWhere).length === 0
        ? {}
        : { job: commissionJobWhere },
    _sum: { owedAmount: true },
  });
  const paid = await prisma.commission.aggregate({
    where:
      Object.keys(commissionJobWhere).length === 0
        ? {}
        : { job: commissionJobWhere },
    _sum: { paidAmount: true },
  });

  return NextResponse.json({
    company: { ...companyPublic, totalGp: gp },
    commissions: {
      totalOwed: owed._sum.owedAmount?.toNumber() ?? 0,
      totalPaid: paid._sum.paidAmount?.toNumber() ?? 0,
    },
  });
}
