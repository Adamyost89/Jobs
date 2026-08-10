import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  compareProlineCsvToJobs,
  parseCompareFields,
} from "@/lib/proline-csv-compare";

export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Attach a ProLine projects CSV as "file".' }, { status: 400 });
  }
  if (!/\.csv$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .csv files are supported." }, { status: 400 });
  }

  const applyRaw = form.get("apply");
  const apply = applyRaw === "true" || applyRaw === "1";

  const fieldsRaw = form.getAll("fields");
  const fieldsFromParts: string[] = [];
  for (const v of fieldsRaw) {
    if (typeof v === "string") fieldsFromParts.push(v);
  }
  const fieldsJoined = form.get("fields");
  if (typeof fieldsJoined === "string" && fieldsJoined.includes(",")) {
    fieldsFromParts.push(...fieldsJoined.split(","));
  }
  const fields = parseCompareFields(fieldsFromParts);

  const onlyJobIds: string[] = [];
  for (const v of form.getAll("onlyJobIds")) {
    if (typeof v !== "string") continue;
    if (v.includes(",")) {
      for (const p of v.split(",")) {
        const t = p.trim();
        if (t) onlyJobIds.push(t);
      }
    } else if (v.trim()) {
      onlyJobIds.push(v.trim());
    }
  }

  const toleranceRaw = form.get("tolerance");
  let tolerance: number | undefined;
  if (typeof toleranceRaw === "string" && toleranceRaw.trim()) {
    const n = Number(toleranceRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 100) tolerance = n;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `CSV too large (max ${MAX_BYTES / (1024 * 1024)} MB).` },
      { status: 413 }
    );
  }

  let csvText: string;
  try {
    csvText = buf.toString("utf8");
  } catch {
    return NextResponse.json({ error: "Could not read CSV as UTF-8 text." }, { status: 400 });
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "CSV file is empty." }, { status: 400 });
  }

  try {
    const result = await compareProlineCsvToJobs(prisma, {
      csvText,
      apply,
      fields,
      tolerance,
      onlyJobIds: onlyJobIds.length ? onlyJobIds : undefined,
    });

    return NextResponse.json({
      ok: true as const,
      apply,
      fields: fields ?? null,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: message }, { status: 400 });
  }
}
