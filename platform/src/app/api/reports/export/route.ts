import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canRunFullReports } from "@/lib/rbac";

function csvEscape(s: string) {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "mine";

  if (scope === "full" && !canRunFullReports(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where =
    scope === "full"
      ? {}
      : user.salespersonId
        ? { salespersonId: user.salespersonId }
        : { id: "__none__" };

  const jobs = await prisma.job.findMany({
    where,
    include: { salesperson: true },
    orderBy: { jobNumber: "asc" },
  });

  const headers = [
    "jobNumber",
    "year",
    "leadNumber",
    "name",
    "salesperson",
    "status",
    "contractAmount",
    "changeOrders",
    "invoicedTotal",
    "amountPaid",
    "cost",
    "gp",
    "gpPercent",
    "retailPercent",
    "insurancePercent",
    "commOwedFlag",
    "updateMarker",
    "contractSignedAt",
  ];
  const lines = [headers.join(",")];
  for (const j of jobs) {
    lines.push(
      [
        j.jobNumber,
        String(j.year),
        j.leadNumber ?? "",
        csvEscape(j.name ?? ""),
        j.salesperson?.name ?? "",
        j.status,
        j.contractAmount.toString(),
        j.changeOrders.toString(),
        j.invoicedTotal.toString(),
        j.amountPaid?.toString() ?? "",
        j.cost.toString(),
        j.gp.toString(),
        j.gpPercent.toString(),
        j.retailPercent?.toString() ?? "",
        j.insurancePercent?.toString() ?? "",
        j.commOwedFlag ? "true" : "false",
        j.updateMarker ? "true" : "false",
        j.contractSignedAt ? j.contractSignedAt.toISOString() : "",
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobs-${scope}.csv"`,
    },
  });
}
