/**
 * Resolves workbook paths on disk (Windows often uses Title Case and "File (1).xlsx").
 */
import * as fs from "fs";
import * as path from "path";

export function workbookRoot(): string {
  return process.env.WORKBOOK_DIR || path.resolve(__dirname, "..", "..");
}

function firstExisting(root: string, names: string[]): string | null {
  for (const n of names) {
    const p = path.join(root, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function firstMatchRegex(root: string, pattern: RegExp): string | null {
  if (!fs.existsSync(root)) return null;
  const hit = fs.readdirSync(root).find((f) => pattern.test(f));
  return hit ? path.join(root, hit) : null;
}

/** Main Job Numbering export (tabs 2024 / 2025 / 2026). */
export function resolveJobNumberingXlsx(root: string = workbookRoot()): string | null {
  return (
    firstExisting(root, [
      "job numbering.xlsx",
      "Job Numbering.xlsx",
      "Job Numbering(1).xlsx",
      "Job Numbering (1).xlsx",
    ]) ?? firstMatchRegex(root, /^job numbering.*\.xlsx$/i)
  );
}

export function resolveCommissionsXlsx(root: string = workbookRoot()): string | null {
  return (
    firstExisting(root, ["commissions.xlsx", "Commissions.xlsx"]) ??
    firstMatchRegex(root, /^commissions\.xlsx$/i)
  );
}

export function resolveDrewBilledXlsx(root: string = workbookRoot()): string | null {
  return (
    firstExisting(root, [
      "drew billed projects.xlsx",
      "Drew Billed Projects.xlsx",
      "Drew billed projects.xlsx",
    ]) ?? firstMatchRegex(root, /^drew billed projects.*\.xlsx$/i)
  );
}

/** All supplemental billed-project workbooks (Drew, Brett, James, Mike, …). */
export function globBilledProjectWorkbooks(root: string = workbookRoot()): string[] {
  if (!fs.existsSync(root)) return [];
  const set = new Set<string>();
  for (const f of fs.readdirSync(root)) {
    if (!/\.xlsx$/i.test(f)) continue;
    if (!/billed.*projects/i.test(f) && !/projects.*billed/i.test(f)) continue;
    set.add(path.join(root, f));
  }
  return [...set];
}

/** Every `.xlsx` at repo root (Excel temp files excluded). */
export function globAllXlsxWorkbooks(root: string = workbookRoot()): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"))
    .map((f) => path.join(root, f));
}
