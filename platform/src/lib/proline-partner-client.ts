/**
 * ProLine Partner API client (https://api.proline.app/v1/).
 * Auth: PARTNER_KEY + COMPANY_KEY headers on every POST.
 * Does not replace the Bubble-style company API in proline-api-client.ts.
 */

export type ProlinePartnerEnv = {
  partnerKey: string;
  companyKey: string;
  baseUrl: string;
};

export type PartnerListPage<T = Record<string, unknown>> = {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  results: T[];
};

export type PartnerApiResult<T> = {
  status: number;
  json: unknown;
  data: T | null;
  error: string | null;
  url: string;
};

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function hasProlinePartnerKeys(): boolean {
  return Boolean(
    (process.env.PROLINE_PARTNER_KEY || "").trim() && (process.env.PROLINE_COMPANY_KEY || "").trim()
  );
}

export function readProlinePartnerEnv(): ProlinePartnerEnv {
  const partnerKey = (process.env.PROLINE_PARTNER_KEY || "").trim();
  const companyKey = (process.env.PROLINE_COMPANY_KEY || "").trim();
  const baseUrl = trimTrailingSlash(
    (process.env.PROLINE_PARTNER_BASE_URL || "https://api.proline.app").trim()
  );
  if (!partnerKey) throw new Error("PROLINE_PARTNER_KEY is required for Partner API calls");
  if (!companyKey) throw new Error("PROLINE_COMPANY_KEY is required for Partner API calls");
  return { partnerKey, companyKey, baseUrl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetrySeconds(errorText: string): number | null {
  const m = errorText.match(/Try again in (\d+)\s*seconds?/i);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Unwrap Partner "wrapped" envelopes (find/edit/import). Returns the inner body. */
export function unwrapPartnerBody(json: unknown): unknown {
  const root = asRecord(json);
  if (!root) return json;
  if ("body" in root) return root.body;
  return json;
}

export function partnerListPageFromJson<T = Record<string, unknown>>(
  json: unknown
): PartnerListPage<T> | null {
  const root = asRecord(json);
  if (!root || !Array.isArray(root.results)) return null;
  return {
    page: typeof root.page === "number" ? root.page : 1,
    limit: typeof root.limit === "number" ? root.limit : 100,
    total: typeof root.total === "number" ? root.total : root.results.length,
    has_more: root.has_more === true,
    results: root.results as T[],
  };
}

export async function prolinePartnerPost(
  env: ProlinePartnerEnv,
  path: string,
  body: Record<string, unknown> = {},
  opts?: { maxRetries?: number }
): Promise<PartnerApiResult<unknown>> {
  const rel = path.startsWith("/") ? path : `/${path}`;
  const url = `${env.baseUrl}${rel.startsWith("/v1/") ? rel : `/v1${rel}`}`;
  const maxRetries = opts?.maxRetries ?? 4;
  let last: PartnerApiResult<unknown> = {
    status: 0,
    json: null,
    data: null,
    error: "No response",
    url,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        PARTNER_KEY: env.partnerKey,
        COMPANY_KEY: env.companyKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _nonJson: text.slice(0, 500) };
    }

    const flat = asRecord(json);
    const flatError = typeof flat?.error === "string" ? flat.error : null;

    if (res.status === 429 && attempt < maxRetries) {
      const waitSec = parseRetrySeconds(flatError || text) ?? 5;
      await sleep(waitSec * 1000 + 250);
      continue;
    }

    last = {
      status: res.status,
      json,
      data: json,
      error: res.ok ? null : flatError || `HTTP ${res.status}`,
      url,
    };
    return last;
  }
  return last;
}

/**
 * Path-level throttle: Partner enforces ~1 call / 5s on most list paths.
 * Callers should space pages; this helper waits `intervalMs` before each POST after the first.
 */
export async function* prolinePartnerListAll<T = Record<string, unknown>>(
  env: ProlinePartnerEnv,
  listPath: string,
  opts?: {
    limit?: number;
    createdAfter?: string | null;
    createdBefore?: string | null;
    maxPages?: number;
    /** Default 5100ms to stay under 1/5s limit. */
    intervalMs?: number;
    extraBody?: Record<string, unknown>;
  }
): AsyncGenerator<PartnerListPage<T>, void, unknown> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 100));
  const maxPages = opts?.maxPages ?? 200;
  const intervalMs = opts?.intervalMs ?? 5100;
  let page = 1;
  let first = true;

  while (page <= maxPages) {
    if (!first) await sleep(intervalMs);
    first = false;

    const body: Record<string, unknown> = {
      page,
      limit,
      ...(opts?.extraBody ?? {}),
    };
    if (opts?.createdAfter !== undefined) body.created_after = opts.createdAfter;
    if (opts?.createdBefore !== undefined) body.created_before = opts.createdBefore;

    const res = await prolinePartnerPost(env, listPath, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(res.error || `Partner list failed HTTP ${res.status} for ${listPath}`);
    }
    const list = partnerListPageFromJson<T>(res.json);
    if (!list) {
      throw new Error(`Unexpected Partner list shape for ${listPath}`);
    }
    yield list;
    if (!list.has_more || list.results.length === 0) break;
    page += 1;
  }
}

export async function prolinePartnerFindProject(
  env: ProlinePartnerEnv,
  lookup: { project_id?: string; project_external_id?: string }
): Promise<Record<string, unknown> | null> {
  const res = await prolinePartnerPost(env, "/v1/find/project", lookup);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(res.error || `find/project HTTP ${res.status}`);
  }
  const body = unwrapPartnerBody(res.json);
  if (Array.isArray(body) && body.length > 0 && body[0] && typeof body[0] === "object") {
    return body[0] as Record<string, unknown>;
  }
  return null;
}

/**
 * Create/update project. Check body.response.error before treating as success.
 * Returns the unwrapped response object.
 */
export async function prolinePartnerEditProject(
  env: ProlinePartnerEnv,
  fields: Record<string, unknown>
): Promise<{ ok: boolean; response: Record<string, unknown> | null; error: string | null }> {
  const res = await prolinePartnerPost(env, "/v1/edit/project", fields);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, response: null, error: res.error || `edit/project HTTP ${res.status}` };
  }
  const body = asRecord(unwrapPartnerBody(res.json));
  if (body && body.ok === true && Object.keys(body).length === 1) {
    return { ok: false, response: body, error: "Company automations paused; nothing written" };
  }
  const response = asRecord(body?.response) ?? body;
  if (response?.error === true) {
    const status = typeof response.status === "string" ? response.status : "edit/project rejected";
    return { ok: false, response, error: status };
  }
  return { ok: true, response, error: null };
}
