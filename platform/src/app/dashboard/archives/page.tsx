import Link from "next/link";
import { defaultDashboardYear } from "@/lib/work-year";

export default function ArchivesPage() {
  const cur = defaultDashboardYear();
  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: 640 }}>
      <h1 style={{ margin: 0 }}>Archives</h1>
      <p className="card" style={{ margin: 0, fontSize: "0.95rem", color: "var(--muted)" }}>
        Quick links to past job years. Jobs and Commissions default to <strong>{cur}</strong> (current calendar year)
        until you pick another year or <strong>All years</strong>. CSV exports and report JSON can still span every
        year — see <Link href="/dashboard/reports">Reports</Link> for <code>?year=all</code>.
      </p>
      <ul className="card" style={{ margin: 0, lineHeight: 1.7 }}>
        <li>
          <Link href="/dashboard/jobs?year=2024">Jobs — 2024</Link>
        </li>
        <li>
          <Link href="/dashboard/commissions?year=2024">Commissions — 2024</Link>
        </li>
        <li>
          <Link href="/dashboard/jobs?year=2025">Jobs — 2025</Link> ·{" "}
          <Link href="/dashboard/commissions?year=2025">Commissions — 2025</Link>
        </li>
        <li>
          <Link href="/dashboard/jobs?year=all">Jobs — all years</Link> ·{" "}
          <Link href="/dashboard/commissions?year=all">Commissions — all years</Link>
        </li>
      </ul>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
        <Link href="/dashboard/jobs">← Back to Jobs ({cur} default)</Link>
      </p>
    </div>
  );
}
