/**
 * Lists all sheets and first-row headers for workbooks in WORKBOOK_DIR (default: parent of /platform).
 * Usage: npm run inventory
 */
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import {
  workbookRoot,
  resolveJobNumberingXlsx,
  resolveCommissionsXlsx,
  resolveDrewBilledXlsx,
  globBilledProjectWorkbooks,
} from "./workbook-paths";

const root = workbookRoot();
const resolved = [
  { label: "job_numbering", resolve: resolveJobNumberingXlsx },
  { label: "commissions", resolve: resolveCommissionsXlsx },
] as const;

const out: Record<string, unknown> = { root, files: [] as unknown[] };

for (const { label, resolve } of resolved) {
  const fp = resolve(root);
  if (!fp) {
    (out.files as unknown[]).push({ label, error: "NOT_FOUND", tried: root });
    continue;
  }
  const wb = XLSX.readFile(fp);
  const sheets = wb.SheetNames.map((name) => {
    const sh = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sh, {
      header: 1,
      defval: "",
    });
    const firstRow = rows[0] ?? [];
    return { name, ref: sh["!ref"] ?? null, firstRowHeaders: firstRow.slice(0, 40) };
  });
  (out.files as unknown[]).push({ label, file: path.basename(fp), path: fp, sheets });
}

const billedSet = new Set<string>(globBilledProjectWorkbooks(root));
const drewOnly = resolveDrewBilledXlsx(root);
if (billedSet.size === 0 && drewOnly) billedSet.add(drewOnly);
for (const fp of billedSet) {
  const wb = XLSX.readFile(fp);
  const sheets = wb.SheetNames.map((name) => {
    const sh = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sh, {
      header: 1,
      defval: "",
    });
    const firstRow = rows[0] ?? [];
    return { name, ref: sh["!ref"] ?? null, firstRowHeaders: firstRow.slice(0, 40) };
  });
  (out.files as unknown[]).push({
    label: `billed_projects:${path.basename(fp)}`,
    file: path.basename(fp),
    path: fp,
    sheets,
  });
}

const outPath = path.join(root, "docs", "workbook-inventory.generated.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log("Wrote", outPath);
