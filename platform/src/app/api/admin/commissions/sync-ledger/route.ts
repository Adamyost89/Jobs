import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { syncCommissionLedgerFromPayouts } from "@/lib/commission-ledger-sync";

export async function POST() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { scanned, updated } = await syncCommissionLedgerFromPayouts(prisma);
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "COMMISSION_LEDGER_SYNC",
        entityType: "Commission",
        entityId: "ledger",
        payload: { scanned, updated },
      },
    });
    return NextResponse.json({ ok: true, scanned, updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
