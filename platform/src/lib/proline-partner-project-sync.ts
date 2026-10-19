import { type PrismaClient, Prisma } from "@prisma/client";
import {
  hasProlinePartnerKeys,
  prolinePartnerListAll,
  readProlinePartnerEnv,
} from "@/lib/proline-partner-client";
import { normalizePartnerProject } from "@/lib/proline-partner-normalize";
import { resolveOrCreateSalespersonByName } from "@/lib/salesperson-name";
import { normalizeStatus } from "@/lib/status";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

export type PartnerProjectSyncOpts = {
  apply: boolean;
  maxPages?: number;
  createdAfter?: string | null;
  createdBefore?: string | null;
  /** Prefer Partner money fields when they disagree with local. Default true. */
  preferPartnerMoney?: boolean;
};

export type PartnerProjectSyncResult = {
  projectsSeen: number;
  matchedJobs: number;
  updated: number;
  skipped: number;
  errors: string[];
  partnerConfigured: boolean;
  samples: { jobNumber: string; fields: string[] }[];
};

function approxEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 0.005): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

/**
 * Sync stage / location / assignee / contract figures from Partner `/v1/list/projects`
 * onto existing jobs matched by `prolineJobId`. Does not create jobs.
 */
export async function syncProjectsFromPartnerApi(
  db: PrismaClient,
  opts: PartnerProjectSyncOpts
): Promise<PartnerProjectSyncResult> {
  const result: PartnerProjectSyncResult = {
    projectsSeen: 0,
    matchedJobs: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    partnerConfigured: hasProlinePartnerKeys(),
    samples: [],
  };
  if (!result.partnerConfigured) {
    result.errors.push("Partner API keys not configured (PROLINE_PARTNER_KEY + PROLINE_COMPANY_KEY).");
    return result;
  }

  const env = readProlinePartnerEnv();
  const preferMoney = opts.preferPartnerMoney !== false;
  const normalized: NonNullable<ReturnType<typeof normalizePartnerProject>>[] = [];

  try {
    for await (const page of prolinePartnerListAll(env, "/v1/list/projects", {
      maxPages: opts.maxPages ?? 100,
      createdAfter: opts.createdAfter,
      createdBefore: opts.createdBefore,
    })) {
      for (const row of page.results) {
        result.projectsSeen += 1;
        const p = normalizePartnerProject(row);
        if (p) normalized.push(p);
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }

  for (const p of normalized) {
    const job = await db.job.findFirst({
      where: { prolineJobId: p.projectId },
      select: {
        id: true,
        jobNumber: true,
        name: true,
        prolineStage: true,
        location: true,
        status: true,
        contractAmount: true,
        projectRevenue: true,
        salespersonId: true,
      },
    });
    if (!job) {
      result.skipped += 1;
      continue;
    }
    result.matchedJobs += 1;

    const changed: string[] = [];
    const data: Record<string, unknown> = {};

    if (p.stageName && p.stageName !== job.prolineStage) {
      data.prolineStage = p.stageName;
      changed.push("prolineStage");
    }
    if (p.location && p.location !== job.location) {
      data.location = p.location;
      changed.push("location");
    }
    if (p.status) {
      const next = normalizeStatus(p.status);
      if (next !== "UNKNOWN" && next !== job.status) {
        data.status = next;
        changed.push("status");
      }
    }
    if (p.name && !job.name) {
      data.name = p.name;
      changed.push("name");
    }

    const contract = p.revenue ?? p.budget;
    if (preferMoney && contract != null && contract > 0 && !approxEqual(job.contractAmount.toNumber(), contract)) {
      data.contractAmount = new Prisma.Decimal(contract.toFixed(2));
      data.projectRevenue = new Prisma.Decimal(contract.toFixed(2));
      changed.push("contractAmount");
    }

    if (p.assigneeName) {
      const sp = await resolveOrCreateSalespersonByName(db, p.assigneeName, { preferFirstToken: false });
      if (sp?.id && sp.id !== job.salespersonId) {
        data.salesperson = { connect: { id: sp.id } };
        changed.push("salesperson");
      }
    }

    if (!changed.length) continue;
    if (result.samples.length < 50) {
      result.samples.push({ jobNumber: job.jobNumber, fields: changed });
    }
    if (!opts.apply) continue;

    await db.job.update({ where: { id: job.id }, data });
    await db.jobEvent.create({
      data: {
        jobId: job.id,
        type: "PROLINE_PARTNER_PROJECT_SYNC",
        source: "proline_partner",
        payload: { changed, projectId: p.projectId },
      },
    });
    await recalculateJobAndCommissions(job.id, {
      forceCommissionRecalc: changed.includes("contractAmount"),
      forceCommissionRecalcReason: "proline.partner.project_sync",
    });
    result.updated += 1;
  }

  return result;
}
