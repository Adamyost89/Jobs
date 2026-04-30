import { z } from "zod";
import { parseProlineNameAliasMap, resolveProlineDisplayName } from "@/lib/proline-name-alias";

const legacyType = z.enum(["job.signed", "job.updated", "invoice", "payment"]);

/** ProLine UI labels (and common variants) → internal routing */
export type ProlineTriggerKind =
  | "project_created"
  | "project_created_or_updated"
  | "quote_sent_or_approved"
  | "invoice_sent_or_paid";

function normalizeTrigger(raw: string | undefined | null): ProlineTriggerKind | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/[_-]+/g, " ");
  if (s.includes("invoice") && (s.includes("sent") || s.includes("paid"))) {
    return "invoice_sent_or_paid";
  }
  if (s.includes("quote") && (s.includes("sent") || s.includes("approved"))) {
    return "quote_sent_or_approved";
  }
  if (s.includes("project") && s.includes("created") && s.includes("updated")) {
    return "project_created_or_updated";
  }
  if (s.includes("project") && s.includes("created")) {
    return "project_created";
  }
  return null;
}

export type NormalizedProlineEvent = {
  internalType: z.infer<typeof legacyType> | "job.upsert";
  prolineJobId: string;
  year?: number;
  leadNumber?: string | null;
  name?: string | null;
  contractAmount?: number;
  approvedDate?: string | null;
  approvedTotal?: number;
  quoteId?: string;
  quoteName?: string | null;
  shareLink?: string;
  amountPaid?: number;
  invoicedDelta?: number;
  invoiceId?: string;
  invoiceNumber?: string;
  status?: string;
  /** Pipeline stage for display; automation uses `status` only. */
  prolineStage?: string;
  paidInFull?: boolean;
  paidDate?: string | null;
  cost?: number;
  salespersonName?: string;
  raw: unknown;
};

