import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canEditJobs } from "@/lib/rbac";
import { readWorkbookFromBuffer } from "@/lib/job-sheet-import";
import { previewPayoutSheetsFromWorkbook } from "@/lib/payout-sheet-import";

const MAX_BYTES = 35 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditJobs(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Attach a single .xlsx file as \"file\"." }, { status: 400 });
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .xlsx workbooks are supported." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: `Workbook too large (max ${MAX_BYTES / (1024 * 1024)} MB).` }, { status: 413 });
  }

  try {
    const wb = readWorkbookFromBuffer(buf);
    const sheets = previewPayoutSheetsFromWorkbook(wb);
    return NextResponse.json({
      ok: true as const,
      fileName: file.name,
      sheetNames: wb.SheetNames,
      sheets,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read workbook";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
