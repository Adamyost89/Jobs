export type StatusBadgeColorSet = {
  background: string;
  text: string;
  border: string;
};

export type StatusBadgeColorMap = Record<string, StatusBadgeColorSet>;

const DEFAULT_UNKNOWN: StatusBadgeColorSet = {
  background: "rgba(234, 179, 8, 0.15)",
  text: "#facc15",
  border: "rgba(234, 179, 8, 0.35)",
};

const DEFAULT_ACTIVE: StatusBadgeColorSet = {
  background: "rgba(59, 130, 246, 0.15)",
  text: "#93c5fd",
  border: "rgba(59, 130, 246, 0.35)",
};

const DEFAULT_DONE: StatusBadgeColorSet = {
  background: "rgba(34, 197, 94, 0.12)",
  text: "#86efac",
  border: "rgba(34, 197, 94, 0.3)",
};

const DEFAULT_BAD: StatusBadgeColorSet = {
  background: "rgba(248, 113, 113, 0.12)",
  text: "#fca5a5",
  border: "rgba(248, 113, 113, 0.3)",
};

export const STATUS_BADGE_DEFAULT_MAP: StatusBadgeColorMap = {
  UNKNOWN: DEFAULT_UNKNOWN,
  IN_BILLING: DEFAULT_ACTIVE,
  "IN BILLING": DEFAULT_ACTIVE,
  IN_PROGRESS: DEFAULT_ACTIVE,
  "IN PROGRESS": DEFAULT_ACTIVE,
  "INVOICE SENT": DEFAULT_ACTIVE,
  SOLD: DEFAULT_DONE,
  COMPLETE: DEFAULT_DONE,
  "PAID & CLOSED": DEFAULT_DONE,
  "PAID AND CLOSED": DEFAULT_DONE,
  CLOSED: DEFAULT_DONE,
  WON: DEFAULT_DONE,
  CANCELLED: DEFAULT_BAD,
  CANCELED: DEFAULT_BAD,
  CANCEL: DEFAULT_BAD,
};

export const STATUS_BADGE_DEFAULT_KEYS = [
  "UNKNOWN",
  "IN BILLING",
  "IN_PROGRESS",
  "SOLD",
  "COMPLETE",
  "CANCELLED",
  "INVOICE SENT",
  "PAID & CLOSED",
] as const;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_HSL_COLOR_RE =
  /^(?:rgb|rgba|hsl|hsla)\(\s*[+\-.\d%\s,]+\)$/i;
const CSS_VAR_RE = /^var\(--[a-zA-Z0-9\-_]+\)$/;

function isValidCssColor(value: string): boolean {
  const color = value.trim();
  if (!color) return false;
  if (HEX_COLOR_RE.test(color)) return true;
  if (RGB_HSL_COLOR_RE.test(color)) return true;
  if (CSS_VAR_RE.test(color)) return true;
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStatusBadgeColorSet(v: unknown): v is StatusBadgeColorSet {
  if (!isRecord(v)) return false;
  if (typeof v.background !== "string") return false;
  if (typeof v.text !== "string") return false;
  if (typeof v.border !== "string") return false;
  return isValidCssColor(v.background) && isValidCssColor(v.text) && isValidCssColor(v.border);
}

function canonicalizeKey(raw: string): string {
  return raw.trim().replace(/_/g, " ").replace(/\s+/g, " ").toUpperCase();
}

export function normalizeStatusBadgeKey(raw: string): string {
  return canonicalizeKey(raw);
}

export function statusColumnLabel(status: string, prolineStage?: string | null): string {
  const stage = prolineStage?.trim();
  if (stage) return stage;
  return status.replace(/_/g, " ");
}

export function normalizeStatusBadgeColorMap(raw: unknown): StatusBadgeColorMap {
  if (!isRecord(raw)) return {};
  const out: StatusBadgeColorMap = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 300) break;
    if (typeof key !== "string") continue;
    const normalizedKey = canonicalizeKey(key);
    if (!normalizedKey || normalizedKey.length > 80) continue;
    if (!isStatusBadgeColorSet(value)) continue;
    out[normalizedKey] = {
      background: value.background.trim(),
      text: value.text.trim(),
      border: value.border.trim(),
    };
    count += 1;
  }
  return out;
}

function fallbackByLifecycle(status: string): StatusBadgeColorSet {
  const key = canonicalizeKey(status);
  if (key === "UNKNOWN") return DEFAULT_UNKNOWN;
  if (key.includes("CANCEL")) return DEFAULT_BAD;
  if (key.includes("COMPLETE") || key.includes("SOLD")) return DEFAULT_DONE;
  return DEFAULT_ACTIVE;
}

function fromMap(
  map: StatusBadgeColorMap,
  displayedLabel: string,
  lifecycleStatus: string
): StatusBadgeColorSet | null {
  const displayKey = canonicalizeKey(displayedLabel);
  const lifecycleKey = canonicalizeKey(lifecycleStatus);
  return map[displayKey] ?? map[lifecycleKey] ?? null;
}

export function resolveStatusBadgeColors(input: {
  status: string;
  prolineStage?: string | null;
  customMap?: StatusBadgeColorMap;
}): StatusBadgeColorSet {
  const displayedLabel = statusColumnLabel(input.status, input.prolineStage);
  const custom = input.customMap ? fromMap(input.customMap, displayedLabel, input.status) : null;
  if (custom) return custom;
  const defaults = fromMap(STATUS_BADGE_DEFAULT_MAP, displayedLabel, input.status);
  if (defaults) return defaults;
  return fallbackByLifecycle(input.status);
}
