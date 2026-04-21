import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { displaySalespersonName } from "./salesperson-name";

export type SalesKind = "REP" | "MANAGER";

function parseKind(v: string): SalesKind {
  return v === "MANAGER" ? "MANAGER" : "REP";
}

export type SalespersonAdminRow = {
  id: string;
  name: string;
  active: boolean;
  kind: SalesKind;
};

/**
 * Reads `Salesperson.kind` via raw SQL so it works even when the generated Prisma Client
 * is temporarily out of sync with `schema.prisma` (run `npx prisma generate` after stopping `next dev` on Windows).
 */
export async function loadSalespeopleWithKindForAdmin(): Promise<SalespersonAdminRow[]> {
  const rows = await prisma.$queryRaw<{ id: string; name: string; active: boolean; kind: string | null }[]>(
    Prisma.sql`
      SELECT id, name, active, COALESCE(kind::text, 'REP') AS kind
      FROM "Salesperson"
      ORDER BY name ASC
    `
  );
  return rows.map((r) => ({
    id: r.id,
    name: displaySalespersonName(r.name),
    active: r.active,
    kind: parseKind(r.kind ?? "REP"),
  }));
}

export async function loadSalespersonFlagsByName(): Promise<{
  kindByName: Record<string, SalesKind>;
  activeByName: Record<string, boolean>;
}> {
  const rows = await prisma.$queryRaw<{ name: string; active: boolean; kind: string | null }[]>(
    Prisma.sql`
      SELECT name, active, COALESCE(kind::text, 'REP') AS kind
      FROM "Salesperson"
    `
  );
  const kindByName: Record<string, SalesKind> = {};
  const activeByName: Record<string, boolean> = {};
  for (const r of rows) {
    kindByName[r.name] = parseKind(r.kind ?? "REP");
    activeByName[r.name] = r.active;
  }
  return { kindByName, activeByName };
}

async function fetchOneAdminRow(id: string): Promise<SalespersonAdminRow> {
  const rows = await prisma.$queryRaw<{ id: string; name: string; active: boolean; kind: string | null }[]>(
    Prisma.sql`
      SELECT id, name, active, COALESCE(kind::text, 'REP') AS kind
      FROM "Salesperson"
      WHERE id = ${id}
      LIMIT 1
    `
  );
  const r = rows[0];
  if (!r) throw new Error("Salesperson not found");
  return {
    id: r.id,
    name: displaySalespersonName(r.name),
    active: r.active,
    kind: parseKind(r.kind ?? "REP"),
  };
}

export async function updateSalespersonAdminRaw(
  id: string,
  patch: { kind?: SalesKind; active?: boolean }
): Promise<SalespersonAdminRow> {
  if (!id || typeof id !== "string") {
    throw new Error("Invalid salesperson id");
  }
  if (patch.kind === undefined && patch.active === undefined) {
    throw new Error("Nothing to update");
  }
  if (patch.kind !== undefined && patch.kind !== "MANAGER" && patch.kind !== "REP") {
    throw new Error("Invalid kind");
  }
  if (patch.kind !== undefined) {
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "Salesperson"
        SET kind = ${patch.kind}::"SalespersonKind"
        WHERE id = ${id}
      `
    );
  }
  if (patch.active !== undefined) {
    await prisma.$executeRaw(Prisma.sql`UPDATE "Salesperson" SET active = ${patch.active} WHERE id = ${id}`);
  }
  return fetchOneAdminRow(id);
}
