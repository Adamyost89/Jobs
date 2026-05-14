/**
 * Outbound Zapier Catch Hook after end-of-job form submit (best-effort; callers log failures).
 */
export async function sendEndOfJobFormZapWebhook(payload: Record<string, unknown>): Promise<{
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}> {
  const url = process.env.END_OF_JOB_FORM_ZAP_URL?.trim();
  if (!url) return { ok: true, skipped: true };

  const secret = process.env.END_OF_JOB_FORM_ZAP_SECRET?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers["X-Bridge-Secret"] = secret;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: t.slice(0, 500) || res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
