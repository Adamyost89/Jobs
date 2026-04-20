"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  PAYOUT_COLUMN_KEYS,
  type PayoutColumnKey,
  type PayoutColumnMap,
} from "@/lib/payout-column-map";

type PreviewSheet = {
  sheetName: string;
  rowCount: number;
  suggestedHeaderRow0Based: number;
  suggestedColumnMap: PayoutColumnMap;
  previewRows: string[][];
  /** Server parses pay period + per-rep multiline cells (Commissions.xlsx). */
  layout?: "total_commissions_wide";
};

type PreviewResponse = {
  ok: true;
  fileName: string;
  sheetNames: string[];
  sheets: PreviewSheet[];
};

type TabMapping = {
  enabled: boolean;
  headerMode: "auto" | "manual";
  headerRow1Based: number;
  dataStart1Based: string;
  dataEnd1Based: string;
  /** `manual_only`: server uses only the indices below—no header guessing. */
  columnMapMode: "merge" | "manual_only";
  columnOverrides: Partial<Record<PayoutColumnKey, string>>;
};

const COLUMN_LABELS: Record<PayoutColumnKey, string> = {
  payPeriodLabel: "Pay period",
  salespersonName: "Salesperson name",
  salespersonId: "Salesperson id (cuid)",
  jobNumber: "Job #",
  amount: "Amount",
  notes: "Notes",
  importSourceKey: "Import key (optional; blank = stable row key)",
};

function columnOverridesFromPreview(s: PreviewSheet): Partial<Record<PayoutColumnKey, string>> {
  const co: Partial<Record<PayoutColumnKey, string>> = {};
  for (const k of PAYOUT_COLUMN_KEYS) {
    const v = s.suggestedColumnMap[k];
    if (typeof v === "number") co[k] = String(v);
  }
  return co;
}

function initialMappings(sheets: PreviewSheet[]): Record<string, TabMapping> {
  const out: Record<string, TabMapping> = {};
  for (const s of sheets) {
    const nameLower = s.sheetName.toLowerCase();
    const enabled =
      nameLower.includes("commission") ||
      nameLower.includes("payout") ||
      nameLower.includes("payroll") ||
      /^total commissions/i.test(s.sheetName);
    out[s.sheetName] = {
      enabled,
      headerMode: "auto",
      headerRow1Based: s.suggestedHeaderRow0Based + 1,
      dataStart1Based: "",
      dataEnd1Based: "",
      columnMapMode: "merge",
      columnOverrides: columnOverridesFromPreview(s),
    };
  }
  return out;
}

