import { Prisma, type PrismaClient } from "@prisma/client";
import {
  extractProjectListPage,
  prolineApiGet,
  readProlineApiEnv,
  type ProlineApiEnv,
} from "@/lib/proline-api-client";
import { allocateNextJobNumber, recalculateJobAndCommissions } from "@/lib/job-workflow";
import { normalizeStatus } from "@/lib/status";
import {
  mapProlineUserIdToSalespersonName,
  pickProlineProjectIdFromRecord,
} from "@/lib/proline-webhook";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Merge one nested `project` object into the root for Zapier-style payloads. */
function flattenRecord(raw: unknown): Record<string, unknown> {
  const r = asRecord(raw);
  if (!r) return {};
  const inner = asRecord(r.project);
  if (inner) return { ...r, ...inner };
  return r;
}

function pickStr(r: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickOptionalMoney(r: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = parseFloat(v.replace(/[$,]/g, ""));
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

export type SyncProlineJobsOpts = {
  dryRun: boolean;
  maxPages: number;
  defaultYear: number;
  userMapJson?: string;
};

export type SyncProlineJobsResult = {
  pagesFetched: number;
  rowsSeen: number;
  created: number;
  updated: number;
  skippedNoId: number;
  errors: string[];
  lastStatus?: number;
  lastUrl?: string;
};

async function resolveSalespersonId(
  db: PrismaClient,
  flat: Record<string, unknown>,
  userMapJson: string | undefined
): Promise<string | null> {
  const explicitName = pickStr(flat, ["salespersonName", "assigned_to_name", "main_assignee_name"]);
  if (explicitName) {
    const sp = await db.salesperson.upsert({
      where: { name: explicitName },
      create: { name: explicitName },
      update: {},
    });
    return sp.id;
  }
  const uid =
    pickStr(flat, ["assigned_to_id", "prolineUserId", "main_assignee_id"]) ||
    (typeof flat.assigned_to_id === "string" ? flat.assigned_to_id : undefined);
  const mapped = mapProlineUserIdToSalespersonName(uid, userMapJson);
  if (!mapped) return null;
  const sp = await db.salesperson.upsert({
    where: { name: mapped },
    create: { name: mapped },
    update: {},
  });
  return sp.id;
}

export async function syncProlineJobsFromApi(
  db: PrismaClient,
  opts: SyncProlineJobsOpts
): Promise<SyncProlineJobsResult> {
  const env = readProlineApiEnv();
  const result: SyncProlineJobsResult = {
    pagesFetched: 0,
    rowsSeen: 0,
    created: 0,
    updated: 0,
    skippedNoId: 0,
    errors: [],
  };

  let query: Record<string, string> = {};
  for (let page = 0; page < opts.maxPages; page++) {
    let res: Awaited<ReturnType<typeof prolineApiGet>>;
    try {
      res = await prolineApiGet(env, query);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
    result.lastStatus = res.status;
    result.lastUrl = res.url;
    if (res.status < 200 || res.status >= 300) {
      const hint =
        typeof res.json === "object" && res.json !== null
          ? JSON.stringify(res.json).slice(0, 400)
          : String(res.json);
      result.errors.push(`HTTP ${res.status} from ProLine: ${hint}`);
      break;
    }

    const { items, nextQuery } = extractProjectListPage(res.json, query);
    result.pagesFetched += 1;
    result.rowsSeen += items.length;

    for (const raw of items) {
      const flat = flattenRecord(raw);
      const prolineJobId = pickProlineProjectIdFromRecord(flat);
      if (!prolineJobId) {
        result.skippedNoId += 1;
        continue;
      }

      const leadNumber =
        pickStr(flat, ["project_number", "leadNumber", "lead_number"]) ?? null;
      const name = pickStr(flat, ["project_name", "name"]) ?? null;
      const statusStr = pickStr(flat, ["status", "stage"]) ?? "";
      const contractAmount = pickOptionalMoney(flat, [
        "approved_total",
        "contract_amount",
        "contractAmount",
        "contract",
        "total",
      ]);

      if (opts.dryRun) continue;

      const existing = await db.job.findFirst({ where: { prolineJobId } });
      const salespersonId = await resolveSalespersonId(db, flat, opts.userMapJson);

      if (!existing) {
        const jobNumber = await allocateNextJobNumber(opts.defaultYear);
        const contract = new Prisma.Decimal((contractAmount ?? 0).toFixed(2));
        const job = await db.job.create({
          data: {
            jobNumber,
            year: opts.defaultYear,
            leadNumber,
            name,
            contractAmount: contract,
            projectRevenue: contract,
            salespersonId,
            prolineJobId,
            status: normalizeStatus(statusStr),
            sourceSheet: "proline_api",
          },
        });
        await db.jobEvent.create({
          data: {
            jobId: job.id,
            type: "PROLINE_API_SYNC_CREATE",
            source: "proline_api",
            payload: raw as object,
          },
        });
        await recalculateJobAndCommissions(job.id);
        result.created += 1;
        continue;
      }

      const data: Prisma.JobUpdateInput = {};
      if (name !== null) data.name = name;
      if (leadNumber !== null) data.leadNumber = leadNumber;
      if (contractAmount !== undefined) {
        const d = new Prisma.Decimal(contractAmount.toFixed(2));
        data.contractAmount = d;
        data.projectRevenue = d;
      }
      if (statusStr) data.status = normalizeStatus(statusStr);
      if (salespersonId) data.salesperson = { connect: { id: salespersonId } };

      await db.job.update({ where: { id: existing.id }, data });
      await db.jobEvent.create({
        data: {
          jobId: existing.id,
          type: "PROLINE_API_SYNC_UPDATE",
          source: "proline_api",
          payload: raw as object,
        },
      });
      await recalculateJobAndCommissions(existing.id);
      result.updated += 1;
    }

    if (!nextQuery || items.length === 0) break;
    query = nextQuery;
  }

  return result;
}

export async function probeProlineProjectsList(env?: ProlineApiEnv): Promise<{
  status: number;
  url: string;
  itemCount: number;
  sampleKeys: string[];
}> {
  const e = env ?? readProlineApiEnv();
  const res = await prolineApiGet(e, {});
  const { items } = extractProjectListPage(res.json, {});
  const first = items[0];
  const flat = flattenRecord(first);
  const sampleKeys = Object.keys(flat).slice(0, 40);
  return { status: res.status, url: res.url, itemCount: items.length, sampleKeys };
}
