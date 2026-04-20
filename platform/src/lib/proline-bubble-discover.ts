import { extractProjectListPage, prolineApiGet } from "@/lib/proline-api-client";
import { buildProlineEnvForDiagnose, type ProlineDiagnoseCustom } from "@/lib/proline-api-diagnose";

const DEFAULT_TYPENAMES = [
  "project",
  "projects",
  "job",
  "jobs",
  "property",
  "properties",
  "lead",
  "leads",
  "deal",
  "deals",
  "workorder",
  "workorders",
  "servicejob",
  "servicejobs",
  "installation",
  "installations",
  "customerproject",
  "customerprojects",
  "roof",
  "roofs",
  "contract",
  "contracts",
  "site",
  "sites",
  "homeowner",
  "homeowners",
  "lineitem",
  "lineitems",
];

function parseCandidateList(): string[] {
  const raw = process.env.PROLINE_BUBBLE_TYPE_CANDIDATES?.trim();
  if (!raw) return [...DEFAULT_TYPENAMES];
  const fromEnv = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ""))
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_TYPENAMES];
}

export type BubbleTypeAttempt = {
  typename: string;
  path: string;
  status: number;
  itemCount: number;
  note?: string;
};

export type BubbleDiscoverResult = {
  ok: boolean;
  message: string;
  winner: null | {
    typename: string;
    path: string;
    url: string;
    itemCount: number;
    sampleKeys: string[];
  };
  attempts: BubbleTypeAttempt[];
  envSnippet: string | null;
};

function pickField(override: string | undefined, envVal: string): string {
  const t = (override ?? "").trim();
  return t.length > 0 ? t : (envVal ?? "").trim();
}

/**
 * Bubble Data API uses `GET {origin}/api/1.1/obj/{typename}` with Bearer token.
 * ProLine does not publish `typename` in the browser Network tab; this probes common names.
 * @see https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-endpoints
 */
export async function runBubbleDataTypeDiscovery(custom?: ProlineDiagnoseCustom): Promise<BubbleDiscoverResult> {
  const baseUrl = pickField(custom?.baseUrl, process.env.PROLINE_API_BASE_URL || "");
  const apiKey = pickField(custom?.apiKey, process.env.PROLINE_API_KEY || "");
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      message: "Set Base URL and API key in the form (or PROLINE_API_BASE_URL + PROLINE_API_KEY in .env).",
      winner: null,
      attempts: [],
      envSnippet: null,
    };
  }

  const pageLimit = pickField(custom?.pageLimit, "5") || "5";

  const candidates = parseCandidateList();
  const attempts: BubbleTypeAttempt[] = [];

  for (const typename of candidates) {
    const path = `/api/1.1/obj/${typename}`;
    const { env, errors } = buildProlineEnvForDiagnose({
      ...custom,
      baseUrl,
      apiKey,
      projectsPath: path,
      pageLimit,
    });
    if (!env || errors.length) {
      return {
        ok: false,
        message: errors[0] || "Invalid configuration",
        winner: null,
        attempts,
        envSnippet: null,
      };
    }

    let res: Awaited<ReturnType<typeof prolineApiGet>>;
    try {
      res = await prolineApiGet(env, {});
    } catch (e) {
      attempts.push({
        typename,
        path,
        status: 0,
        itemCount: 0,
        note: e instanceof Error ? e.message : String(e),
      });
      await new Promise((r) => setTimeout(r, 80));
      continue;
    }

    const { items } = extractProjectListPage(res.json, {});
    attempts.push({
      typename,
      path,
      status: res.status,
      itemCount: items.length,
    });

    if (res.status >= 200 && res.status < 300 && items.length > 0) {
      const first = items[0];
      const flat =
        first && typeof first === "object" && !Array.isArray(first)
          ? (first as Record<string, unknown>)
          : {};
      const sampleKeys = Object.keys(flat).slice(0, 30);
      const url = res.url;
      const envSnippet = [
        `PROLINE_API_BASE_URL="${baseUrl.replace(/\/+$/, "")}"`,
        `PROLINE_API_PROJECTS_PATH="${path}"`,
        `PROLINE_API_AUTH_STYLE="${env.authStyle}"`,
        `PROLINE_API_PAGE_LIMIT="100"`,
        `# PROLINE_API_KEY=…`,
      ].join("\n");
      return {
        ok: true,
        message: `Found data at Bubble type "${typename}" (${items.length} row(s) on first page with limit=${pageLimit}).`,
        winner: { typename, path, url, itemCount: items.length, sampleKeys },
        attempts,
        envSnippet,
      };
    }

    await new Promise((r) => setTimeout(r, 80));
  }

  const had401 = attempts.some((a) => a.status === 401 || a.status === 403);
  const message = had401
    ? "Every attempt returned 401/403 — the Integrations API key may not be a Bubble Data API token, or auth style is wrong. Ask ProLine for “Data API token + project object typename”."
    : "No candidate type returned rows. Ask ProLine for the Bubble **Data type** name used for projects (Settings → API in Bubble shows the pattern), or set PROLINE_BUBBLE_TYPE_CANDIDATES in .env to a comma-separated list of guesses.";

  return {
    ok: false,
    message,
    winner: null,
    attempts,
    envSnippet: null,
  };
}
