import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewAllJobs } from "@/lib/rbac";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where = canViewAllJobs(user)
    ? {}
    : user.salespersonIds.length > 0
      ? { salespersonId: { in: user.salespersonIds } }
      : { id: "__none__" };

  const rows = await prisma.commission.findMany({
    where,
    take: 1000,
    orderBy: { updatedAt: "desc" },
    include: {
      job: { include: { salesperson: true } },
      salesperson: true,
    },
  });
  return NextResponse.json({ commissions: rows });
}
