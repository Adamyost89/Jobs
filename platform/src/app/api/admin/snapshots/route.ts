import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewExcelSnapshots } from "@/lib/rbac";

type SnapshotDelegate = {
  findUnique: (args: object) => Promise<Record<string, unknown> | null>;
  findMany: (args: object) => Promise<Record<string, unknown>[]>;
};

function snapshotApi(): SnapshotDelegate | null {
  const d = (prisma as unknown as { spreadsheetSnapshot?: SnapshotDelegate }).spreadsheetSnapshot;
  return d ?? null;
}

/** List all captured Excel sheets (full raw rows). */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !canViewExcelSnapshots(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const delegate = snapshotApi();
  if (!delegate) {
    return NextResponse.json(
      {
        error: "Prisma client out of date",
        hint: "Stop dev server, run npm run db:generate, restart.",
        snapshots: [],
      },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const workbookKey = url.searchParams.get("workbookKey")?.trim();
  const sheetName = url.searchParams.get("sheetName")?.trim();

  if (workbookKey && sheetName) {
    const snap = await delegate.findUnique({
      where: { workbookKey_sheetName: { workbookKey, sheetName } },
    });
    if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      workbookKey: snap.workbookKey,
      sheetName: snap.sheetName,
      rowCount: snap.rowCount,
      colCount: snap.colCount,
      updatedAt: snap.updatedAt,
      rows: snap.rows,
    });
  }

  const rows = await delegate.findMany({
    orderBy: [{ workbookKey: "asc" }, { sheetName: "asc" }],
    select: {
      workbookKey: true,
      sheetName: true,
      rowCount: true,
      colCount: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ snapshots: rows });
}
