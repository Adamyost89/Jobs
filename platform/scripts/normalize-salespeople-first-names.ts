/**
 * One-time: merge duplicate `Salesperson` rows (e.g. "Drew" + "Drew Puckett") into first-name
 * rows, rename any lone full-name rows, rewrite `CommissionPlan.config` name keys, and align
 * `BilledProjectLine.ownerName`.
 *
 * Run from `platform/` with `DATABASE_URL` set (same as the running app).
 *
 * Linux / bash — dry run (no writes):
 *   DRY_RUN=1 npm run normalize:salespeople-first-names
 *
 * Apply for real:
 *   unset DRY_RUN
 *   npm run normalize:salespeople-first-names
 *
 * Docker (this repo’s `docker-compose.prod.yml`): the app service is named **`app`** and the
 * container working directory is **`/app`** (not your host path under `/opt/...`).
 *
 *   docker compose -f docker-compose.prod.yml exec app sh -lc 'cd /app && DRY_RUN=1 npm run normalize:salespeople-first-names'
 *
 * Rebuild/redeploy the `app` image after Dockerfile changes so `scripts/` and `src/` exist in the container.
 *
 * **From the host** (no exec): if Postgres publishes port `5432` to localhost, point Prisma at
 * `127.0.0.1` instead of `db`, e.g. set `DATABASE_URL` to the same credentials with host `127.0.0.1`.
 *
 * (PowerShell on Windows uses `$env:DRY_RUN = "1"` instead of `DRY_RUN=1`.)
 */
import { Prisma, type PrismaClient, SalespersonKind } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { recalculateJobAndCommissions } from "../src/lib/job-workflow";
import { isCommissionPlanConfigV1, type CommissionPlanConfigV1 } from "../src/lib/commission-plan-types";
import { firstTokenName, normalizeSalespersonName } from "../src/lib/salesperson-name";

type SpRow = { id: string; name: string; active: boolean; kind: SalespersonKind };

/** Interactive transaction client is structurally sufficient for the calls below. */
type DbTx = PrismaClient | Prisma.TransactionClient;

function groupKey(name: string): string {
  return firstTokenName(name).toLowerCase();
}

function addDecimal(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(a.toString()).add(new Prisma.Decimal(b.toString()));
}

async function fkWeight(tx: DbTx, id: string): Promise<number> {
  const [jobs, comms, payouts, users] = await Promise.all([
    tx.job.count({ where: { salespersonId: id } }),
    tx.commission.count({ where: { salespersonId: id } }),
    tx.commissionPayout.count({ where: { salespersonId: id } }),
    tx.user.count({ where: { salespersonId: id } }),
  ]);
  return jobs + comms + payouts + users * 1_000;
}

/** Prefer single-token names in the group, then the row with the most attached data. */
async function pickCanonical(tx: DbTx, rows: SpRow[]): Promise<SpRow> {
  const key = groupKey(rows[0]!.name);
  const singles = rows.filter((r) => normalizeSalespersonName(r.name).split(/\s+/).length === 1);
  const singlesMatching = singles.filter((r) => groupKey(r.name) === key);
  const pool = singlesMatching.length ? singlesMatching : rows;
  let pick = pool[0]!;
  let w = -1;
  for (const r of pool) {
    const weight = await fkWeight(tx, r.id);
    if (weight > w || (weight === w && r.id < pick.id)) {
      w = weight;
      pick = r;
    }
  }
  return pick;
}

function displayNameForGroup(rows: SpRow[], canonical: SpRow): string {
  const key = groupKey(canonical.name);
  const singles = rows.filter((r) => normalizeSalespersonName(r.name).split(/\s+/).length === 1);
  const singlesMatching = singles.filter((r) => groupKey(r.name) === key);
  if (singlesMatching.length) {
    singlesMatching.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    return singlesMatching[0]!.name;
  }
  return firstTokenName(canonical.name);
}

async function buildNameRemap(tx: DbTx, initial: SpRow[], plans: { config: unknown }[]): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  for (const r of initial) {
    remap.set(r.name, r.name);
  }

  const groups = new Map<string, SpRow[]>();
  for (const r of initial) {
    const g = groupKey(r.name);
    const arr = groups.get(g) ?? [];
    arr.push(r);
    groups.set(g, arr);
  }

  const mergeInto = new Map<string, string>();
  const finalNames = new Map<string, string>();

  for (const [, rows] of groups) {
    const canonical = await pickCanonical(tx, rows);
    const display = displayNameForGroup(rows, canonical);
    for (const r of rows) {
      mergeInto.set(r.id, canonical.id);
      finalNames.set(r.id, display);
    }
  }

  for (const r of initial) {
    const rootId = mergeInto.get(r.id) ?? r.id;
    const fn = finalNames.get(rootId) ?? firstTokenName(r.name);
    remap.set(r.name, fn);
  }

  const extraNames = new Set<string>();
  for (const p of plans) {
    const c = p.config;
    if (!isCommissionPlanConfigV1(c)) continue;
    for (const k of Object.keys(c.people)) {
      extraNames.add(k);
    }
    for (const k of c.peopleOrder ?? []) {
      extraNames.add(k);
    }
  }
  for (const n of extraNames) {
    if (!remap.has(n)) {
      remap.set(n, firstTokenName(n));
    }
  }

  return remap;
}

