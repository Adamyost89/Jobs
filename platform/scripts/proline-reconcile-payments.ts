/**
 * Compare local job payment fields with ProLine API data.
 *
 * Dry run (default): npm run proline:reconcile-payments
 * Apply fixes: PROLINE_RECONCILE_APPLY=1 npm run proline:reconcile-payments
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { reconcileProlinePaymentsFromApi } from "../src/lib/proline-payment-reconcile";

const prisma = new PrismaClient();
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

async function main() {
  loadDotEnv();
  const apply =
    process.env.PROLINE_RECONCILE_APPLY === "1" ||
    String(process.env.PROLINE_RECONCILE_APPLY || "").toLowerCase() === "true";
  const maxPagesRaw = parseInt(process.env.PROLINE_RECONCILE_MAX_PAGES || "200", 10);
  const maxPages = Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? maxPagesRaw : 200;

  const result = await reconcileProlinePaymentsFromApi(prisma, { apply, maxPages });
  console.log(JSON.stringify({ apply, ...result }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
