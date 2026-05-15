import type { EndOfJobFormConfig } from "@/lib/end-of-job-form";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  return String(v).trim() || "—";
}

export function EndOfJobFormResponsesView({
  config,
  responses,
}: {
  config: EndOfJobFormConfig;
  responses: unknown;
}) {
  if (!isRecord(responses)) {
    return <p style={{ margin: 0, color: "var(--muted)" }}>No response data stored.</p>;
  }

  const meta = isRecord(responses._meta) ? responses._meta : null;
  const rows: Array<{ label: string; value: string }> = [];

  for (const field of config.fields) {
    if (field.id in responses) {
      rows.push({ label: field.label, value: formatValue(responses[field.id]) });
    }
  }

  for (const [key, val] of Object.entries(responses)) {
    if (key === "_meta" || config.fields.some((f) => f.id === key)) continue;
    rows.push({ label: key, value: formatValue(val) });
  }

  return (
    <div style={{ display: "grid", gap: "0.65rem" }}>
      {meta && typeof meta.submittedByEmail === "string" ? (
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          Submitted by {meta.submittedByEmail}
          {typeof meta.submittedAt === "string" ? ` · ${meta.submittedAt}` : ""}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>No field answers in the saved payload.</p>
      ) : (
        <table className="table table-data" style={{ margin: 0 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th style={{ textAlign: "left", width: "40%", fontWeight: 600 }}>{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
