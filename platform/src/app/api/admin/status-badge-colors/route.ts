import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  normalizeStatusBadgeColorMap,
  normalizeStatusBadgeKey,
  STATUS_BADGE_DEFAULT_KEYS,
  resolveStatusBadgeColors,
  statusColumnLabel,
  type StatusBadgeColorMap,
} from "@/lib/status-badge-colors";

const entrySchema = z.object({
  key: z.string().trim().min(1).max(80),
  background: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(64),
  border: z.string().trim().min(1).max(64),
});

const postSchema = z.object({
  entries: z.array(entrySchema).max(300),
});

type Row = {
  statusBadgeColors: unknown;
};

type EntryDTO = {
  key: string;
  label: string;
  background: string;
  text: string;
  border: string;
  isDefault: boolean;
};

type JobStatusRow = {
  status: string;
  prolineStage: string | null;
};

async function readStatusColorMap(): Promise<StatusBadgeColorMap> {
  const rows = await prisma.$queryRaw<Row[]>(
    Prisma.sql`SELECT "statusBadgeColors" FROM "SystemConfig" WHERE "id" = 'singleton' LIMIT 1`
  );
  return normalizeStatusBadgeColorMap(rows[0]?.statusBadgeColors);
}

function toEntries(map: StatusBadgeColorMap): EntryDTO[] {
  const defaults = new Set(STATUS_BADGE_DEFAULT_KEYS.map((key) => normalizeStatusBadgeKey(key)));
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, c]) => ({
      key,
      label: statusColumnLabel(key),
      background: c.background,
      text: c.text,
      border: c.border,
      isDefault: defaults.has(key),
    }));
}

function staticDefaultEntries(): EntryDTO[] {
  return STATUS_BADGE_DEFAULT_KEYS.map((key) => {
    const c = resolveStatusBadgeColors({ status: key });
    return {
      key: normalizeStatusBadgeKey(key),
      label: statusColumnLabel(key),
      background: c.background,
      text: c.text,
      border: c.border,
      isDefault: true,
    };
  });
}

async function dynamicDefaultEntries(): Promise<EntryDTO[]> {
  const staticDefaults = staticDefaultEntries();
  const staticKeys = new Set(staticDefaults.map((entry) => normalizeStatusBadgeKey(entry.key)));

  const jobStatuses = await prisma.job.findMany({
    select: { status: true, prolineStage: true },
    take: 5000,
  });

  const dynamicLabels = new Set<string>();
  for (const row of jobStatuses as JobStatusRow[]) {
    const label = statusColumnLabel(row.status, row.prolineStage).trim();
    if (!label) continue;
    const key = normalizeStatusBadgeKey(label);
    if (!key || staticKeys.has(key)) continue;
    dynamicLabels.add(label);
  }

  const dynamicDefaults: EntryDTO[] = [...dynamicLabels]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => {
      const c = resolveStatusBadgeColors({ status: label });
      return {
        key: normalizeStatusBadgeKey(label),
        label,
        background: c.background,
        text: c.text,
        border: c.border,
        isDefault: true,
      };
    });

  return [...staticDefaults, ...dynamicDefaults];
}

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const map = await readStatusColorMap();
  const defaults = await dynamicDefaultEntries();
  return NextResponse.json({
    map,
    entries: toEntries(map),
    defaults,
  });
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const defaults = await dynamicDefaultEntries();
  const allowedKeys = new Set(defaults.map((row) => normalizeStatusBadgeKey(row.key)));

  const rawMap: StatusBadgeColorMap = {};
  for (const entry of parsed.data.entries) {
    const key = normalizeStatusBadgeKey(entry.key);
    if (!allowedKeys.has(key)) {
      return NextResponse.json(
        { error: `Unknown status key "${entry.key}". Refresh settings to load current ProLine statuses.` },
        { status: 400 }
      );
    }
    rawMap[key] = {
      background: entry.background,
      text: entry.text,
      border: entry.border,
    };
  }
  const normalized = normalizeStatusBadgeColorMap(rawMap);
  const jsonMap = JSON.stringify(normalized);

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "SystemConfig" ("id", "cutoverComplete", "prolineNameAliases", "statusBadgeColors")
      VALUES ('singleton', false, '{}'::jsonb, ${jsonMap}::jsonb)
      ON CONFLICT ("id")
      DO UPDATE SET "statusBadgeColors" = EXCLUDED."statusBadgeColors"
    `
  );

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "STATUS_BADGE_COLORS_UPDATE",
      entityType: "SystemConfig",
      entityId: "singleton",
      payload: { count: Object.keys(normalized).length },
    },
  });

  return NextResponse.json({ ok: true, map: normalized, entries: toEntries(normalized), defaults });
}