function numberFromUnknown(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Shared with REST sync: resolve ProLine / Bubble project id from a flat object. */
export function pickProlineProjectIdFromRecord(body: Record<string, unknown>): string | null {
  const keys = ["prolineJobId", "projectId", "project_id", "prolineProjectId", "id", "_id"];
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** ProLine pipeline stage (distinct from lifecycle `status`); shown in-app when set. */
export function pickProlineStageFromRecord(body: Record<string, unknown>): string | undefined {
  const keys = ["stage", "pipeline_stage", "project_stage"];
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Map native ProLine project webhook fields into our canonical keys (when missing). */
function applyProlineNativeAliases(body: Record<string, unknown>): void {
  const pn = body.project_name;
  if ((body.name === undefined || body.name === null || body.name === "") && typeof pn === "string" && pn.trim()) {
    body.name = pn.trim();
  }

  const pnum = body.project_number;
  if (body.leadNumber === undefined || body.leadNumber === null || body.leadNumber === "") {
    if (typeof pnum === "string" && pnum.trim()) body.leadNumber = pnum.trim();
    else if (typeof pnum === "number" && Number.isFinite(pnum)) body.leadNumber = String(pnum);
  }
  if (typeof body.leadNumber === "string") body.leadNumber = body.leadNumber.trim();

  if (body.contractAmount === undefined) {
    const at = numberFromUnknown(body.approved_total);
    const av = body.approved_value;
    const qv = body.quoted_value;
    if (at !== undefined) body.contractAmount = at;
    else if (typeof av === "number" && Number.isFinite(av)) body.contractAmount = av;
    else if (typeof qv === "number" && Number.isFinite(qv)) body.contractAmount = qv;
  }

  if (body.cost === undefined) {
    const c = numberFromUnknown(body.project_cost_actual);
    if (c !== undefined) body.cost = c;
  }

  const aid = body.assigned_to_id;
  if (
    (body.prolineUserId === undefined || String(body.prolineUserId).trim() === "") &&
    typeof aid === "string" &&
    aid.trim()
  ) {
    body.prolineUserId = aid.trim();
  }

  const an = body.assigned_to_name;
  if (
    (body.salespersonName === undefined || String(body.salespersonName).trim() === "") &&
    typeof an === "string" &&
    an.trim()
  ) {
    body.salespersonName = an.trim();
  }

  // Stage is stored separately from lifecycle `status` (never copy stage into `status`).

  if ((body.paidDate === undefined || body.paidDate === null || body.paidDate === "") && typeof body.paid_date === "string") {
    body.paidDate = body.paid_date;
  }
  if (
    (body.approvedDate === undefined || body.approvedDate === null || body.approvedDate === "") &&
    typeof body.approved_date === "string"
  ) {
    body.approvedDate = body.approved_date;
  }
  if (
    (body.approvedTotal === undefined || body.approvedTotal === null || body.approvedTotal === "") &&
    body.approved_total !== undefined
  ) {
    const n = numberFromUnknown(body.approved_total);
    if (n !== undefined) body.approvedTotal = n;
  }

  if (
    (body.quoteId === undefined || body.quoteId === null || body.quoteId === "") &&
    body.quote_id !== undefined
  ) {
    const id = String(body.quote_id).trim();
    if (id) body.quoteId = id;
  }
  if (
    (body.quoteName === undefined || body.quoteName === null || body.quoteName === "") &&
    typeof body.quote_name === "string"
  ) {
    const name = body.quote_name.trim();
    if (name) body.quoteName = name;
  }
  if (
    (body.shareLink === undefined || body.shareLink === null || body.shareLink === "") &&
    typeof body.share_link === "string"
  ) {
    const link = body.share_link.trim();
    if (link) body.shareLink = link;
  }

  if ((body.invoiceId === undefined || body.invoiceId === null || body.invoiceId === "") && body.invoice_id !== undefined) {
    const id = String(body.invoice_id).trim();
    if (id) body.invoiceId = id;
  }
  if (
    (body.invoiceNumber === undefined || body.invoiceNumber === null || body.invoiceNumber === "") &&
    body.invoice_number !== undefined
  ) {
    const n = String(body.invoice_number).trim();
    if (n) body.invoiceNumber = n;
  }

  // Invoice payloads usually carry total + amount_due/previous_payments.
  if (body.invoicedDelta === undefined && body.invoiceId !== undefined) {
    const total = numberFromUnknown(body.total);
    if (total !== undefined) body.invoicedDelta = total;
  }

  if (body.amountPaid === undefined) {
    const previousPayments = numberFromUnknown(body.previous_payments);
    const total = numberFromUnknown(body.total);
    const amountDue = numberFromUnknown(body.amount_due);
    if (previousPayments !== undefined) {
      body.amountPaid = previousPayments;
    } else if (total !== undefined && amountDue !== undefined) {
      body.amountPaid = Math.max(0, total - amountDue);
    }
  }

  if (body.paidInFull === undefined) {
    const amountDue = numberFromUnknown(body.amount_due);
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (amountDue !== undefined) {
      body.paidInFull = amountDue <= 0.0005;
    } else if (status === "paid" || status.includes("paid in full")) {
      body.paidInFull = true;
    }
  }
}

/** One-level unwrap when ProLine nests the project under a single key. */
function flattenProlineWebhookJson(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const o = json as Record<string, unknown>;
  const nested =
    o.project ??
    o.Project ??
    o.data ??
    o.record ??
    o.payload ??
    (typeof o.body === "object" && o.body && !Array.isArray(o.body) ? o.body : undefined);
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...o, ...(nested as Record<string, unknown>) };
  }
  return json;
}

/** Shared with REST sync: map ProLine user id → `Salesperson.name` via `PROLINE_USER_MAP` JSON. */
export function mapProlineUserIdToSalespersonName(
  prolineUserId: unknown,
  mapJson: string | undefined
): string | undefined {
  if (typeof prolineUserId !== "string" || !prolineUserId.trim()) return undefined;
  if (!mapJson) return undefined;
  try {
    const m = JSON.parse(mapJson) as Record<string, string>;
    return m[prolineUserId.trim()];
  } catch {
    return undefined;
  }
}

/** Bubble / ProLine often send numeric ids; accept string | number at parse time. */
const idish = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined ? undefined : String(v)));

const looseSchema = z
  .object({
    type: z.string().optional(),
    trigger: z.string().optional(),
    prolineJobId: idish,
    projectId: idish,
    project_id: idish,
    id: idish,
    prolineProjectId: idish,
    year: z.number().int().optional(),
    leadNumber: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    contractAmount: z.number().optional(),
    invoicedDelta: z.number().optional(),
    status: z.string().optional(),
    paidInFull: z.boolean().optional(),
    paidDate: z.string().optional().nullable(),
    salespersonName: z.string().optional(),
    prolineUserId: z.string().optional(),
  })
  .passthrough();

