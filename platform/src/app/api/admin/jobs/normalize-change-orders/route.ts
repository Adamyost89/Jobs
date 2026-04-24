import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { normalizeChangeOrdersWhenPaidMatchesContract } from "@/lib/job-change-order-normalization";

export async function POST() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { scanned, matched, updated } = await normalizeChangeOrdersWhenPaidMatchesContract(prisma);
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "JOB_CHANGE_ORDERS_NORMALIZED",
        entityType: "Job",
        entityId: "bulk",
        payload: { scanned, matched, updated },
      },
    });
    return NextResponse.json({ ok: true, scanned, matched, updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
