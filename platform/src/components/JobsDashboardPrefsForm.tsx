"use client";

import Link from "next/link";
import {
  DEFAULT_JOBS_TABLE_PREFS,
  JOB_TABLE_COLUMN_IDS,
  JOB_TABLE_COLUMN_LABELS,
  type JobTableColumnId,
  type JobsTablePrefsV1,
} from "@/lib/jobs-table-preferences";

export function JobsDashboardPrefsForm({
  prefs,
  onChange,
  variant,
  startOpen = false,
}: {
  prefs: JobsTablePrefsV1;
  onChange: (next: JobsTablePrefsV1) => void;
  variant: "jobs" | "settings";
  startOpen?: boolean;
}) {
  const h = prefs.highlights;

  function moveColumn(id: JobTableColumnId, dir: -1 | 1) {
    const order = [...prefs.columnOrder];
    const i = order.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    onChange({ ...prefs, columnOrder: order });
  }

  function toggleHidden(id: JobTableColumnId) {
    const hidden = new Set(prefs.hiddenColumns);
    const wasHidden = hidden.has(id);
    if (!wasHidden) {
      const visibleCount = JOB_TABLE_COLUMN_IDS.filter((cid) => !hidden.has(cid)).length;
      if (visibleCount <= 1) return;
      hidden.add(id);
    } else {
      hidden.delete(id);
    }
    onChange({ ...prefs, hiddenColumns: [...hidden] });
  }

  function resetPrefs() {
    onChange(JSON.parse(JSON.stringify(DEFAULT_JOBS_TABLE_PREFS)) as JobsTablePrefsV1);
  }

  const shellClass = variant === "settings" ? undefined : "card";
  const shellStyle =
    variant === "settings"
      ? { marginBottom: 0 as const }
      : { padding: "0.85rem 1rem" as const, marginBottom: "0.75rem" as const };

  return (
    <details className={shellClass} style={shellStyle} open={startOpen}>
      <summary style={{ cursor: "pointer", fontWeight: 650, color: "var(--text)" }}>
        Table &amp; row highlight preferences
      </summary>
      <p style={{ margin: "0.65rem 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Column order and visibility, GP band thresholds, and highlight colors are saved in{" "}
        <strong style={{ color: "var(--text)" }}>this browser only</strong>.
        {variant === "jobs" ? (
          <>
            {" "}
            Super admins can mirror these controls under <Link href="/dashboard/settings">Settings</Link>.
          </>
        ) : (
          <>
            {" "}
            They apply on the <Link href="/dashboard/jobs">Jobs</Link> grid in this same browser.
          </>
        )}
      </p>

      <div style={{ display: "grid", gap: "1rem" }}>
        <div>
          <div style={{ fontWeight: 650, marginBottom: "0.4rem", fontSize: "0.9rem" }}>Columns</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.35rem" }}>
            {prefs.columnOrder.map((id) => {
              const hidden = prefs.hiddenColumns.includes(id);
              return (
                <li
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    fontSize: "0.86rem",
                  }}
                >
                  <span style={{ minWidth: "10rem", color: "var(--text)" }}>{JOB_TABLE_COLUMN_LABELS[id]}</span>
                  <button type="button" className="btn secondary" style={{ padding: "0.2rem 0.45rem" }} onClick={() => moveColumn(id, -1)}>
                    Up
                  </button>
                  <button type="button" className="btn secondary" style={{ padding: "0.2rem 0.45rem" }} onClick={() => moveColumn(id, 1)}>
                    Down
                  </button>
                  <label className="filter-check" style={{ cursor: "pointer", margin: 0 }}>
                    <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(id)} />
                    Visible
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div style={{ display: "grid", gap: "0.5rem", maxWidth: "28rem" }}>
          <div style={{ fontWeight: 650, fontSize: "0.9rem" }}>GP highlight thresholds</div>
          <label>
            Strong GP% (green when revenue &gt; min and GP% ≥ this)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={h.strongGpPct}
              onChange={(e) =>
                onChange({
                  ...prefs,
                  highlights: { ...h, strongGpPct: Number(e.target.value) || 0 },
                })
              }
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <label>
            Mid-range GP% (blue when revenue &gt; min and GP% is between thin/strong)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={h.mediumGpPct}
              onChange={(e) =>
                onChange({
                  ...prefs,
                  highlights: { ...h, mediumGpPct: Number(e.target.value) || 0 },
                })
              }
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <label>
            Thin margin GP% (red / billing warn when GP% &gt; 0 and below this)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={h.thinGpPct}
              onChange={(e) =>
                onChange({
                  ...prefs,
                  highlights: { ...h, thinGpPct: Number(e.target.value) || 0 },
                })
              }
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <label>
            Complete status green floor (GP% ≥ this when status contains COMPLETE)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={h.completeMinGpPct}
              onChange={(e) =>
                onChange({
                  ...prefs,
                  highlights: { ...h, completeMinGpPct: Number(e.target.value) || 0 },
                })
              }
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <label>
            Minimum revenue for GP% band highlights
            <input
              type="number"
              min={0}
              step={50}
              value={h.minRevenue}
              onChange={(e) =>
                onChange({
                  ...prefs,
                  highlights: { ...h, minRevenue: Math.max(0, Number(e.target.value) || 0) },
                })
              }
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </label>
        </div>

        <div>
          <div style={{ fontWeight: 650, marginBottom: "0.4rem", fontSize: "0.9rem" }}>Row colors</div>
          <div style={{ display: "grid", gap: "0.65rem", maxWidth: "32rem" }}>
            {(
              [
                ["good", "Strong / good"],
                ["medium", "Mid range / watch"],
                ["bad", "Thin margin / loss"],
                ["warn", "Cancelled / billing risk"],
              ] as const
            ).map(([key, title]) => {
              const c = h.colors[key];
              return (
                <fieldset
                  key={key}
                  style={{
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    padding: "0.5rem 0.65rem",
                    margin: 0,
                  }}
                >
                  <legend style={{ padding: "0 0.35rem", fontSize: "0.82rem" }}>
                    {h.labels[key] || title}
                  </legend>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                    <label style={{ fontSize: "0.78rem", gridColumn: "1 / -1" }}>
                      Label text
                      <input
                        type="text"
                        value={h.labels[key]}
                        onChange={(e) =>
                          onChange({
                            ...prefs,
                            highlights: {
                              ...h,
                              labels: { ...h.labels, [key]: e.target.value },
                            },
                          })
                        }
                        style={{ width: "100%", marginTop: 2 }}
                      />
                    </label>
                    <label style={{ fontSize: "0.78rem" }}>
                      Left border
                      <input
                        type="color"
                        value={hexFromCssColor(c.border)}
                        onChange={(e) =>
                          onChange({
                            ...prefs,
                            highlights: {
                              ...h,
                              colors: { ...h.colors, [key]: { ...c, border: e.target.value } },
                            },
                          })
                        }
                        style={{ width: "100%", height: 28, marginTop: 2 }}
                      />
                    </label>
                    <label style={{ fontSize: "0.78rem" }}>
                      Row tint (CSS)
                      <input
                        type="text"
                        value={c.rowBg}
                        onChange={(e) =>
                          onChange({
                            ...prefs,
                            highlights: {
                              ...h,
                              colors: { ...h.colors, [key]: { ...c, rowBg: e.target.value } },
                            },
                          })
                        }
                        style={{ width: "100%", marginTop: 2 }}
                      />
                    </label>
                    <label style={{ fontSize: "0.78rem" }}>
                      Legend chip bg
                      <input
                        type="text"
                        value={c.legendBg}
                        onChange={(e) =>
                          onChange({
                            ...prefs,
                            highlights: {
                              ...h,
                              colors: { ...h.colors, [key]: { ...c, legendBg: e.target.value } },
                            },
                          })
                        }
                        style={{ width: "100%", marginTop: 2 }}
                      />
                    </label>
                    <label style={{ fontSize: "0.78rem" }}>
                      Legend text
                      <input
                        type="color"
                        value={hexFromCssColor(c.legendText)}
                        onChange={(e) =>
                          onChange({
                            ...prefs,
                            highlights: {
                              ...h,
                              colors: { ...h.colors, [key]: { ...c, legendText: e.target.value } },
                            },
                          })
                        }
                        style={{ width: "100%", height: 28, marginTop: 2 }}
                      />
                    </label>
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>

        <div>
          <button type="button" className="btn secondary" onClick={resetPrefs}>
            Reset table preferences to defaults
          </button>
        </div>
      </div>
    </details>
  );
}

/** Best-effort #rrggbb for &lt;input type="color"&gt; when value is rgba(). */
function hexFromCssColor(css: string): string {
  const s = css.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return "#888888";
  const r = Number(m[1]).toString(16).padStart(2, "0");
  const g = Number(m[2]).toString(16).padStart(2, "0");
  const b = Number(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}
