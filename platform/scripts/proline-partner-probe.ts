/**
 * Smoke-test ProLine Partner API (read-only, one page each).
 *
 * Requires in platform/.env:
 *   PROLINE_PARTNER_KEY, PROLINE_COMPANY_KEY
 * Optional: PROLINE_PARTNER_BASE_URL (default https://api.proline.app)
 *
 * Run: npm run proline:partner-probe
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  partnerListPageFromJson,
  prolinePartnerPost,
  readProlinePartnerEnv,
} from "../src/lib/proline-partner-client";
import {
  normalizePartnerInvoice,
  normalizePartnerPayment,
  normalizePartnerProject,
  sanitizePartnerRowSample,
} from "../src/lib/proline-partner-normalize";

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

async function probeList(
  env: ReturnType<typeof readProlinePartnerEnv>,
  listPath: string,
  label: string
) {
  console.log(`\n=== ${label} (${listPath}) ===`);
  const res = await prolinePartnerPost(env, listPath, { page: 1, limit: 5 });
  console.log("HTTP", res.status, res.url);
  if (res.error) console.log("Error:", res.error);
  const page = partnerListPageFromJson(res.json);
  if (!page) {
    console.log("Body sample:", JSON.stringify(res.json)?.slice(0, 800));
    return res.status >= 200 && res.status < 300;
  }
  console.log(`page=${page.page} limit=${page.limit} total=${page.total} has_more=${page.has_more} results=${page.results.length}`);
  if (page.results[0]) {
    console.log("Sample keys:", Object.keys(page.results[0] as object).join(", "));
    console.log("Sanitized sample:", JSON.stringify(sanitizePartnerRowSample(page.results[0]), null, 2));
    if (label === "payments") {
      console.log("Normalized:", normalizePartnerPayment(page.results[0]));
    } else if (label === "invoices") {
      console.log("Normalized:", normalizePartnerInvoice(page.results[0]));
    } else if (label === "projects") {
      console.log("Normalized:", normalizePartnerProject(page.results[0]));
    }
  }
  return res.status >= 200 && res.status < 300;
}

async function main() {
  loadDotEnv();
  try {
    const env = readProlinePartnerEnv();
    console.log("Base URL:", env.baseUrl);
    console.log("Partner key set:", Boolean(env.partnerKey));
    console.log("Company key set:", Boolean(env.companyKey));

    const okProjects = await probeList(env, "/v1/list/projects", "projects");
    // Stay under rate limit between paths.
    await new Promise((r) => setTimeout(r, 5500));
    const okPayments = await probeList(env, "/v1/list/payments", "payments");
    await new Promise((r) => setTimeout(r, 5500));
    const okInvoices = await probeList(env, "/v1/list/invoices", "invoices");

    if (!okProjects || !okPayments || !okInvoices) process.exit(1);
    console.log("\nPartner probe OK.");
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