export function normalizeProlineWebhookBody(
  json: unknown,
  env: { PROLINE_USER_MAP?: string; PROLINE_NAME_ALIASES?: unknown }
): { ok: true; event: NormalizedProlineEvent } | { ok: false; error: z.ZodError | string } {
  const flattened = flattenProlineWebhookJson(json);
  const parsed = looseSchema.safeParse(flattened);
  if (!parsed.success) return { ok: false, error: parsed.error };

  const body: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };
  applyProlineNativeAliases(body);

  const prolineJobId = pickProlineProjectIdFromRecord(body);
  if (!prolineJobId) {
    return { ok: false, error: "Missing project id (prolineJobId / projectId / id)" };
  }

  const salespersonName = resolveProlineDisplayName({
    salespersonName: body.salespersonName,
    prolineUserId: body.prolineUserId,
    aliases: parseProlineNameAliasMap(env.PROLINE_NAME_ALIASES),
    userMapJson: env.PROLINE_USER_MAP,
  });

  const trig = normalizeTrigger(typeof body.trigger === "string" ? body.trigger : undefined);
  let internalType: NormalizedProlineEvent["internalType"];

  const typeField = typeof body.type === "string" ? body.type : undefined;
  const legacyParsed = typeField ? legacyType.safeParse(typeField) : null;

  if (legacyParsed?.success) {
    internalType = legacyParsed.data;
  } else if (trig === "project_created") {
    internalType = "job.signed";
  } else if (trig === "project_created_or_updated") {
    internalType = "job.upsert";
  } else if (trig === "quote_sent_or_approved") {
    internalType = "job.updated";
  } else if (trig === "invoice_sent_or_paid") {
    const paid = body.paidInFull === true;
    internalType = paid ? "payment" : "invoice";
  } else if (body.invoiceId !== undefined || body.invoiceNumber !== undefined) {
    const paid = body.paidInFull === true || (typeof body.paidDate === "string" && body.paidDate.trim() !== "");
    internalType = paid ? "payment" : "invoice";
  } else if (
    typeof body.project_id === "string" ||
    typeof body.project_name === "string" ||
    typeof body.project_number === "string" ||
    typeof body.project_number === "number"
  ) {
    // Native ProLine project body (e.g. type = "Remodel" is job category, not webhook routing)
    internalType = "job.upsert";
  } else {
    return {
      ok: false,
      error:
        'Provide legacy "type" (job.signed | job.updated | invoice | payment), a known "trigger", or a native ProLine project payload (project_id / project_name / project_number)',
    };
  }

  return {
    ok: true,
    event: {
      internalType,
      prolineJobId,
      year: typeof body.year === "number" ? body.year : undefined,
      leadNumber: (() => {
        const v = body.leadNumber;
        if (v == null || v === "") return null;
        const s = String(v).trim();
        return s || null;
      })(),
      name: (body.name as string | null | undefined) ?? null,
      contractAmount: typeof body.contractAmount === "number" ? body.contractAmount : undefined,
      approvedTotal: typeof body.approvedTotal === "number" ? body.approvedTotal : undefined,
      quoteId: typeof body.quoteId === "string" ? body.quoteId : undefined,
      quoteName: (body.quoteName as string | null | undefined) ?? null,
      shareLink: typeof body.shareLink === "string" ? body.shareLink : undefined,
      amountPaid: typeof body.amountPaid === "number" ? body.amountPaid : undefined,
      invoicedDelta: typeof body.invoicedDelta === "number" ? body.invoicedDelta : undefined,
      invoiceId: typeof body.invoiceId === "string" ? body.invoiceId : undefined,
      invoiceNumber: typeof body.invoiceNumber === "string" ? body.invoiceNumber : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      prolineStage: pickProlineStageFromRecord(body),
      paidInFull: typeof body.paidInFull === "boolean" ? body.paidInFull : undefined,
      paidDate: (body.paidDate as string | null | undefined) ?? null,
      approvedDate: (body.approvedDate as string | null | undefined) ?? null,
      cost: typeof body.cost === "number" ? body.cost : undefined,
      salespersonName,
      raw: json,
    },
  };
}