export function PayoutImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mappings, setMappings] = useState<Record<string, TabMapping>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runJson, setRunJson] = useState<string | null>(null);

  const hasPreview = preview?.ok && preview.sheets.length > 0;

  const loadPreview = useCallback(async (f: File) => {
    setError(null);
    setRunJson(null);
    setPreviewLoading(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/commissions/payouts/import/preview", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Preview failed");
        setPreview(null);
        setMappings({});
        return;
      }
      const p = data as PreviewResponse;
      setPreview(p);
      setMappings(initialMappings(p.sheets));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const onPickFile = useCallback(
    async (list: FileList | null) => {
      const f = list?.[0];
      if (!f) return;
      setFile(f);
      await loadPreview(f);
    },
    [loadPreview]
  );

  const updateMapping = useCallback((sheetName: string, patch: Partial<TabMapping>) => {
    setMappings((prev) => ({
      ...prev,
      [sheetName]: { ...prev[sheetName], ...patch },
    }));
  }, []);

  const updateColumnOverride = useCallback((sheetName: string, key: PayoutColumnKey, value: string) => {
    setMappings((prev) => {
      const cur = prev[sheetName];
      if (!cur) return prev;
      return {
        ...prev,
        [sheetName]: {
          ...cur,
          columnOverrides: { ...cur.columnOverrides, [key]: value },
        },
      };
    });
  }, []);

  const selectedCount = useMemo(
    () => (hasPreview ? preview.sheets.filter((s) => mappings[s.sheetName]?.enabled).length : 0),
    [hasPreview, preview, mappings]
  );

  const runImport = useCallback(async () => {
    if (!file || !preview) return;
    setError(null);
    setRunJson(null);
    setRunLoading(true);
    try {
      const tabs = preview.sheets
        .filter((s) => mappings[s.sheetName]?.enabled)
        .map((s) => {
          const m = mappings[s.sheetName];
          const headerRow0Based =
            m.headerMode === "manual" ? Math.max(0, m.headerRow1Based - 1) : undefined;
          const dataStartRaw = m.dataStart1Based.trim();
          const dataEndRaw = m.dataEnd1Based.trim();
          let dataStartRow0Based: number | undefined;
          if (dataStartRaw !== "") {
            const n = parseInt(dataStartRaw, 10);
            if (!Number.isFinite(n) || n < 1) {
              throw new Error(`Invalid data start row for "${s.sheetName}"`);
            }
            dataStartRow0Based = n - 1;
          }
          let dataEndExclusive: number | undefined;
          if (dataEndRaw !== "") {
            const n = parseInt(dataEndRaw, 10);
            if (!Number.isFinite(n) || n < 1) {
              throw new Error(`Invalid data end row for "${s.sheetName}"`);
            }
            dataEndExclusive = n;
          }

          const columnMap: Record<string, number> = {};
          for (const k of PAYOUT_COLUMN_KEYS) {
            const raw = (m.columnOverrides[k] ?? "").trim();
            if (raw === "") continue;
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
              throw new Error(`Invalid column index for "${s.sheetName}" → ${k}`);
            }
            columnMap[k] = n;
          }

          if (m.columnMapMode === "manual_only" && s.layout !== "total_commissions_wide") {
            if (columnMap.payPeriodLabel === undefined) {
              throw new Error(`"${s.sheetName}": manual mode requires a column index for ${COLUMN_LABELS.payPeriodLabel}`);
            }
            if (columnMap.amount === undefined) {
              throw new Error(`"${s.sheetName}": manual mode requires a column index for ${COLUMN_LABELS.amount}`);
            }
            if (columnMap.salespersonName === undefined && columnMap.salespersonId === undefined) {
              throw new Error(
                `"${s.sheetName}": manual mode requires ${COLUMN_LABELS.salespersonName} and/or ${COLUMN_LABELS.salespersonId}`
              );
            }
          }

          return {
            sheetName: s.sheetName,
            headerMode: m.headerMode,
            headerRow0Based: m.headerMode === "manual" ? headerRow0Based : undefined,
            dataStartRow0Based,
            dataEndExclusive,
            columnMap: Object.keys(columnMap).length ? columnMap : undefined,
            columnMapMode: m.columnMapMode,
          };
        });

      if (tabs.length === 0) {
        setError("Select at least one tab to import.");
        return;
      }

      const fd = new FormData();
      fd.set("file", file);
      fd.set("config", JSON.stringify({ tabs }));
      const res = await fetch("/api/commissions/payouts/import/run", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Import failed");
        return;
      }
      setRunJson(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setRunLoading(false);
    }
  }, [file, preview, mappings]);

  return (
    <div style={{ display: "grid", gap: "1.25rem", maxWidth: "min(1100px, 100%)" }}>
      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>1. Choose workbook</h2>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          <strong>Total Commissions 20xx</strong> tabs (Commissions.xlsx) use the wide layout: pay period in column A,
          one column per rep, multiline <code>job - customer - $amount</code> cells — those import automatically with
          no column map. Other tabs: one flat <strong>data row</strong> = one <code>CommissionPayout</code>; use 0-based
          column indices (A = 0). The importer merges your overrides with header guesses unless you enable{" "}
          <strong>Manual column map only</strong> (then pay period, amount, and salesperson are required).
        </p>
        <label style={{ display: "inline-flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.9rem" }}>
          <span>Excel file</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={previewLoading || runLoading}
            onChange={(e) => void onPickFile(e.target.files)}
          />
        </label>
        {previewLoading ? <p style={{ margin: 0, color: "var(--muted)" }}>Reading workbook…</p> : null}
        {file && !previewLoading ? (
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
            Selected: <code>{file.name}</code>
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="card" style={{ margin: 0, borderColor: "#b45309", color: "#fcd34d" }}>
          {error}
        </p>
      ) : null}

      {hasPreview ? (
        <div className="card" style={{ display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>2. Map tabs, rows, and columns</h2>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
            Tabs whose names look like commission/payout sheets are pre-selected. <code>Total Commissions YYYY</code>{" "}
            tabs are detected as the wide format — row/column overrides below are ignored for import; optional row
            bounds still apply.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #333)" }}>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Import</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Tab</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Rows</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Header</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Header row (1-based)</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Data start</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Data end</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Guess</th>
                </tr>
              </thead>
              <tbody>
                {preview.sheets.map((s) => {
                  const m = mappings[s.sheetName];
                  if (!m) return null;
                  return (
                    <tr key={s.sheetName} style={{ borderBottom: "1px solid var(--border, #222)" }}>
                      <td style={{ padding: "0.4rem 0.5rem" }}>
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={(e) => updateMapping(s.sheetName, { enabled: e.target.checked })}
                        />
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem" }}>
                        <code>{s.sheetName}</code>
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)" }}>{s.rowCount}</td>
                      <td style={{ padding: "0.4rem 0.5rem" }}>
                        <select
                          value={m.headerMode}
                          onChange={(e) =>
                            updateMapping(s.sheetName, {
                              headerMode: e.target.value as "auto" | "manual",
                            })
                          }
                        >
                          <option value="auto">Auto</option>
                          <option value="manual">Manual</option>
                        </select>
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem" }}>
                        <input
                          type="number"
                          min={1}
                          value={m.headerRow1Based}
                          disabled={m.headerMode === "auto"}
                          style={{ width: "4rem" }}
                          onChange={(e) =>
                            updateMapping(s.sheetName, {
                              headerRow1Based: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
                          }
                        />
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem" }}>
                        <input
                          placeholder="auto"
                          value={m.dataStart1Based}
                          style={{ width: "4.5rem" }}
                          onChange={(e) => updateMapping(s.sheetName, { dataStart1Based: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem" }}>
                        <input
                          placeholder="auto"
                          value={m.dataEnd1Based}
                          style={{ width: "4.5rem" }}
                          onChange={(e) => updateMapping(s.sheetName, { dataEnd1Based: e.target.value })}
                        />
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                        {s.layout === "total_commissions_wide" ? (
                          <>wide Total Commissions</>
                        ) : (
                          <>header ~{s.suggestedHeaderRow0Based + 1}</>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <details style={{ fontSize: "0.85rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
              Column indices (0-based; A = 0)
            </summary>
            <p style={{ margin: "0.5rem 0", color: "var(--muted)", fontSize: "0.82rem" }}>
              <strong>Merge</strong> (default): empty cells fall back to header detection. <strong>Manual only</strong>:
              only the numbers you type are used—no guessing (tabular tabs only). Optional: job #, notes, import key.
              Wide <code>Total Commissions YYYY</code> tabs ignore this section.
            </p>
            {preview.sheets.map((s) => {
              const m = mappings[s.sheetName];
              if (!m) return null;
              return (
                <details key={`co-${s.sheetName}`} style={{ marginTop: "0.65rem" }}>
                  <summary style={{ cursor: "pointer" }}>
                    <code>{s.sheetName}</code>
                    {s.layout === "total_commissions_wide" ? (
                      <span style={{ marginLeft: "0.5rem", color: "var(--muted)", fontSize: "0.78rem" }}>
                        (wide — column indices not used)
                      </span>
                    ) : null}
                  </summary>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ marginTop: "0.5rem", fontSize: "0.8rem", padding: "0.35rem 0.65rem" }}
                    onClick={() =>
                      updateMapping(s.sheetName, { columnOverrides: columnOverridesFromPreview(s) })
                    }
                  >
                    Reset columns from detected header
                  </button>
                  <label
                    style={{
                      marginTop: "0.65rem",
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "flex-start",
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={m.columnMapMode === "manual_only"}
                      onChange={(e) =>
                        updateMapping(s.sheetName, {
                          columnMapMode: e.target.checked ? "manual_only" : "merge",
                        })
                      }
                    />
                    <span>
                      <strong>Manual column map only</strong> for this tab (never guess from headers; use only the
                      indices below).
                    </span>
                  </label>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      display: "grid",
                      gridTemplateColumns: "minmax(160px,1fr) minmax(3.5rem,auto)",
                      gap: "0.35rem 0.75rem",
                      maxWidth: 520,
                      alignItems: "center",
                    }}
                  >
                    {PAYOUT_COLUMN_KEYS.map((k) => (
                      <Fragment key={`${s.sheetName}-${k}`}>
                        <label style={{ color: "var(--muted)", fontSize: "0.8rem" }} htmlFor={`${s.sheetName}-${k}`}>
                          {COLUMN_LABELS[k]}
                        </label>
                        <input
                          id={`${s.sheetName}-${k}`}
                          style={{ width: "3.5rem" }}
                          value={m.columnOverrides[k] ?? ""}
                          placeholder="auto"
                          onChange={(e) => updateColumnOverride(s.sheetName, k, e.target.value)}
                        />
                      </Fragment>
                    ))}
                  </div>
                </details>
              );
            })}
          </details>

          <details style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer" }}>Preview first rows</summary>
            {preview.sheets.map((s) => (
              <div key={`pv-${s.sheetName}`} style={{ marginTop: "0.75rem" }}>
                <strong>{s.sheetName}</strong>
                <table style={{ marginTop: "0.35rem", borderCollapse: "collapse" }}>
                  <tbody>
                    {s.previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((c, ci) => (
                          <td
                            key={ci}
                            style={{
                              border: "1px solid var(--border, #333)",
                              padding: "2px 4px",
                              maxWidth: 120,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {c || "·"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </details>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <button
              type="button"
              className="btn"
              disabled={runLoading || selectedCount === 0}
              onClick={() => void runImport()}
            >
              {runLoading ? "Importing…" : `Import ${selectedCount} tab(s)`}
            </button>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Upsert by <code>importSourceKey</code> (per-row default <code>PAYOUT_UI:…</code> if not mapped).
            </span>
          </div>
        </div>
      ) : null}

      {runJson ? (
        <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>3. Result</h2>
          <pre
            style={{
              margin: 0,
              padding: "0.75rem",
              overflow: "auto",
              maxHeight: 360,
              fontSize: "0.78rem",
              background: "var(--code-bg, #111)",
              borderRadius: 6,
            }}
          >
            {runJson}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
