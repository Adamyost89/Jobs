"use client";

import { useCallback, useEffect, useState } from "react";
import { isCommissionPlanConfigV1 } from "@/lib/commission-plan-types";
import {
  editorsToPlan,
  newPersonEditor,
  planToEditors,
  type BonusForm,
  type CommissionPersonEditor,
  type LeadStepForm,
} from "@/lib/commission-plan-form-bridge";

function updateEditor(
  editors: CommissionPersonEditor[],
  index: number,
  patch: Partial<CommissionPersonEditor> | ((row: CommissionPersonEditor) => CommissionPersonEditor)
): CommissionPersonEditor[] {
  return editors.map((row, i) => {
    if (i !== index) return row;
    return typeof patch === "function" ? patch(row) : { ...row, ...patch };
  });
}

function updateBonus(editors: CommissionPersonEditor[], index: number, patch: Partial<BonusForm>): CommissionPersonEditor[] {
  return editors.map((row, i) => (i === index ? { ...row, bonus: { ...row.bonus, ...patch } } : row));
}

function updateLeadStep(
  editors: CommissionPersonEditor[],
  personIndex: number,
  stepIndex: number,
  patch: Partial<LeadStepForm>
): CommissionPersonEditor[] {
  return editors.map((row, i) => {
    if (i !== personIndex) return row;
    const leadSteps = row.leadSteps.map((s, j) => (j === stepIndex ? { ...s, ...patch } : s));
    return { ...row, leadSteps };
  });
}

