"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { MODERN_JOB_COLUMN_KEYS, type ModernJobColumnMap } from "@/lib/sheet-job-columns";

type PreviewSheet = {
  sheetName: string;
  rowCount: number;
  suggestedHeaderRow0Based: number;
  suggestedLayout: string;
  previewRows: string[][];
  suggestedColumnMap?: ModernJobColumnMap;
};

type PreviewResponse = {
  ok: true;
  fileName: string;
  sheetNames: string[];
  sheets: PreviewSheet[];
};

type TabMapping = {
  enabled: boolean;
  bookYear: number;
  headerMode: "auto" | "manual";
  /** 1-based Excel row index of the header row */
  headerRow1Based: number;
  /** 1-based first data row; empty string = default (row after header) */
  dataStart1Based: string;
  /** 1-based last data row inclusive; empty = through end of sheet */
  dataEnd1Based: string;
  /** `manual_only`: use only the indices below for every modern field (no header merge). */
  columnMapMode: "merge" | "manual_only";
  /** 0-based column index per field; empty string = use header auto-detect for that field only (merge mode) */
  columnOverrides: Partial<Record<keyof ModernJobColumnMap, string>>;
};

const COLUMN_LABELS: Record<keyof ModernJobColumnMap, string> = {
  lead: "Project / lead #",
  jobNumber: "Job #",
  name: "Name",
  date: "Contract signed date",
  contract: "Contract $",
  am: "AM",
  invoiced: "Invoiced total",
  amountPaid: "Amount paid",
  changeOrders: "Change orders",
  cost: "Cost",
  gp: "GP $",
  gpPercent: "GP %",
  retail: "Retail %",
  insurance: "Insurance %",
  billed: "Billed flag",
  paidInFull: "Paid in full",
  commOwed: "Comm owed",
  status: "Status",
  updateThis: "Update this",
  drewParticipation: "Drew participation",
  paidDate: "Paid date",
  projectRevenue: "Project revenue",
};

