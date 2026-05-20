import { Prisma, type PrismaClient } from "@prisma/client";

function normalizeWhitespace(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSalespersonName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return normalizeWhitespace(raw);
}

export function firstTokenName(raw: string): string {
  const normalized = normalizeWhitespace(raw);
  if (!normalized) return "";
  const [first = ""] = normalized.split(" ");
  const cleaned = first.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  return cleaned || first;
}

export function displaySalespersonName(raw: unknown): string {
  const normalized = normalizeSalespersonName(raw);
  if (!normalized) return "";
  return firstTokenName(normalized) || normalized;
}

/** Jobs/reports filter: one display token (e.g. James) matches "James" and "James Smith" rows. */
export function salespersonJobFilterByDisplayToken(token: string): Prisma.JobWhereInput {
  const t = normalizeSalespersonName(token);
  if (!t) return { id: "__none__" };
  return {
    OR: [
      { salesperson: { is: { name: { equals: t, mode: Prisma.QueryMode.insensitive } } } },
      { salesperson: { is: { name: { startsWith: `${t} `, mode: Prisma.QueryMode.insensitive } } } },
    ],
  };
}

/** Commission lines filter: same display-token rules as jobs (James → James + James Smith). */
export function salespersonCommissionFilterByDisplayToken(token: string): Prisma.CommissionWhereInput {
  const t = normalizeSalespersonName(token);
  if (!t) return { id: "__none__" };
  return {
    OR: [
      { salesperson: { name: { equals: t, mode: Prisma.QueryMode.insensitive } } },
      { salesperson: { name: { startsWith: `${t} `, mode: Prisma.QueryMode.insensitive } } },
    ],
  };
}

/**
 * Prefer the existing first-name salesperson row when external systems send full names.
 * This keeps internal commission mappings stable even if ProLine/Excel sends "First Last".
 */
export async function resolveOrCreateSalespersonByName(
  db: PrismaClient,
  rawName: unknown,
  opts?: { activeOnCreate?: boolean; preferFirstToken?: boolean }
): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeSalespersonName(rawName);
  if (!normalized) return null;

  const exact = await db.salesperson.findUnique({
    where: { name: normalized },
    select: { id: true, name: true },
  });
  if (exact) return exact;

  const exactCi = await db.salesperson.findFirst({
    where: { name: { equals: normalized, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exactCi) return exactCi;

  const preferFirstToken = opts?.preferFirstToken !== false;
  const firstName = firstTokenName(normalized);
  if (preferFirstToken && firstName && firstName !== normalized) {
    const firstExact = await db.salesperson.findUnique({
      where: { name: firstName },
      select: { id: true, name: true },
    });
    if (firstExact) return firstExact;

    const firstCi = await db.salesperson.findFirst({
      where: { name: { equals: firstName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (firstCi) return firstCi;
  }

  const createName = preferFirstToken && firstName ? firstName : normalized;
  const created = await db.salesperson.upsert({
    where: { name: createName },
    create: { name: createName, active: opts?.activeOnCreate ?? true },
    update: {},
    select: { id: true, name: true },
  });
  return created;
}