export function CommissionPlanForm({
  years,
  salespersonNames,
}: {
  years: number[];
  salespersonNames: string[];
}) {
  const initialYear = years.includes(2026) ? 2026 : years[years.length - 1] ?? new Date().getFullYear();
  const [year, setYear] = useState(initialYear);
  const [editors, setEditors] = useState<CommissionPersonEditor[]>([]);
  const [jsonDraft, setJsonDraft] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const res = await fetch(`/api/admin/commission-plan/${year}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error || "Failed to load");
      setLoading(false);
      return;
    }
    const plan = j.plan;
    setJsonDraft(JSON.stringify(plan, null, 2));
    setHasOverride(!!j.hasStoredOverride);
    setEditors(planToEditors(plan));
    setLoading(false);
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveFromForm() {
    setMsg(null);
    if (editors.length === 0) {
      setMsg("Add at least one person to the plan before saving.");
      return;
    }
    const plan = editorsToPlan(editors);
    if (!isCommissionPlanConfigV1(plan)) {
      setMsg("Something went wrong building the plan. Use Technical JSON or reload.");
      return;
    }
    const res = await fetch(`/api/admin/commission-plan/${year}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Save failed");
      return;
    }
    setMsg("Saved.");
    await load();
  }

  async function saveFromJson() {
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch {
      setMsg("JSON is not valid.");
      return;
    }
    if (!isCommissionPlanConfigV1(parsed)) {
      setMsg("JSON must be a full plan with version 1 and people.");
      return;
    }
    const res = await fetch(`/api/admin/commission-plan/${year}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Save failed");
      return;
    }
    setMsg("Saved from JSON.");
    await load();
  }

  async function resetToCodeDefaults() {
    setMsg(null);
    const res = await fetch(`/api/admin/commission-plan/${year}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg("Reset failed");
      return;
    }
    setMsg("Reset to built-in defaults. Click Save if you want to store that in the database.");
    await load();
  }

  const namesInPlan = new Set(editors.map((e) => e.name.trim()).filter(Boolean));
  const canAdd = salespersonNames.filter((n) => !namesInPlan.has(n));

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <p className="help" style={{ margin: 0 }}>
        You set one card per person. The system still uses the job&apos;s <strong>Lead #</strong> and the same money
        rules as the old sheet (project revenue if filled in, otherwise contract + change orders). Inactive salespeople
        are skipped automatically — turn them off under <strong>Sales team</strong> above.
      </p>

      <div className="form-row" style={{ alignItems: "center" }}>
        <label className="form-field" style={{ margin: 0 }}>
          <span>Year</span>
          <select className="input input-narrow" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="help" style={{ margin: 0 }}>
          {hasOverride ? "Using your saved plan for this year." : "Showing built-in defaults until you save."}
        </span>
      </div>

      {loading ? (
        <span className="help">Loading…</span>
      ) : (
        <>
          <div style={{ display: "grid", gap: "1rem" }}>
            {editors.map((ed, idx) => (
              <div key={`${ed.name}-${idx}`} className="person-card">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h3 style={{ margin: 0, flex: "1 1 140px" }}>{ed.name}</h3>
                  <button type="button" className="btn secondary" onClick={() => setEditors((prev) => prev.filter((_, i) => i !== idx))}>
                    Remove from this year
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={idx === 0}
                    onClick={() =>
                      setEditors((prev) => {
                        const next = [...prev];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        return next;
                      })
                    }
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={idx >= editors.length - 1}
                    onClick={() =>
                      setEditors((prev) => {
                        const next = [...prev];
                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                        return next;
                      })
                    }
                  >
                    Move down
                  </button>
                </div>

                <div className="form-row">
                  <label className="form-field">
                    <span>Commission applies to</span>
                    <select
                      className="input"
                      value={ed.scope}
                      onChange={(e) =>
                        setEditors((prev) => updateEditor(prev, idx, { scope: e.target.value as "all_jobs" | "primary_only" }))
                      }
                    >
                      <option value="all_jobs">Every job (managers / house rules)</option>
                      <option value="primary_only">Only jobs where they are the salesperson on the job</option>
                    </select>
                  </label>
                </div>

                {!ed.bonus.enabled && (
                  <div className="form-row">
                    <label className="form-field">
                      <span>Usual commission (% of the job commission total)</span>
                      <input
                        className="input input-narrow"
                        type="number"
                        min={0}
                        max={100}
                        step={0.25}
                        value={ed.defaultPercent === "" ? "" : ed.defaultPercent}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditors((prev) =>
                            updateEditor(prev, idx, {
                              defaultPercent: v === "" ? "" : parseFloat(v) || 0,
                            })
                          );
                        }}
                      />
                    </label>
                  </div>
                )}

                {!ed.bonus.enabled && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>Different % by lead # (optional)</div>
                    <p className="help" style={{ margin: "0 0 0.5rem" }}>
                      Example: from lead 1858 use 1%, otherwise use the usual % above. Add as many rows as you need.
                    </p>
                    {ed.leadSteps.map((step, sidx) => (
                      <div key={sidx} className="form-row" style={{ marginBottom: "0.35rem" }}>
                        <label className="form-field">
                          <span>From lead #</span>
                          <input
                            className="input input-narrow"
                            type="number"
                            min={0}
                            step={1}
                            value={step.fromLead}
                            onChange={(e) =>
                              setEditors((prev) =>
                                updateLeadStep(prev, idx, sidx, { fromLead: parseInt(e.target.value, 10) || 0 })
                              )
                            }
                          />
                        </label>
                        <label className="form-field">
                          <span>Use %</span>
                          <input
                            className="input input-narrow"
                            type="number"
                            min={0}
                            max={100}
                            step={0.25}
                            value={step.usePercent}
                            onChange={(e) =>
                              setEditors((prev) =>
                                updateLeadStep(prev, idx, sidx, { usePercent: parseFloat(e.target.value) || 0 })
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() =>
                            setEditors((prev) =>
                              updateEditor(prev, idx, {
                                leadSteps: prev[idx].leadSteps.filter((_, j) => j !== sidx),
                              })
                            )
                          }
                        >
                          Remove row
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() =>
                        setEditors((prev) =>
                          updateEditor(prev, idx, { leadSteps: [...prev[idx].leadSteps, { fromLead: 0, usePercent: 0 }] })
                        )
                      }
                    >
                      Add lead # rule
                    </button>
                  </div>
                )}

                <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #2a3545" }}>
                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={ed.bonus.enabled}
                      onChange={(e) =>
                        setEditors((prev) =>
                          updateBonus(prev, idx, {
                            enabled: e.target.checked,
                          })
                        )
                      }
                    />
                    Higher commission % after a yearly goal (bonus)
                  </label>
                  {ed.bonus.enabled && (
                    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
                      <label className="form-field">
                        <span>Count their year toward the goal using</span>
                        <select
                          className="input"
                          value={ed.bonus.basedOn}
                          onChange={(e) =>
                            setEditors((prev) =>
                              updateBonus(prev, idx, {
                                basedOn: e.target.value as BonusForm["basedOn"],
                              })
                            )
                          }
                        >
                          <option value="paid_this_year">Money already paid to them this year (payroll total)</option>
                          <option value="sold_jobs_this_year">Dollar total of jobs they sold (their name on the job)</option>
                        </select>
                      </label>
                      <div className="form-row">
                        <label className="form-field">
                          <span>When they reach ($)</span>
                          <input
                            className="input input-narrow"
                            type="number"
                            min={0}
                            step={1000}
                            value={ed.bonus.afterDollars}
                            onChange={(e) =>
                              setEditors((prev) => updateBonus(prev, idx, { afterDollars: parseFloat(e.target.value) || 0 }))
                            }
                          />
                        </label>
                        <label className="form-field">
                          <span>Then use commission %</span>
                          <input
                            className="input input-narrow"
                            type="number"
                            min={0}
                            max={100}
                            step={0.25}
                            value={ed.bonus.higherPercent}
                            onChange={(e) =>
                              setEditors((prev) =>
                                updateBonus(prev, idx, { higherPercent: parseFloat(e.target.value) || 0 })
                              )
                            }
                          />
                        </label>
                      </div>
                      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={ed.bonus.beforeGoalUseLeadSplit}
                          onChange={(e) =>
                            setEditors((prev) =>
                              updateBonus(prev, idx, {
                                beforeGoalUseLeadSplit: e.target.checked,
                              })
                            )
                          }
                        />
                        Before that goal, use different % below / above a lead # (advanced)
                      </label>
                      {!ed.bonus.beforeGoalUseLeadSplit ? (
                        <label className="form-field">
                          <span>Before the goal, commission %</span>
                          <input
                            className="input input-narrow"
                            type="number"
                            min={0}
                            max={100}
                            step={0.25}
                            value={ed.bonus.beforeGoalFlatPercent === "" ? "" : ed.bonus.beforeGoalFlatPercent}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditors((prev) =>
                                updateBonus(prev, idx, {
                                  beforeGoalFlatPercent: v === "" ? "" : parseFloat(v) || 0,
                                })
                              );
                            }}
                          />
                        </label>
                      ) : (
                        <div className="form-row">
                          <label className="form-field">
                            <span>Lead # split at</span>
                            <input
                              className="input input-narrow"
                              type="number"
                              value={ed.bonus.beforeGoalSplitLead === "" ? "" : ed.bonus.beforeGoalSplitLead}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditors((prev) =>
                                  updateBonus(prev, idx, {
                                    beforeGoalSplitLead: v === "" ? "" : parseInt(v, 10) || 0,
                                  })
                                );
                              }}
                            />
                          </label>
                          <label className="form-field">
                            <span>% if lead is under that #</span>
                            <input
                              className="input input-narrow"
                              type="number"
                              value={ed.bonus.beforeGoalBelowSplitPercent === "" ? "" : ed.bonus.beforeGoalBelowSplitPercent}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditors((prev) =>
                                  updateBonus(prev, idx, {
                                    beforeGoalBelowSplitPercent: v === "" ? "" : parseFloat(v) || 0,
                                  })
                                );
                              }}
                            />
                          </label>
                          <label className="form-field">
                            <span>% if lead is that # or higher</span>
                            <input
                              className="input input-narrow"
                              type="number"
                              value={
                                ed.bonus.beforeGoalAtOrAboveSplitPercent === "" ? "" : ed.bonus.beforeGoalAtOrAboveSplitPercent
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditors((prev) =>
                                  updateBonus(prev, idx, {
                                    beforeGoalAtOrAboveSplitPercent: v === "" ? "" : parseFloat(v) || 0,
                                  })
                                );
                              }}
                            />
                          </label>
                        </div>
                      )}
                      {ed.bonus.beforeGoalUseLeadSplit && (
                        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={ed.bonus.dontReopenOwedAtHigherRate}
                            onChange={(e) =>
                              setEditors((prev) =>
                                updateBonus(prev, idx, {
                                  dontReopenOwedAtHigherRate: e.target.checked,
                                })
                              )
                            }
                          />
                          If they were already fully paid at the old rate, don&apos;t add new &quot;owed&quot; when the
                          higher bonus rate kicks in
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="form-row" style={{ alignItems: "center" }}>
            <label className="form-field" style={{ margin: 0 }}>
              <span>Add person to this year</span>
              <select
                className="input"
                value=""
                onChange={(e) => {
                  const n = e.target.value;
                  if (!n) return;
                  setEditors((prev) => [...prev, newPersonEditor(n)]);
                  e.target.value = "";
                }}
              >
                <option value="">Choose name…</option>
                {canAdd.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {canAdd.length === 0 && <span className="help">Everyone on your team is already on this year&apos;s plan.</span>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <button className="btn" type="button" onClick={() => void saveFromForm()}>
              Save commission plan
            </button>
            <button className="btn secondary" type="button" onClick={() => void resetToCodeDefaults()}>
              Reset year to defaults
            </button>
            <button className="btn secondary" type="button" onClick={() => void load()}>
              Reload
            </button>
          </div>

          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Technical: edit raw JSON</summary>
            <p className="help">For edge cases the form doesn&apos;t cover. Save separately from the form above.</p>
            <textarea
              className="input"
              spellCheck={false}
              value={jsonDraft}
              onChange={(e) => setJsonDraft(e.target.value)}
              style={{ width: "100%", minHeight: "220px", fontFamily: "ui-monospace, monospace", fontSize: "0.8rem", maxWidth: "100%" }}
            />
            <button className="btn secondary" type="button" style={{ marginTop: "0.5rem" }} onClick={() => void saveFromJson()}>
              Save JSON only
            </button>
          </details>
        </>
      )}

      {msg && <p style={{ margin: 0, color: "var(--good)", fontSize: "0.9rem" }}>{msg}</p>}
    </div>
  );
}
