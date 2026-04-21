import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { parseProlineNameAliasMap } from "@/lib/proline-name-alias";

const entrySchema = z.object({
  source: z.string().trim().min(1).max(160),
  target: z.string().trim().min(1).max(80),
});

const postSchema = z.object({
  entries: z.array(entrySchema).max(500),
});

function toEntries(aliases: Record<string, string>): { source: string; target: string }[] {
  return Object.entries(aliases)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([source, target]) => ({ source, target }));
}

async function readAliases(): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<Array<{ prolineNameAliases: unknown }>>(
    Prisma.sql`SELECT "prolineNameAliases" FROM "SystemConfig" WHERE "id" = 'singleton' LIMIT 1`
  );
  return parseProlineNameAliasMap(rows[0]?.prolineNameAliases);
}

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const aliases = await readAliases();
  return NextResponse.json({ aliases, entries: toEntries(aliases) });
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

  const normalized: Record<string, string> = {};
  for (const row of parsed.data.entries) {
    const source = row.source.trim().toLowerCase();
    const target = row.target.trim();
    if (!source || !target) continue;
    normalized[source] = target;
  }

  const aliasesJson = JSON.stringify(normalized);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "SystemConfig" ("id", "cutoverComplete", "prolineNameAliases")
      VALUES ('singleton', false, ${aliasesJson}::jsonb)
      ON CONFLICT ("id")
      DO UPDATE SET "prolineNameAliases" = EXCLUDED."prolineNameAliases"
    `
  );

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "PROLINE_NAME_ALIASES_UPDATE",
      entityType: "SystemConfig",
      entityId: "singleton",
      payload: { count: Object.keys(normalized).length },
    },
  });

  return NextResponse.json({ ok: true, aliases: normalized, entries: toEntries(normalized) });
}
