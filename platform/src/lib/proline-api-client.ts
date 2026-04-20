/**
 * Outbound ProLine HTTP client. Base URL and list path come from env — copy from
 * ProLine → Integrations → ProLine API (same key Zapier uses per ProLine docs).
 */

export type ProlineApiAuthStyle = "bearer" | "token" | "x_api_key";

export type ProlineApiEnv = {
  apiKey: string;
  baseUrl: string;
  projectsPath: string;
  authStyle: ProlineApiAuthStyle;
  /** Extra query params on every list request (e.g. limit=100). */
  defaultQuery: Record<string, string>;
};

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function readProlineApiEnv(): ProlineApiEnv {
  const apiKey = (process.env.PROLINE_API_KEY || "").trim();
  const baseUrl = trimTrailingSlash((process.env.PROLINE_API_BASE_URL || "").trim());
  const projectsPathRaw = (process.env.PROLINE_API_PROJECTS_PATH || "").trim();
  const authRaw = (process.env.PROLINE_API_AUTH_STYLE || "bearer").trim().toLowerCase();
  const authStyle: ProlineApiAuthStyle =
    authRaw === "token" || authRaw === "x_api_key" ? authRaw : "bearer";

  if (!apiKey) {
    throw new Error("PROLINE_API_KEY is required for ProLine API calls");
  }
  if (!baseUrl) {
    throw new Error(
      "PROLINE_API_BASE_URL is required (e.g. origin from ProLine Integrations → ProLine API; no trailing slash)"
    );
  }
  const projectsPath =
    projectsPathRaw && projectsPathRaw.startsWith("/")
      ? projectsPathRaw
      : projectsPathRaw
        ? `/${projectsPathRaw}`
        : "";

  if (!projectsPath) {
    throw new Error(
      "PROLINE_API_PROJECTS_PATH is required (path to list projects, e.g. /api/1.1/obj/project — confirm in ProLine)"
    );
  }

  const limit = (process.env.PROLINE_API_PAGE_LIMIT || "100").trim() || "100";
  const defaultQuery: Record<string, string> = { limit };
  const constraints = process.env.PROLINE_API_LIST_CONSTRAINTS?.trim();
  if (constraints) defaultQuery.constraints = constraints;

  return { apiKey, baseUrl, projectsPath, authStyle, defaultQuery };
}

function authHeaders(env: ProlineApiEnv): Record<string, string> {
  switch (env.authStyle) {
    case "token":
      return { Authorization: env.apiKey };
    case "x_api_key":
      return { "X-API-Key": env.apiKey };
    default:
      return { Authorization: `Bearer ${env.apiKey}` };
  }
}

export function buildProlineListUrl(env: ProlineApiEnv, query: Record<string, string>): string {
  const path = env.projectsPath.startsWith("/") ? env.projectsPath : `/${env.projectsPath}`;
  const u = new URL(path, `${env.baseUrl}/`);
  for (const [k, v] of Object.entries({ ...env.defaultQuery, ...query })) {
    if (v !== undefined && v !== "") u.searchParams.set(k, v);
  }
  return u.toString();
}

export async function prolineApiGet(
  env: ProlineApiEnv,
  query: Record<string, string>
): Promise<{ status: number; json: unknown; url: string }> {
  const url = buildProlineListUrl(env, query);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(env),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _nonJson: text.slice(0, 500) };
  }
  return { status: res.status, json, url };
}

/**
 * Pull one page of project-like rows from common API shapes (plain array, {data}, Bubble {response.results}).
 */
export function extractProjectListPage(
  json: unknown,
  prevQuery: Record<string, string>
): { items: unknown[]; nextQuery: Record<string, string> | null } {
  if (Array.isArray(json)) {
    return { items: json, nextQuery: null };
  }

  const root = asRecord(json);
  if (!root) return { items: [], nextQuery: null };

  if (Array.isArray(root.data)) {
    return { items: root.data, nextQuery: null };
  }
  if (Array.isArray(root.results)) {
    return { items: root.results, nextQuery: null };
  }
  if (Array.isArray(root.projects)) {
    return { items: root.projects, nextQuery: null };
  }
  if (Array.isArray(root.items)) {
    return { items: root.items, nextQuery: null };
  }

  const resp = asRecord(root.response);
  if (resp && Array.isArray(resp.results)) {
    const results = resp.results as unknown[];
    const cursorRaw = resp.cursor;
    const cursor = typeof cursorRaw === "number" ? cursorRaw : Number(cursorRaw ?? 0);
    const remainingRaw = resp.remaining;
    const remaining =
      typeof remainingRaw === "number" ? remainingRaw : Number(remainingRaw ?? 0);
    const next =
      remaining > 0 && !Number.isNaN(cursor)
        ? { ...prevQuery, cursor: String(cursor + results.length) }
        : null;
    return { items: results, nextQuery: next };
  }

  return { items: [], nextQuery: null };
}

/** Used by `npm run proline:selftest` — throws if parsing regresses. */
export function runProlineApiParseSelfTest(): void {
  const bubble = {
    response: {
      cursor: 0,
      results: [{ _id: "x1", project_name: "A" }],
      remaining: 5,
      count: 1,
    },
  };
  const p1 = extractProjectListPage(bubble, {});
  if (p1.items.length !== 1 || p1.nextQuery?.cursor !== "1") {
    throw new Error(`Bubble parse failed: ${JSON.stringify(p1)}`);
  }
  const p2 = extractProjectListPage([{ id: "z" }], {});
  if (p2.items.length !== 1 || p2.nextQuery !== null) throw new Error("array parse failed");

  const env = {
    apiKey: "k",
    baseUrl: "https://example.com",
    projectsPath: "/api/1.1/obj/project",
    authStyle: "bearer" as const,
    defaultQuery: { limit: "50" },
  };
  const u = buildProlineListUrl(env, { cursor: "100" });
  if (!u.includes("cursor=100") || !u.includes("limit=50")) throw new Error(`bad url: ${u}`);
}