function defaultBookYear(sheetName: string): number {
  const m = /^(\d{4})$/.exec(sheetName.trim());
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

function columnOverridesFromPreview(s: PreviewSheet): Partial<Record<keyof ModernJobColumnMap, string>> {
  const co: Partial<Record<keyof ModernJobColumnMap, string>> = {};
  if (s.suggestedLayout === "modern" && s.suggestedColumnMap) {
    for (const k of MODERN_JOB_COLUMN_KEYS) {
      co[k] = String(s.suggestedColumnMap[k]);
    }
  }
  return co;
}

/** Stable fragment for in-page links from the tabs table (valid HTML id). */
function columnMapSectionId(sheetName: string): string {
  return `job-import-cmap-${sheetName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function initialMappings(sheets: PreviewSheet[]): Record<string, TabMapping> {
  const out: Record<string, TabMapping> = {};
  for (const s of sheets) {
    const year = defaultBookYear(s.sheetName);
    const enabled = /^\d{4}$/.test(s.sheetName.trim());
    const isModern = s.suggestedLayout === "modern";
    out[s.sheetName] = {
      enabled,
      bookYear: year,
      headerMode: "auto",
      headerRow1Based: s.suggestedHeaderRow0Based + 1,
      dataStart1Based: "",
      dataEnd1Based: "",
      columnMapMode: isModern ? "manual_only" : "merge",
      columnOverrides: columnOverridesFromPreview(s),
    };
  }
  return out;
}

export function JobWorkbookImportForm() {
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
      const res = await fetch("/api/jobs/import/preview", { method: "POST", body: fd });
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

  const updateColumnOverride = useCallback((sheetName: string, key: keyof ModernJobColumnMap, value: string) => {
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
              throw new Error(`Invalid data start row for "${s.sheetName}" (use 1-based Excel row, or leave blank)`);
            }
            dataStartRow0Based = n - 1;
          }
          let dataEndExclusive: number | undefined;
          if (dataEndRaw !== "") {
            const n = parseInt(dataEndRaw, 10);
            if (!Number.isFinite(n) || n < 1) {
              throw new Error(`Invalid data end row for "${s.sheetName}" (1-based inclusive last row, or leave blank)`);
            }
            dataEndExclusive = n;
          }

          let columnMap: Record<string, number> | undefined;
          if (s.suggestedLayout === "modern") {
            const cm: Record<string, number> = {};
            for (const k of MODERN_JOB_COLUMN_KEYS) {
              const raw = (m.columnOverrides[k] ?? "").trim();
              if (raw === "") continue;
              const n = parseInt(raw, 10);
              if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                throw new Error(
                  `Invalid column index for "${s.sheetName}" → ${String(k)} (use a non‑negative integer, or leave blank to use header detection)`
                );
              }
              cm[k] = n;
            }
            if (m.columnMapMode === "manual_only") {
              const missing = MODERN_JOB_COLUMN_KEYS.filter((k) => cm[k] === undefined);
              if (missing.length) {
                throw new Error(
                  `"${s.sheetName}": manual column mode requires a 0-based index for every modern field (A=0). Missing: ${missing.join(", ")}`
                );
              }
              columnMap = cm;
            } else if (Object.keys(cm).length > 0) {
              columnMap = cm;
            }
          }

          return {
            sheetName: s.sheetName,
            bookYear: m.bookYear,
            headerMode: m.headerMode,
            headerRow0Based: m.headerMode === "manual" ? headerRow0Based : undefined,
            dataStartRow0Based,
            dataEndExclusive,
            columnMap,
            columnMapMode: s.suggestedLayout === "modern" ? m.columnMapMode : undefined,
          };
        });

      if (tabs.length === 0) {
        setError("Select at least one tab to import.");
        return;
      }

      const fd = new FormData();
      fd.set("file", file);
      fd.set("config", JSON.stringify({ tabs }));
      const res = await fetch("/api/jobs/import/run", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Import failed";
        const hint =
          typeof msg === "string" && msg.includes("Unknown argument")
            ? " If this mentions a Prisma field, stop dev, run `npm run db:generate` in `platform/`, delete `.next`, then restart."
            : "";
        setError(msg + hint);
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
          Upload your Job Numbering export (<code>.xlsx</code>). Preview loads sheet names and the first few rows so
          you can set the <strong>book year</strong>, optional <strong>data row range</strong> (1-based, like Excel), the
          <strong>header row</strong>, and for <strong>modern</strong> tabs a <strong>full column map</strong> (0-based
          indices, column A = 0) shown in step 2.
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
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>2. Map tabs → book year, rows, columns</h2>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
            Tabs named <code>2024</code>, <code>2025</code>, <code>2026</code> are pre-selected. Header{" "}
            <strong>Auto</strong> scans for the Job Numbering header row; <strong>Manual</strong> uses the row you
            enter. Leave data start/end blank to import from the row after the header through the last row.{" "}
            <strong>Modern</strong> tabs: use the <strong>Column map</strong> section below (link from the table) to set
            every field; rows without a project/lead number are skipped. <strong>$0</strong> contract rows still import
            when lead and job number are present. <strong>Legacy</strong> tabs use fixed column positions in the
            importer (no per-column map).
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #333)" }}>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Import</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Tab</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Rows</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Book year</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Header</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Header row (1-based)</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Data start (1-based)</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Data end (1-based, inclusive)</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Columns</th>
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
                        <input
                          type="number"
                          min={2020}
                          max={2035}
                          value={m.bookYear}
                          style={{ width: "4.5rem" }}
                          onChange={(e) =>
                            updateMapping(s.sheetName, { bookYear: parseInt(e.target.value, 10) || m.bookYear })
                          }
                        />
                      </td>
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
                      <td style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}>
                        {s.suggestedLayout === "modern" ? (
                          <a href={`#${columnMapSectionId(s.sheetName)}`} style={{ color: "var(--accent, #93c5fd)" }}>
                            Set map
                          </a>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>Fixed</span>
                        )}
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                        header ~{s.suggestedHeaderRow0Based + 1}, {s.suggestedLayout}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            id="job-import-column-maps"
            style={{
              display: "grid",
              gap: "0.85rem",
              paddingTop: "0.25rem",
              borderTop: "1px solid var(--border, #333)",
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Column map (modern tabs)</h3>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                Each field is the <strong>0-based</strong> sheet column (A = 0, B = 1, …). Values are pre-filled from the
                detected header; adjust if anything is wrong. By default <strong>Manual column map only</strong> is on
                (every field below is required; header text is not re-scanned at import). Uncheck it to{" "}
                <strong>merge</strong> header auto-detect with any overrides you leave set.
              </p>
            </div>
            {preview.sheets.map((s) => {
              const m = mappings[s.sheetName];
              if (!m) return null;
              if (s.suggestedLayout !== "modern") {
                return (
                  <p key={`co-${s.sheetName}`} style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                    <code>{s.sheetName}</code> — <strong>legacy</strong> layout: fixed column positions in the importer
                    (no map).
                  </p>
                );
              }
              return (
                <div
                  key={`co-${s.sheetName}`}
                  id={columnMapSectionId(s.sheetName)}
                  style={{
                    padding: "0.75rem",
                    borderRadius: 8,
                    border: "1px solid var(--border, #333)",
                    background: "var(--code-bg, #0d0d0d)",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 0.75rem" }}>
                    <h4 style={{ margin: 0, fontSize: "0.95rem" }}>
                      Tab <code>{s.sheetName}</code>
                    </h4>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ fontSize: "0.8rem", padding: "0.35rem 0.65rem" }}
                      onClick={() =>
                        updateMapping(s.sheetName, { columnOverrides: columnOverridesFromPreview(s) })
                      }
                    >
                      Reset from detected header
                    </button>
                  </div>
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
                      <strong>Manual column map only</strong> (recommended): require an index for every field below;
                      import uses only these numbers.
                    </span>
                  </label>
                  <div
                    style={{
                      marginTop: "0.65rem",
                      display: "grid",
                      gridTemplateColumns: "minmax(140px, 1fr) minmax(3.5rem, auto)",
                      gap: "0.35rem 0.75rem",
                      maxWidth: 520,
                      alignItems: "center",
                    }}
                  >
                    {MODERN_JOB_COLUMN_KEYS.map((k) => (
                      <Fragment key={`${s.sheetName}-${k}`}>
                        <label style={{ color: "var(--muted)", fontSize: "0.8rem" }} htmlFor={`${s.sheetName}-${k}`}>
                          {COLUMN_LABELS[k]}
                        </label>
                        <input
                          id={`${s.sheetName}-${k}`}
                          style={{ width: "3.5rem" }}
                          value={m.columnOverrides[k] ?? ""}
                          placeholder={m.columnMapMode === "manual_only" ? "req" : "auto"}
                          onChange={(e) => updateColumnOverride(s.sheetName, k, e.target.value)}
                        />
                      </Fragment>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <details style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer" }}>Preview first rows (truncated)</summary>
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
              {runLoading ? "Importing…" : `Import ${selectedCount} tab(s) into Jobs`}
            </button>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Jobs are upserted by job number; commissions recalc per row. Result JSON includes{" "}
              <code>skippedNoLead</code> per modern tab.
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
