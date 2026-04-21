import { firstTokenName, normalizeSalespersonName } from "./salesperson-name";

export type ProlineNameAliasMap = Record<string, string>;

function normalizeAliasKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

function normalizeAliasValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return normalizeSalespersonName(raw);
}

export function parseProlineNameAliasMap(raw: unknown): ProlineNameAliasMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ProlineNameAliasMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeAliasKey(k);
    const nv = normalizeAliasValue(v);
    if (!nk || !nv) continue;
    out[nk] = nv;
  }
  return out;
}

export function aliasFromMap(aliases: ProlineNameAliasMap, key: unknown): string | undefined {
  const nk = normalizeAliasKey(key);
  if (!nk) return undefined;
  return aliases[nk];
}

export function applyProlineAliasOrFallback(
  rawName: unknown,
  aliases: ProlineNameAliasMap
): string | undefined {
  const name = normalizeSalespersonName(rawName);
  if (!name) return undefined;
  return aliasFromMap(aliases, name) ?? name;
}

export function resolveProlineDisplayName(args: {
  salespersonName?: unknown;
  prolineUserId?: unknown;
  aliases: ProlineNameAliasMap;
  userMapJson?: string;
}): string | undefined {
  const byUserId = aliasFromMap(args.aliases, args.prolineUserId);
  if (byUserId) return byUserId;

  const byName = aliasFromMap(args.aliases, args.salespersonName);
  if (byName) return byName;

  const mapped = (() => {
    if (typeof args.prolineUserId !== "string" || !args.prolineUserId.trim()) return undefined;
    if (!args.userMapJson) return undefined;
    try {
      const m = JSON.parse(args.userMapJson) as Record<string, string>;
      const found = m[args.prolineUserId.trim()];
      return typeof found === "string" ? found : undefined;
    } catch {
      return undefined;
    }
  })();
  if (mapped) {
    const mappedAlias = aliasFromMap(args.aliases, mapped);
    return mappedAlias ?? normalizeSalespersonName(mapped);
  }

  const fallback = normalizeSalespersonName(args.salespersonName);
  if (!fallback) return undefined;
  const fallbackAlias = aliasFromMap(args.aliases, fallback);
  if (fallbackAlias) return fallbackAlias;
  return firstTokenName(fallback);
}
