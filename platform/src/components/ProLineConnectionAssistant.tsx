"use client";

import { useState } from "react";

type DiagnoseResult = {
  ok: boolean;
  validationErrors: string[];
  httpStatus: number | null;
  requestUrl: string | null;
  itemCount: number;
  sampleKeys: string[];
  topLevelKeys: string[];
  hasNextPage: boolean;
  suggestions: string[];
  responsePreview: string;
  envSnippet: string | null;
};

type BubbleDiscoverResult = {
  ok: boolean;
  message: string;
  winner: null | {
    typename: string;
    path: string;
    url: string;
    itemCount: number;
    sampleKeys: string[];
  };
  attempts: { typename: string; path: string; status: number; itemCount: number; note?: string }[];
  envSnippet: string | null;
};

export function ProLineConnectionAssistant({ envLooksReady }: { envLooksReady: boolean }) {
  const [baseUrl, setBaseUrl] = useState("https://proline.app");
  const [projectsPath, setProjectsPath] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [authStyle, setAuthStyle] = useState<"bearer" | "token" | "x_api_key">("bearer");
  const [pageLimit, setPageLimit] = useState("20");
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [discoverResult, setDiscoverResult] = useState<BubbleDiscoverResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const busy = loading || discoverLoading;

  async function run(mode: "env" | "form") {
    setLoading(true);
    setErr(null);
    setResult(null);
    setDiscoverResult(null);
    try {
      const body =
        mode === "form"
          ? {
              apiKey: apiKey.trim() || undefined,
              baseUrl: baseUrl.trim() || undefined,
              projectsPath: projectsPath.trim() || undefined,
              authStyle,
              pageLimit: pageLimit.trim() || undefined,
            }
          : {};
      const res = await fetch("/api/integrations/proline/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as DiagnoseResult | { error?: string };
      if (!res.ok) {
        setErr(typeof (j as { error?: string }).error === "string" ? (j as { error: string }).error : "Request failed");
        return;
      }
      setResult(j as DiagnoseResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function runDiscover() {
    setDiscoverLoading(true);
    setErr(null);
    setDiscoverResult(null);
    setResult(null);
    try {
      const body = {
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        authStyle,
        pageLimit: "5",
      };
      const res = await fetch("/api/integrations/proline/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as BubbleDiscoverResult | { error?: string };
      if (!res.ok) {
        setErr(typeof (j as { error?: string }).error === "string" ? (j as { error: string }).error : "Request failed");
        return;
      }
      setDiscoverResult(j as BubbleDiscoverResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setDiscoverLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <p style={{ color: "var(--muted)", margin: 0 }}>
        ProLine does not publish a single public “list projects” URL. This tool runs a{" "}
        <strong>read-only</strong> test request and explains the result. Nothing here is saved to the server
        except what you already have in <code>.env</code> when you use “Test using server .env”.
      </p>

      <ol style={{ color: "var(--muted)", margin: 0, paddingLeft: "1.25rem", lineHeight: 1.6 }}>
        <li>
          <strong>Use ProLine’s website in its own tab</strong> — not this Elevated app. The Network panel only shows
          requests for the page you are looking at. Open your normal ProLine URL (often something like{" "}
          <code>app.proline.app</code> or the link your team uses), log in, <em>then</em> open DevTools (
          <strong>F12</strong> or <strong>Ctrl+Shift+I</strong>) → <strong>Network</strong>.
        </li>
        <li>
          Turn on <strong>Preserve log</strong>, clear the search box, and try filter <strong>All</strong> (not only
          Fetch/XHR). Reload the page (<strong>Ctrl+R</strong>) and open <strong>Projects</strong> / Data Manager /
          search — some apps load data over WebSocket or POST with names that do not show under “XHR” alone.
        </li>
        <li>
          If you still see almost nothing: with DevTools open, enable <strong>Disable cache</strong>, reload, or check
          whether ProLine runs inside an <strong>iframe</strong> (DevTools may show a frame context dropdown — pick the
          inner frame and watch Network again).
        </li>
        <li>
          When you see a request whose <strong>Response</strong> tab looks like JSON data (rows, ids, project names),
          copy <strong>scheme + host</strong> (e.g. <code>https://api.example.com</code>) into Base URL and only the{" "}
          <strong>path</strong> (the <code>/…</code> part after the host, before <code>?</code>) into Projects path.
        </li>
        <li>
          Paste your API key from <strong>ProLine → Integrations → ProLine API</strong>, or rely on{" "}
          <code>PROLINE_API_KEY</code> in <code>platform/.env</code>.
        </li>
        <li>
          If Network never shows a useful API URL, ask <strong>ProLine support</strong> for “REST or Data API URL to
          list projects with the Integrations API key” — many teams use <strong>webhooks</strong> or{" "}
          <strong>Data Manager → export</strong> instead of reverse‑engineering the browser.
        </li>
      </ol>

      <p style={{ margin: 0, fontSize: "0.9rem" }}>
        Server <code>.env</code> ProLine API:{" "}
        <strong>{envLooksReady ? "base URL + path + key are all set" : "incomplete — use the form or finish .env"}</strong>
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button className="btn" type="button" disabled={busy} onClick={() => run("env")}>
          {loading ? "Working…" : "Test using server .env only"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          Uses <code>PROLINE_API_*</code> from the host environment (no form values).
        </span>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border, rgba(255,255,255,0.12))",
          paddingTop: "1rem",
          display: "grid",
          gap: "0.75rem",
        }}
      >
        <strong style={{ fontSize: "0.95rem" }}>Or test with one-off values (not saved)</strong>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Base URL</span>
          <input
            className="input"
            placeholder="https://your-api-host.example"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Projects list path</span>
          <input
            className="input"
            placeholder="/api/1.1/obj/project"
            value={projectsPath}
            onChange={(e) => setProjectsPath(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>API key (optional if already in .env)</span>
          <input
            className="input"
            type="password"
            placeholder="Paste key only for this session test"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Auth style</span>
          <select
            className="input"
            value={authStyle}
            onChange={(e) => setAuthStyle(e.target.value as "bearer" | "token" | "x_api_key")}
          >
            <option value="bearer">Bearer (Authorization: Bearer …)</option>
            <option value="token">Raw token (Authorization: …)</option>
            <option value="x_api_key">X-API-Key header</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Page limit (query param)</span>
          <input
            className="input"
            value={pageLimit}
            onChange={(e) => setPageLimit(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => run("form")}>
          {loading ? "Working…" : "Test using form values (merged with .env for empty fields)"}
        </button>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border, rgba(255,255,255,0.12))",
          paddingTop: "1rem",
          display: "grid",
          gap: "0.65rem",
        }}
      >
        <strong style={{ fontSize: "0.95rem" }}>Easier: auto-scan Bubble project types</strong>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem", lineHeight: 1.55 }}>
          ProLine runs on <strong>Bubble</strong>. The public Data API pattern is{" "}
          <code>GET /api/1.1/obj/&lt;typename&gt;</code> with your API key (
          <a href="https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-endpoints" target="_blank" rel="noreferrer">
            Bubble docs
          </a>
          ). You often cannot see <code>typename</code> in the browser Network tab. This button tries many common names
          (<code>project</code>, <code>job</code>, …) against <strong>Base URL</strong> + <strong>API key</strong> above
          (or your <code>.env</code> for empty fields). It is read-only and takes a few seconds.
        </p>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.85rem" }}>
          Optional: set <code>PROLINE_BUBBLE_TYPE_CANDIDATES</code> in <code>.env</code> to a comma-separated list to
          scan your own guesses first.
        </p>
        <button className="btn" type="button" disabled={busy} onClick={() => runDiscover()}>
          {discoverLoading ? "Scanning…" : "Scan common Bubble type names"}
        </button>
      </div>

      {err && (
        <p style={{ color: "salmon", margin: 0 }} role="alert">
          {err}
        </p>
      )}

      {result && (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div
            style={{
              padding: "0.75rem",
              borderRadius: 8,
              background: result.ok ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)",
              border: "1px solid var(--border, rgba(255,255,255,0.12))",
            }}
          >
            <strong>{result.ok ? "Success — first page looks usable" : "Needs attention"}</strong>
            {result.validationErrors.length > 0 && (
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                {result.validationErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {result.httpStatus !== null && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
                HTTP <code>{result.httpStatus}</code>
                {result.requestUrl && (
                  <>
                    {" "}
                    · URL <code style={{ wordBreak: "break-all" }}>{result.requestUrl}</code>
                  </>
                )}
              </p>
            )}
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              Parsed rows this page: <strong>{result.itemCount}</strong>
              {result.hasNextPage ? " · more pages may exist (cursor pagination)" : ""}
            </p>
            {result.sampleKeys.length > 0 && (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                Sample field names (first row): <code>{result.sampleKeys.join(", ")}</code>
              </p>
            )}
            {result.topLevelKeys.length > 0 && (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                Top-level JSON keys: <code>{result.topLevelKeys.join(", ")}</code>
              </p>
            )}
          </div>

          {result.suggestions.length > 0 && (
            <div>
              <strong style={{ fontSize: "0.9rem" }}>What to try next</strong>
              <ul style={{ margin: "0.35rem 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
                {result.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {result.responsePreview && (
            <details>
              <summary style={{ cursor: "pointer" }}>Response preview (truncated)</summary>
              <pre
                style={{
                  marginTop: "0.5rem",
                  padding: "0.75rem",
                  overflow: "auto",
                  maxHeight: 220,
                  fontSize: "0.75rem",
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 6,
                }}
              >
                {result.responsePreview}
              </pre>
            </details>
          )}

          {result.envSnippet && (
            <div>
              <strong style={{ fontSize: "0.9rem" }}>Suggested lines for <code>platform/.env</code></strong>
              <pre
                style={{
                  marginTop: "0.35rem",
                  padding: "0.75rem",
                  fontSize: "0.8rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 6,
                }}
              >
                {result.envSnippet}
              </pre>
            </div>
          )}
        </div>
      )}

      {discoverResult && (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div
            style={{
              padding: "0.75rem",
              borderRadius: 8,
              background: discoverResult.ok ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)",
              border: "1px solid var(--border, rgba(255,255,255,0.12))",
            }}
          >
            <strong>{discoverResult.ok ? "Found a matching type" : "No type matched"}</strong>
            <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>{discoverResult.message}</p>
            {discoverResult.winner && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>{discoverResult.winner.typename}</strong> · {discoverResult.winner.itemCount} row(s) ·{" "}
                  <code style={{ wordBreak: "break-all" }}>{discoverResult.winner.url}</code>
                </p>
                {discoverResult.winner.sampleKeys.length > 0 && (
                  <p style={{ margin: "0.25rem 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                    Fields: <code>{discoverResult.winner.sampleKeys.join(", ")}</code>
                  </p>
                )}
              </div>
            )}
          </div>
          <details>
            <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
              Show all attempts ({discoverResult.attempts.length})
            </summary>
            <table style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, rgba(255,255,255,0.15))" }}>
                  <th style={{ padding: "0.35rem" }}>Type</th>
                  <th style={{ padding: "0.35rem" }}>HTTP</th>
                  <th style={{ padding: "0.35rem" }}>Rows</th>
                  <th style={{ padding: "0.35rem" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {discoverResult.attempts.map((a) => (
                  <tr key={a.typename} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "0.35rem" }}>
                      <code>{a.typename}</code>
                    </td>
                    <td style={{ padding: "0.35rem" }}>{a.status}</td>
                    <td style={{ padding: "0.35rem" }}>{a.itemCount}</td>
                    <td style={{ padding: "0.35rem", color: "var(--muted)" }}>{a.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {discoverResult.envSnippet && (
            <div>
              <strong style={{ fontSize: "0.9rem" }}>Suggested <code>platform/.env</code> lines</strong>
              <pre
                style={{
                  marginTop: "0.35rem",
                  padding: "0.75rem",
                  fontSize: "0.8rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 6,
                }}
              >
                {discoverResult.envSnippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
