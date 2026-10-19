/**
 * End-of-day Partner payment reconcile daemon (Docker sidecar).
 *
 * Env:
 *   PARTNER_DAILY_RECONCILE=1          required to run (safety latch)
 *   PARTNER_DAILY_RECONCILE_HOUR=23     local hour (default 23)
 *   PARTNER_DAILY_RECONCILE_MINUTE=0
 *   PARTNER_DAILY_RECONCILE_APPLY=1     write changes (default 1); set 0 for dry-run only
 *   PARTNER_DAILY_RECONCILE_MAX_PAGES=200
 *   PARTNER_DAILY_RECONCILE_INVOICES=0  set 1 to also page invoices
 *   TZ=America/New_York                set on the container for "end of day"
 *
 *   npm run proline:partner-daily
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { reconcileProlinePaymentsFromPartnerApi } from "../src/lib/proline-partner-payment-reconcile";
import { hasProlinePartnerKeys } from "../src/lib/proline-partner-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const p = path.join(__dirname, "../.env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function envFlag(name: string, defaultOn: boolean): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultOn;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt((process.env[name] ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function msUntilNextLocal(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(obj: Record<string, unknown>) {
  console.log(JSON.stringify({ tag: "partner_daily_reconcile", ts: new Date().toISOString(), ...obj }));
}

async function runOnce(prisma: PrismaClient): Promise<void> {
  if (!hasProlinePartnerKeys()) {
    log({ level: "error", message: "Partner keys missing; skipping run" });
    return;
  }

  const apply = envFlag("PARTNER_DAILY_RECONCILE_APPLY", true);
  const includeInvoices = envFlag("PARTNER_DAILY_RECONCILE_INVOICES", false);
  const maxPages = envInt("PARTNER_DAILY_RECONCILE_MAX_PAGES", 200);

  log({ level: "info", message: "starting", apply, includeInvoices, maxPages, tz: process.env.TZ ?? null });

  const started = Date.now();
  const result = await reconcileProlinePaymentsFromPartnerApi(prisma, {
    apply,
    includeInvoices,
    maxPages,
  });

  try {
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: apply ? "PROLINE_PARTNER_PAYMENT_RECONCILE_DAILY_APPLY" : "PROLINE_PARTNER_PAYMENT_RECONCILE_DAILY_DRY",
        entityType: "Job",
        entityId: "bulk",
        payload: {
          paymentsSeen: result.paymentsSeen,
          matchedJobs: result.matchedJobs,
          unmatchedPayments: result.unmatchedPayments,
          mismatches: result.mismatches,
          updated: result.updated,
          paymentEventsWritten: result.paymentEventsWritten,
          errors: result.errors.slice(0, 5),
          durationMs: Date.now() - started,
        },
      },
    });
  } catch (e) {
    log({ level: "warn", message: "audit log failed", error: e instanceof Error ? e.message : String(e) });
  }

  log({
    level: result.errors.length ? "warn" : "info",
    message: "finished",
    apply,
    durationMs: Date.now() - started,
    paymentsSeen: result.paymentsSeen,
    matchedJobs: result.matchedJobs,
    unmatchedPayments: result.unmatchedPayments,
    mismatches: result.mismatches,
    updated: result.updated,
    paymentEventsWritten: result.paymentEventsWritten,
    errors: result.errors.slice(0, 5),
  });
}

async function main() {
  loadDotEnv();

  if (!envFlag("PARTNER_DAILY_RECONCILE", false)) {
    console.error(
      "PARTNER_DAILY_RECONCILE is not enabled. Set PARTNER_DAILY_RECONCILE=1 (compose service does this)."
    );
    process.exit(1);
  }

  const hour = Math.min(23, Math.max(0, envInt("PARTNER_DAILY_RECONCILE_HOUR", 23)));
  const minute = Math.min(59, Math.max(0, envInt("PARTNER_DAILY_RECONCILE_MINUTE", 0)));

  const prisma = new PrismaClient();
  log({
    level: "info",
    message: "daemon started",
    schedule: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} local`,
    tz: process.env.TZ ?? "(system)",
    apply: envFlag("PARTNER_DAILY_RECONCILE_APPLY", true),
  });

  // Optional: run once on boot if PARTNER_DAILY_RECONCILE_RUN_ON_START=1 (useful after deploy).
  if (envFlag("PARTNER_DAILY_RECONCILE_RUN_ON_START", false)) {
    try {
      await runOnce(prisma);
    } catch (e) {
      log({ level: "error", message: "run_on_start failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (;;) {
    const waitMs = msUntilNextLocal(hour, minute);
    log({
      level: "info",
      message: "sleeping until next run",
      waitMs,
      waitHours: Math.round((waitMs / 3_600_000) * 100) / 100,
      nextApprox: new Date(Date.now() + waitMs).toISOString(),
    });
    await sleep(waitMs);
    try {
      await runOnce(prisma);
    } catch (e) {
      log({ level: "error", message: "run failed", error: e instanceof Error ? e.message : String(e) });
    }
    // Avoid double-fire if a run finishes in <60s spanning the same minute.
    await sleep(60_000);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
