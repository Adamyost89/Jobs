/**
 * Smoke-test ProLine list endpoint (read-only one page).
 *
 * Requires in platform/.env:
 *   PROLINE_API_KEY, PROLINE_API_BASE_URL, PROLINE_API_PROJECTS_PATH
 *
 * Run: npm run proline:probe
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { readProlineApiEnv } from "../src/lib/proline-api-client";
import { probeProlineProjectsList } from "../src/lib/proline-api-job-sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const p = path.join(__dirname, "../.env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

async function main() {
  loadDotEnv();
  try {
    const env = readProlineApiEnv();
    const r = await probeProlineProjectsList(env);
    console.log("HTTP", r.status);
    console.log("URL", r.url);
    console.log("Items this page:", r.itemCount);
    console.log("Sample keys (first row):", r.sampleKeys.join(", ") || "(none)");
    if (r.status < 200 || r.status >= 300) process.exit(1);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
