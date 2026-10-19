/**
 * Long-running Partner payment reconcile (no HTTP timeout).
 *
 * Requires PROLINE_PARTNER_KEY + PROLINE_COMPANY_KEY in platform/.env
 *
 *   npm run proline:partner-reconcile              # dry-run
 *   npm run proline:partner-reconcile -- --apply   # write
 *   npm run proline:partner-reconcile -- --invoices
 *   npm run proline:partner-reconcile -- --max-pages 200
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { reconcileProlinePaymentsFromPartnerApi } from "../src/lib/proline-partner-payment-reconcile";

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

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function main() {
  loadDotEnv();
  const apply = flag("--apply");
  const includeInvoices = flag("--invoices");
  const maxPages = Number.parseInt(argValue("--max-pages") ?? "200", 10) || 200;

  console.log(
    JSON.stringify({ apply, includeInvoices, maxPages, partnerKey: Boolean(process.env.PROLINE_PARTNER_KEY) })
  );

  const prisma = new PrismaClient();
  try {
    const result = await reconcileProlinePaymentsFromPartnerApi(prisma, {
      apply,
      includeInvoices,
      maxPages,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
