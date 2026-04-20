import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewExcelSnapshots } from "@/lib/rbac";

type Search = { workbookKey?: string; sheetName?: string };

function pick(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function ExcelSnapshotViewPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canViewExcelSnapshots(user)) redirect("/dashboard");

  const sp = await searchParams;
  const workbookKey = pick(sp.workbookKey)?.trim();
  const sheetName = pick(sp.sheetName)?.trim();
  if (!workbookKey || !sheetName) {
    return (
      <p>
        Missing query params. <Link href="/dashboard/data/excel">Back</Link>
      </p>
    );
  }

  const snapDelegate = (
    prisma as unknown as {
      spreadsheetSnapshot?: {
        findUnique: (args: object) => Promise<{
          workbookKey: string;
          sheetName: string;
          rowCount: number;
          rows: unknown;
        } | null>;
      };
    }
  ).spreadsheetSnapshot;

  const snap = snapDelegate
    ? await snapDelegate.findUnique({
        where: { workbookKey_sheetName: { workbookKey, sheetName } },
      })
    : null;

  if (!snapDelegate) {
    return (
      <p className="card" style={{ margin: 0 }}>
        Prisma client is out of date. Stop dev server, run <code>npm run db:generate</code>, restart.{" "}
        <Link href="/dashboard/data/excel">Back</Link>
      </p>
    );
  }

  if (!snap) {
    return (
      <p>
        Not found. <Link href="/dashboard/data/excel">Back</Link>
      </p>
    );
  }

  const json = JSON.stringify(snap.rows, null, 2);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <Link href="/dashboard/data/excel">← All sheets</Link>
        <span style={{ color: "var(--muted)" }}>
          {snap.workbookKey} / {snap.sheetName} · {snap.rowCount} rows
        </span>
      </div>
      <pre
        className="card"
        style={{
          margin: 0,
          overflow: "auto",
          maxHeight: "75vh",
          fontSize: "0.75rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {json}
      </pre>
    </div>
  );
}