async function mergeOneSalesperson(tx: DbTx, sourceId: string, targetId: string, affectedJobIds: Set<string>): Promise<void> {
  if (sourceId === targetId) return;

  const [uSource, uTarget] = await Promise.all([
    tx.user.findUnique({ where: { salespersonId: sourceId } }),
    tx.user.findUnique({ where: { salespersonId: targetId } }),
  ]);
  if (uSource && uTarget) {
    throw new Error(`Cannot merge salesperson ${sourceId} into ${targetId}: both have linked users.`);
  }
  if (uSource && !uTarget) {
    await tx.user.update({ where: { id: uSource.id }, data: { salespersonId: targetId } });
  }

  const [sourceSp, targetSp] = await Promise.all([
    tx.salesperson.findUniqueOrThrow({ where: { id: sourceId } }),
    tx.salesperson.findUniqueOrThrow({ where: { id: targetId } }),
  ]);

  await tx.salesperson.update({
    where: { id: targetId },
    data: {
      active: sourceSp.active || targetSp.active,
      kind:
        sourceSp.kind === SalespersonKind.MANAGER || targetSp.kind === SalespersonKind.MANAGER
          ? SalespersonKind.MANAGER
          : targetSp.kind,
    },
  });

  const jobRows = await tx.job.findMany({ where: { salespersonId: sourceId }, select: { id: true } });
  for (const j of jobRows) affectedJobIds.add(j.id);
  await tx.job.updateMany({ where: { salespersonId: sourceId }, data: { salespersonId: targetId } });

  const payoutRows = await tx.commissionPayout.findMany({
    where: { salespersonId: sourceId },
    select: { jobId: true },
  });
  for (const p of payoutRows) {
    if (p.jobId) affectedJobIds.add(p.jobId);
  }
  await tx.commissionPayout.updateMany({ where: { salespersonId: sourceId }, data: { salespersonId: targetId } });

  const sourceCommissions = await tx.commission.findMany({ where: { salespersonId: sourceId } });
  for (const c of sourceCommissions) {
    affectedJobIds.add(c.jobId);
    const existing = await tx.commission.findUnique({
      where: { jobId_salespersonId: { jobId: c.jobId, salespersonId: targetId } },
    });
    if (!existing) {
      await tx.commission.update({ where: { id: c.id }, data: { salespersonId: targetId } });
    } else {
      const paidAmount = addDecimal(existing.paidAmount, c.paidAmount);
      const owedAmount = addDecimal(existing.owedAmount, c.owedAmount);
      const override = existing.override || c.override;
      await tx.commission.update({
        where: { id: existing.id },
        data: { paidAmount, owedAmount, override },
      });
      await tx.commission.delete({ where: { id: c.id } });
    }
  }

  await tx.salesperson.delete({ where: { id: sourceId } });
}

