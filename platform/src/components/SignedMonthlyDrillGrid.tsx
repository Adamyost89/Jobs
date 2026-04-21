"use client";

import Link from "next/link";
import { chartMonthLabelToDrill } from "@/lib/contract-signed-month";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";

type StackedRow = { monthLabel: string; [key: string]: string | number };

export function SignedMonthlyDrillGrid({
  monthlyYear,
  monthlyTopRepNames,
  monthlyStacked,
  monthlySignedCounts,
  salespersonIdByRepName,
}: {
  monthlyYear: number;
  monthlyTopRepNames: string[];
  monthlyStacked: StackedRow[];
  monthlySignedCounts: { monthLabel: string; count: number }[];
  salespersonIdByRepName: Record<string, string>;
}) {
  const money = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const countByMonthLabel = new Map(monthlySignedCounts.map((row) => [row.monthLabel, row.count]));

  function cellHref(repKey: string, row: StackedRow): string {
    const slice = chartMonthLabelToDrill(row.monthLabel);
    const spId = repKey === "Other" ? undefined : salespersonIdByRepName[repKey];
    return jobsDrilldownUrl({
      year: monthlyYear,
      salespersonId: spId,
      signedMonth: slice.signedMonth,
      signedUndated: slice.signedUndated,
    });
  }

  function rowMonthHref(row: StackedRow): string {
    const slice = chartMonthLabelToDrill(row.monthLabel);
    return jobsDrilldownUrl({
      year: monthlyYear,
      signedMonth: slice.signedMonth,
      signedUndated: slice.signedUndated,
    });
  }

  return (
    <table className="table table-data" style={{ fontSize: "0.82rem" }}>
      <thead>
        <tr>
          <th>Month</th>
          <th className="cell-num">Signed #</th>
          {monthlyTopRepNames.map((n) => (
            <th key={n} className="cell-num">
              {n}
            </th>
          ))}
          <th className="cell-num">Other</th>
        </tr>
      </thead>
      <tbody>
        {monthlyStacked.map((row) => (
          <tr key={String(row.monthLabel)}>
            <td className="cell-strong">
              <Link href={rowMonthHref(row)} className="signed-month-drill-link">
                {row.monthLabel}
              </Link>
            </td>
            <td className="cell-num">
              <Link href={rowMonthHref(row)} className="signed-month-drill-link">
                {Number(countByMonthLabel.get(String(row.monthLabel)) ?? 0)}
              </Link>
            </td>
            {monthlyTopRepNames.map((n) => (
              <td key={n} className="cell-num">
                <Link href={cellHref(n, row)} className="signed-month-drill-link">
                  {money(Number(row[n] ?? 0))}
                </Link>
              </td>
            ))}
            <td className="cell-num">
              <Link href={cellHref("Other", row)} className="signed-month-drill-link">
                {money(Number(row["Other"] ?? 0))}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
