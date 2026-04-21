import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewHrPayroll } from "@/lib/rbac";
import { displaySalespersonName } from "@/lib/salesperson-name";

function csvEscape(s: string) {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewHrPayroll(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.commissionPayout.findMany({
    orderBy: [{ payPeriodLabel: "asc" }, { salespersonId: "asc" }, { createdAt: "asc" }],
    include: {
      salesperson: { select: { name: true } },
      job: { select: { jobNumber: true, name: true, year: true } },
    },
  });

  const headers = [
    "payPeriodLabel",
    "salesperson",
    "amount",
    "jobNumber",
    "jobYear",
    "jobName",
    "notes",
    "source",
    "createdAt",
  ];
  const lines = [headers.join(",")];
  for (const p of rows) {
    lines.push(
      [
        csvEscape(p.payPeriodLabel),
        csvEscape(displaySalespersonName(p.salesperson.name)),
        p.amount.toString(),
        p.job?.jobNumber ?? "",
        p.job ? String(p.job.year) : "",
        csvEscape(p.job?.name ?? ""),
        csvEscape(p.notes ?? ""),
        p.importSourceKey ? "import" : "app",
        p.createdAt.toISOString(),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="commission-payouts-by-period.csv"',
    },
  });
}
