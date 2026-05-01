import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canEditJobs } from "@/lib/rbac";
import { readWorkbookFromBuffer, sheetToRows } from "@/lib/job-sheet-import";
import { importPayoutSheetTab, type PayoutImportTabResult } from "@/lib/payout-sheet-import";
import { payoutColumnMapKeySet } from "@/lib/payout-column-map";

export const maxDuration = 300;

const MAX_BYTES = 35 * 1024 * 1024;
const columnKeySet = payoutColumnMapKeySet();

const tabSchema = z
  .object({
    sheetName: z.string().min(1),
    headerMode: z.enum(["auto", "manual"]),
    headerRow0Based: z.number().int().min(0).max(5000).optional(),
    dataStartRow0Based: z.number().int().min(0).max(100000).optional(),
    dataEndExclusive: z.number().int().min(0).max(200000).optional(),
    columnMap: z.record(z.string(), z.number().int().min(0).max(500)).optional(),
    columnMapMode: z.enum(["merge", "manual_only"]).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.headerMode === "manual" && t.headerRow0Based === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "headerRow0Based is required when headerMode is manual",
        path: ["headerRow0Based"],
      });
    }
    if (t.columnMap) {
      for (const k of Object.keys(t.columnMap)) {
        if (!columnKeySet.has(k)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown columnMap key "${k}"`,
            path: ["columnMap", k],
          });
        }
      }
    }
  });

const configSchema = z.object({
  tabs: z.array(tabSchema).min(1).max(25),
  allowOverwrite: z.boolean().optional(),
  expectedOverwriteCount: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditJobs(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = form.get("file");
  const configRaw = form.get("config");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Attach a single .xlsx file as \"file\"." }, { status: 400 });
  }
  if (typeof configRaw !== "string") {
    return NextResponse.json({ error: "Field \"config\" must be a JSON string." }, { status: 400 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(configRaw);
  } catch {
    return NextResponse.json({ error: "config must be valid JSON" }, { status: 400 });
  }
  const parsedConfig = configSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    return NextResponse.json(
      { error: "Invalid config", details: parsedConfig.error.flatten() },
      { status: 400 }
    );
  }
  const config = parsedConfig.data;
  const allowOverwrite = config.allowOverwrite === true;

  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .xlsx workbooks are supported." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: `Workbook too large (max ${MAX_BYTES / (1024 * 1024)} MB).` }, { status: 413 });
  }

  let wb: ReturnType<typeof readWorkbookFromBuffer>;
  try {
    wb = readWorkbookFromBuffer(buf);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read workbook";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  type RunTabResult =
    | { ok: true; sheetName: string; stats: PayoutImportTabResult }
    | { ok: false; sheetName: string; error: string };

  const results: RunTabResult[] = [];
  const dryRunResults: RunTabResult[] = [];

  for (const tab of config.tabs) {
    if (!wb.SheetNames.includes(tab.sheetName)) {
      dryRunResults.push({
        ok: false,
        sheetName: tab.sheetName,
        error: `Sheet "${tab.sheetName}" not found in workbook`,
      });
      continue;
    }
    const sh = wb.Sheets[tab.sheetName];
    if (!sh) {
      dryRunResults.push({ ok: false, sheetName: tab.sheetName, error: "Missing sheet object" });
      continue;
    }
    const rows = sheetToRows(sh);
    try {
      const stats = await importPayoutSheetTab(prisma, rows, {
        sheetName: tab.sheetName,
        headerMode: tab.headerMode,
        headerRow0Based: tab.headerRow0Based,
        dataStartRow0Based: tab.dataStartRow0Based,
        dataEndExclusive: tab.dataEndExclusive,
        columnMap: tab.columnMap ?? {},
        columnMapMode: tab.columnMapMode,
        recordedByUserId: user.id,
        dryRun: true,
      });
      dryRunResults.push({ ok: true, sheetName: tab.sheetName, stats });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dryRunResults.push({ ok: false, sheetName: tab.sheetName, error: message });
    }
  }

  const overwriteCount = dryRunResults.reduce((sum, r) => sum + (r.ok ? r.stats.updated : 0), 0);
  const createCount = dryRunResults.reduce((sum, r) => sum + (r.ok ? r.stats.created : 0), 0);
  if (overwriteCount > 0 && !allowOverwrite) {
    return NextResponse.json(
      {
        error: "Import would overwrite existing payout rows. Confirm overwrite to continue.",
        requiresOverwriteConfirmation: true,
        overwriteCount,
        createCount,
        dryRunResults,
      },
      { status: 409 }
    );
  }
  if (
    overwriteCount > 0 &&
    config.expectedOverwriteCount !== undefined &&
    config.expectedOverwriteCount !== overwriteCount
  ) {
    return NextResponse.json(
      {
        error: "Overwrite count changed since confirmation. Please review and confirm again.",
        requiresOverwriteConfirmation: true,
        overwriteCount,
        createCount,
        dryRunResults,
      },
      { status: 409 }
    );
  }

  for (const tab of config.tabs) {
    if (!wb.SheetNames.includes(tab.sheetName)) {
      results.push({
        ok: false,
        sheetName: tab.sheetName,
        error: `Sheet "${tab.sheetName}" not found in workbook`,
      });
      continue;
    }
    const sh = wb.Sheets[tab.sheetName];
    if (!sh) {
      results.push({ ok: false, sheetName: tab.sheetName, error: "Missing sheet object" });
      continue;
    }
    const rows = sheetToRows(sh);
    try {
      const stats = await importPayoutSheetTab(prisma, rows, {
        sheetName: tab.sheetName,
        headerMode: tab.headerMode,
        headerRow0Based: tab.headerRow0Based,
        dataStartRow0Based: tab.dataStartRow0Based,
        dataEndExclusive: tab.dataEndExclusive,
        columnMap: tab.columnMap ?? {},
        columnMapMode: tab.columnMapMode,
        recordedByUserId: user.id,
        dryRun: false,
      });
      results.push({ ok: true, sheetName: tab.sheetName, stats });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ ok: false, sheetName: tab.sheetName, error: message });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "PAYOUT_IMPORT_RUN",
      entityType: "CommissionPayout",
      payload: {
        fileName: file.name,
        tabCount: config.tabs.length,
        allowOverwrite,
        overwriteCount,
        createCount,
        results,
      },
    },
  });

  return NextResponse.json({
    ok: true as const,
    fileName: file.name,
    overwriteCount,
    createCount,
    results,
  });
}
