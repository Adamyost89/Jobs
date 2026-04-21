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

function defaultEntries(): EntryDTO[] {
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

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const map = await readStatusColorMap();
  return NextResponse.json({
    map,
    entries: toEntries(map),
    defaults: defaultEntries(),
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

  const rawMap: StatusBadgeColorMap = {};
  for (const entry of parsed.data.entries) {
    rawMap[normalizeStatusBadgeKey(entry.key)] = {
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

  return NextResponse.json({ ok: true, map: normalized, entries: toEntries(normalized), defaults: defaultEntries() });
}
