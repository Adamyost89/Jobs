import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewExcelSnapshots } from "@/lib/rbac";

export default async function ExcelSnapshotsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canViewExcelSnapshots(user)) redirect("/dashboard");

  const snapDelegate = (
    prisma as unknown as {
      spreadsheetSnapshot?: {
        findMany: (args: object) => Promise<
          {
            workbookKey: string;
            sheetName: string;
            rowCount: number;
            colCount: number;
            updatedAt: Date;
          }[]
        >;
      };
    }
  ).spreadsheetSnapshot;

  const snaps = snapDelegate
    ? await snapDelegate.findMany({
        orderBy: [{ workbookKey: "asc" }, { sheetName: "asc" }],
        select: {
          workbookKey: true,
          sheetName: true,
          rowCount: true,
          colCount: true,
          updatedAt: true,
        },
      })
    : [];

  const byBook = new Map<string, typeof snaps>();
  for (const s of snaps) {
    if (!byBook.has(s.workbookKey)) byBook.set(s.workbookKey, []);
    byBook.get(s.workbookKey)!.push(s);
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ margin: 0 }}>Excel capture (full sheets)</h1>
      <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)" }}>
        Every tab from every <code>.xlsx</code> in your repo folder is stored here as JSON (run{" "}
        <code>npm run import:xlsx-snapshots</code> or <code>npm run import:all</code>). This is separate from the Job
        Numbering import (<code>npm run import:jobs</code>), which feeds dashboards and commissions. Use snapshots if a
        tab is not yet modeled in Jobs — nothing is discarded.
      </p>
      {!snapDelegate && (
        <p className="card" style={{ margin: 0, borderColor: "#b45309", color: "#fcd34d" }}>
          Prisma client is out of date (no <code>SpreadsheetSnapshot</code> model). Stop <code>npm run dev</code>, run{" "}
          <code>npm run db:generate</code> or <code>npx prisma generate</code> from <code>platform/</code>, then start dev
          again. On Windows, if generate fails with EPERM, close every Node process using this folder, then retry.
        </p>
      )}
      {snapDelegate && snaps.length === 0 ? (
        <p className="card" style={{ margin: 0 }}>
          No snapshots yet. From <code>platform/</code> run <code>npm run import:xlsx-snapshots</code>.
        </p>
      ) : snapDelegate ? (
        [...byBook.entries()].map(([key, list]) => (
          <section key={key} className="card" style={{ display: "grid", gap: "0.5rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{key}</h2>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
              {list.map((s) => (
                <li key={s.sheetName}>
                  <Link
                    href={`/dashboard/data/excel/view?workbookKey=${encodeURIComponent(s.workbookKey)}&sheetName=${encodeURIComponent(s.sheetName)}`}
                  >
                    {s.sheetName}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({s.rowCount}×{s.colCount})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : null}
    </div>
  );
}
