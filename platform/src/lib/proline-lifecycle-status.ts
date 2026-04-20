/**
 * ProLine separates pipeline **stage** (e.g. "No response / ghosted") from job **status**
 * (Open, Won, Complete, Closed). Only the latter may drive job create/update automation.
 */

/** True when `raw` is an allowed ProLine lifecycle status (Open / Won / Complete / Closed). */
export function isAllowedProlineLifecycleStatus(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return false;
  // "Sold" is treated as Won for ProLine-style payloads.
  if (/\bopen\b/.test(s) || /\bwon\b/.test(s) || /\bsold\b/.test(s)) return true;
  if (/\bcomplete\b/.test(s) || /\bclosed\b/.test(s)) return true;
  return false;
}

/**
 * After a job row exists in our DB, allow ProLine webhooks / API sync to mutate it only when
 * the row is already one of our normalized lifecycle outcomes, or still matches the allowed
 * raw ProLine labels (e.g. legacy "OPEN" text).
 */
export function jobQualifiesForProlineAutomation(dbStatus: string | null | undefined): boolean {
  const u = String(dbStatus ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (u === "IN_PROGRESS" || u === "SOLD" || u === "COMPLETE") return true;
  return isAllowedProlineLifecycleStatus(dbStatus);
}
