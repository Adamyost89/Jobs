"use client";

import Link from "next/link";
import { chartMonthLabelToDrill } from "@/lib/contract-signed-month";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { formatUsd } from "@/lib/currency";

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
  const money = (n: number) => formatUsd(n);
  const countByMonthLabel = new Map(monthlySignedCounts.map((row) => [row.monthLabel, row.count]));
  const repKeys = [...monthlyTopRepNames, "Other"];

  function rowTotal(row: StackedRow): number {
    return repKeys.reduce((sum, key) => sum + Number(row[key] ?? 0), 0);
  }

  const totalSignedCount = monthlySignedCounts.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  const totalsByRep = repKeys.reduce<Record<string, number>>((acc, key) => {
    acc[key] = monthlyStacked.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
    return acc;
  }, {});
  const grandSignedTotal = monthlyStacked.reduce((sum, row) => sum + rowTotal(row), 0);

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
          <th className="cell-num">Total</th>
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
            <td className="cell-num cell-strong">
              <Link href={rowMonthHref(row)} className="signed-month-drill-link">
                {money(rowTotal(row))}
              </Link>
            </td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700, background: "var(--card-border, rgba(0,0,0,0.06))" }}>
          <td>Total</td>
          <td className="cell-num">{totalSignedCount}</td>
          {monthlyTopRepNames.map((n) => (
            <td key={`total-${n}`} className="cell-num">
              {money(totalsByRep[n] ?? 0)}
            </td>
          ))}
          <td className="cell-num">{money(totalsByRep["Other"] ?? 0)}</td>
          <td className="cell-num">{money(grandSignedTotal)}</td>
        </tr>
      </tbody>
    </table>
  );
}