function rewriteCommissionPlanConfig(
  cfg: CommissionPlanConfigV1,
  nameRemap: Map<string, string>
): CommissionPlanConfigV1 {
  const resolve = (n: string) => nameRemap.get(normalizeSalespersonName(n)) ?? firstTokenName(n);

  const keys = Object.keys(cfg.people).sort((a, b) => {
    const ra = resolve(a) === a ? 0 : 1;
    const rb = resolve(b) === b ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  const people: Record<string, (typeof cfg.people)[string]> = {};
  for (const k of keys) {
    const nk = resolve(k);
    if (!people[nk]) {
      people[nk] = cfg.people[k]!;
    }
  }

  const orderRaw = cfg.peopleOrder ?? keys;
  const peopleOrder: string[] = [];
  const seen = new Set<string>();
  for (const n of orderRaw) {
    const nn = resolve(n);
    if (!seen.has(nn)) {
      seen.add(nn);
      peopleOrder.push(nn);
    }
  }

  return { ...cfg, people, peopleOrder };
}

function printDbConnectionHint(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes("Can't reach database server") && !msg.includes("P1001")) return;
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      const u = new URL(url.replace(/^postgresql:\/\//, "http://"));
      return u.hostname || "(unknown host)";
    } catch {
      return "(could not parse DATABASE_URL)";
    }
  })();
  console.error(`
Could not connect to Postgres (${host}).

If DATABASE_URL uses a Docker-only hostname (often "db"), run inside the **app** container (repo
prod Compose service is usually \`app\`, cwd \`/app\`), for example:

  docker compose -f docker-compose.prod.yml exec app sh -lc 'cd /app && DRY_RUN=1 npm run normalize:salespeople-first-names'

Or set DATABASE_URL to use 127.0.0.1 (or localhost) when Postgres publishes port 5432 on the host.

Shell reminder (bash): dry run is \`DRY_RUN=1 npm run ...\`, not PowerShell \`$env:DRY_RUN\`.
`);
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

  let initial: SpRow[];
  let plans: { id: string; year: number; config: unknown }[];
  try {
    initial = await prisma.salesperson.findMany({
      orderBy: { name: "asc" },
    });
    plans = await prisma.commissionPlan.findMany({ select: { id: true, year: true, config: true } });
  } catch (e) {
    printDbConnectionHint(e);
    throw e;
  }

  const groups = new Map<string, SpRow[]>();
  for (const r of initial) {
    const g = groupKey(r.name);
    const arr = groups.get(g) ?? [];
    arr.push(r);
    groups.set(g, arr);
  }

  const nameRemap = await buildNameRemap(prisma, initial, plans);

  const ops: string[] = [];
  for (const [, rows] of groups) {
    const canonical = await pickCanonical(prisma, rows);
    const display = displayNameForGroup(rows, canonical);
    for (const r of rows) {
      if (r.id !== canonical.id) {
        ops.push(`merge "${r.name}" (${r.id}) -> "${display}" (${canonical.id})`);
      } else if (r.name !== display) {
        ops.push(`rename "${r.name}" (${r.id}) -> "${display}"`);
      }
    }
  }

  const planUpdates: { year: number; beforeKeys: string[]; afterKeys: string[] }[] = [];
  for (const p of plans) {
    if (!isCommissionPlanConfigV1(p.config)) continue;
    const beforeKeys = Object.keys(p.config.people).sort();
    const next = rewriteCommissionPlanConfig(p.config, nameRemap);
    const afterKeys = Object.keys(next.people).sort();
    if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys) || JSON.stringify(p.config) !== JSON.stringify(next)) {
      planUpdates.push({ year: p.year, beforeKeys, afterKeys });
    }
  }

  const distinctOwnersPreview = await prisma.billedProjectLine.findMany({
    select: { ownerName: true },
    distinct: ["ownerName"],
  });
  const ownerChanges = distinctOwnersPreview
    .map((r) => {
      const next = nameRemap.get(normalizeSalespersonName(r.ownerName)) ?? firstTokenName(r.ownerName);
      return { from: r.ownerName, to: next };
    })
    .filter((x) => x.from !== x.to);

  console.log(dryRun ? "DRY RUN (no writes)\n" : "APPLYING migration\n");
  for (const line of ops) console.log(line);
  console.log(`\nCommission plans to touch: ${planUpdates.length}`);
  for (const u of planUpdates) {
    console.log(`  year ${u.year}: [${u.beforeKeys.join(", ")}] -> [${u.afterKeys.join(", ")}]`);
  }
  console.log(`\nBilledProjectLine ownerName variants to normalize: ${ownerChanges.length}`);
  for (const o of ownerChanges.slice(0, 30)) console.log(`  "${o.from}" -> "${o.to}"`);
  if (ownerChanges.length > 30) console.log(`  ... and ${ownerChanges.length - 30} more`);

  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  const affectedJobIds = new Set<string>();

  await prisma.$transaction(
    async (tx) => {
      for (const [, rows] of groups) {
        const canonical = await pickCanonical(tx, rows);
        const display = displayNameForGroup(rows, canonical);
        const others = rows.filter((r) => r.id !== canonical.id);
        for (const r of others) {
          await mergeOneSalesperson(tx, r.id, canonical.id, affectedJobIds);
        }
        const cur = await tx.salesperson.findUniqueOrThrow({ where: { id: canonical.id } });
        if (cur.name !== display) {
          const clash = await tx.salesperson.findFirst({
            where: {
              name: { equals: display, mode: "insensitive" },
              NOT: { id: canonical.id },
            },
          });
          if (clash) {
            throw new Error(`Rename clash: cannot set ${canonical.id} to "${display}"; exists ${clash.id} "${clash.name}"`);
          }
          await tx.salesperson.update({ where: { id: canonical.id }, data: { name: display } });
        }
      }

      for (const p of plans) {
        if (!isCommissionPlanConfigV1(p.config)) continue;
        const next = rewriteCommissionPlanConfig(p.config, nameRemap);
        if (JSON.stringify(p.config) === JSON.stringify(next)) continue;
        await tx.commissionPlan.update({
          where: { id: p.id },
          data: { config: next as unknown as Prisma.InputJsonValue },
        });
      }

      const distinctOwners = await tx.billedProjectLine.findMany({
        select: { ownerName: true },
        distinct: ["ownerName"],
      });
      for (const { ownerName } of distinctOwners) {
        const trimmed = normalizeSalespersonName(ownerName);
        if (!trimmed) continue;
        const next = nameRemap.get(trimmed) ?? firstTokenName(trimmed);
        if (next === trimmed) continue;
        await tx.billedProjectLine.updateMany({
          where: { ownerName },
          data: { ownerName: next },
        });
      }
    },
    { timeout: 600_000, maxWait: 60_000 }
  );

  const recalcIds = [...affectedJobIds];
  console.log(`\nRecalculating commissions for ${recalcIds.length} jobs...`);
  for (const jobId of recalcIds) {
    await recalculateJobAndCommissions(jobId);
  }

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
