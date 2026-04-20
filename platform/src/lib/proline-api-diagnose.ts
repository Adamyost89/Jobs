import {
  buildProlineListUrl,
  extractProjectListPage,
  prolineApiGet,
  type ProlineApiAuthStyle,
  type ProlineApiEnv,
} from "@/lib/proline-api-client";

export type ProlineDiagnoseCustom = {
  apiKey?: string;
  baseUrl?: string;
  projectsPath?: string;
  authStyle?: ProlineApiAuthStyle;
  pageLimit?: string;
};

export type ProlineDiagnoseResult = {
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
  /** When the probe succeeds, paste into `platform/.env` (never commit). */
  envSnippet: string | null;
};

function pickField(override: string | undefined, envVal: string): string {
  const t = (override ?? "").trim();
  return t.length > 0 ? t : (envVal ?? "").trim();
}

/** Merge form overrides with process.env for a single probe (nothing is persisted). */
export function buildProlineEnvForDiagnose(custom?: ProlineDiagnoseCustom): {
  env: ProlineApiEnv | null;
  errors: string[];
} {
  const apiKey = pickField(custom?.apiKey, process.env.PROLINE_API_KEY || "");
  const baseUrlRaw = pickField(custom?.baseUrl, process.env.PROLINE_API_BASE_URL || "");
  const pathRaw = pickField(custom?.projectsPath, process.env.PROLINE_API_PROJECTS_PATH || "");
  const authRaw = (custom?.authStyle ?? (process.env.PROLINE_API_AUTH_STYLE || "bearer"))
    .toString()
    .trim()
    .toLowerCase();
  const authStyle: ProlineApiAuthStyle =
    authRaw === "token" || authRaw === "x_api_key" ? authRaw : "bearer";
  const limit = pickField(custom?.pageLimit, process.env.PROLINE_API_PAGE_LIMIT || "100") || "100";

  const errors: string[] = [];
  if (!apiKey) errors.push("API key is missing (paste it below or set PROLINE_API_KEY in .env).");
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  if (!baseUrl) {
    errors.push(
      "Base URL is missing (paste the host from ProLine, e.g. from browser DevTools → Network, or set PROLINE_API_BASE_URL)."
    );
  }
  let projectsPath = pathRaw;
  if (projectsPath && !projectsPath.startsWith("/")) projectsPath = `/${projectsPath}`;
  if (!projectsPath) {
    errors.push(
      "Projects path is missing (paste the path part after the host, or set PROLINE_API_PROJECTS_PATH)."
    );
  }

  if (errors.length > 0) return { env: null, errors };

  const defaultQuery: Record<string, string> = { limit };
  const constraints = process.env.PROLINE_API_LIST_CONSTRAINTS?.trim();
  if (constraints) defaultQuery.constraints = constraints;

  return {
    env: {
      apiKey,
      baseUrl,
      projectsPath,
      authStyle,
      defaultQuery,
    },
    errors: [],
  };
}

function flattenRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function topLevelKeys(json: unknown): string[] {
  const r = flattenRecord(json);
  return Object.keys(r).slice(0, 40);
}

