import * as path from "path";

/** Stable workbook id for snapshots (one slug per .xlsx file). */
export function workbookKeyFromPath(fp: string): string {
  const base = path.basename(fp, path.extname(fp));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