export async function runProlineApiDiagnose(custom?: ProlineDiagnoseCustom): Promise<ProlineDiagnoseResult> {
  const { env, errors } = buildProlineEnvForDiagnose(custom);
  if (!env) {
    return {
      ok: false,
      validationErrors: errors,
      httpStatus: null,
      requestUrl: null,
      itemCount: 0,
      sampleKeys: [],
      topLevelKeys: [],
      hasNextPage: false,
      suggestions: errors,
      responsePreview: "",
      envSnippet: null,
    };
  }

  let res: Awaited<ReturnType<typeof prolineApiGet>>;
  try {
    res = await prolineApiGet(env, {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      validationErrors: [],
      httpStatus: null,
      requestUrl: buildProlineListUrl(env, {}),
      itemCount: 0,
      sampleKeys: [],
      topLevelKeys: [],
      hasNextPage: false,
      suggestions: [
        `Request failed before a response: ${msg}`,
        "Check that the base URL is reachable from this server (firewall, VPN, typo).",
      ],
      responsePreview: "",
      envSnippet: null,
    };
  }

  const { items, nextQuery } = extractProjectListPage(res.json, {});
  const first = items[0];
  const flat = first && typeof first === "object" && !Array.isArray(first) ? (first as Record<string, unknown>) : {};
  const sampleKeys = Object.keys(flat).slice(0, 35);
  const tls = topLevelKeys(res.json);
  const suggestions: string[] = [];

  const pl = env.projectsPath.toLowerCase();
  if (pl.includes("/init/data")) {
    suggestions.push(
      "That browser URL is Bubble **page bootstrap** (`/api/1.1/init/data?location=…`). It is meant for the logged-in SPA (cookies), not the same contract as **Integrations → API key** on the server. For listing records, Bubble’s pattern is usually `GET /api/1.1/obj/<datatype>` — ask ProLine for the exact `<datatype>` for projects (examples: `project`, `Project`). **PROLINE_API_BASE_URL** `https://proline.app` is reasonable."
    );
  }
  if (pl.includes("/elasticsearch/")) {
    suggestions.push(
      "`/elasticsearch/…` uses POST + search payloads and session auth — it will not match this tool’s GET + API key + `limit` query."
    );
  }

  if (res.status === 401 || res.status === 403) {
    suggestions.push(
      "HTTP 401/403 usually means the API key is wrong, expired, or the Authorization style does not match what ProLine expects."
    );
    suggestions.push('Try auth style **token** (raw `Authorization` value) or **x_api_key** in the form, then run again.');
  }
  if (res.status === 404) {
    suggestions.push(
      "HTTP 404: the path is probably wrong. Compare with the URL you see in the browser Network tab when ProLine loads projects."
    );
  }
  if (res.status >= 500) {
    suggestions.push("Server error from ProLine — retry later or ask ProLine support if it persists.");
  }

  const previewRaw =
    typeof res.json === "object" && res.json !== null
      ? JSON.stringify(res.json, null, 0)
      : String(res.json);
  const responsePreview = previewRaw.length > 2000 ? previewRaw.slice(0, 2000) + "…" : previewRaw;

  if (res.status >= 200 && res.status < 300) {
    if (items.length === 0) {
      suggestions.push(
        "The response was JSON but we could not find a project array (tried: top-level array, data, results, projects, items, response.results)."
      );
      suggestions.push(
        tls.length > 0
          ? `Top-level keys we saw: ${tls.join(", ")}. Send this snippet to ProLine support or compare with their API doc.`
          : "Body looks empty or not an object."
      );
    } else {
      suggestions.push(
        `Found ${items.length} row(s) on the first page. If that matches ProLine, copy the env snippet below into platform/.env and restart the app.`
      );
      if (nextQuery) suggestions.push("Pagination cursor is supported for this response shape — sync can walk additional pages.");
    }
  }

  if (previewRaw.trim().startsWith("<") || previewRaw.includes("<!DOCTYPE")) {
    suggestions.push(
      "The response looks like HTML, not JSON — the URL may point at a web page instead of an API. Check the path and host."
    );
  }

  const ok = res.status >= 200 && res.status < 300 && items.length > 0;
  const envSnippet = ok
    ? [
        `PROLINE_API_BASE_URL="${env.baseUrl}"`,
        `PROLINE_API_PROJECTS_PATH="${env.projectsPath}"`,
        `PROLINE_API_AUTH_STYLE="${env.authStyle}"`,
        `PROLINE_API_PAGE_LIMIT="${env.defaultQuery.limit ?? "100"}"`,
        `# PROLINE_API_KEY=…  (keep the key you already use in .env; do not commit this file)`,
      ].join("\n")
    : null;

  if (!ok && res.status >= 200 && res.status < 300 && items.length === 0 && suggestions.length === 0) {
    suggestions.push("Request succeeded but no projects were parsed — see response preview.");
  }

  return {
    ok,
    validationErrors: [],
    httpStatus: res.status,
    requestUrl: res.url,
    itemCount: items.length,
    sampleKeys,
    topLevelKeys: tls,
    hasNextPage: !!nextQuery,
    suggestions,
    responsePreview,
    envSnippet,
  };
}
