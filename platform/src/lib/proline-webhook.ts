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

/**
 * Native ProLine "Quote Sent or Approved" bodies include project_id/name/number plus quote_* fields.
 * Those must route as quote events (create job on approve), not as generic project upsert —
 * otherwise status "Fully Signed" fails the Open/Won/Complete/Closed create gate.
 */
export function looksLikeProlineQuoteWebhook(body: Record<string, unknown>): boolean {
  if (body.quote_id !== undefined || body.quoteId !== undefined) return true;
  if (body.quote_name !== undefined || body.quoteName !== undefined) return true;
  if (typeof body.share_link === "string" && /\/quotes\//i.test(body.share_link)) return true;
  if (typeof body.shareLink === "string" && /\/quotes\//i.test(body.shareLink)) return true;
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  const signedLike =
    /\bfully\s*signed\b/.test(status) ||
    status === "signed" ||
    status === "approved" ||
    status === "quote approved";
  if (
    signedLike &&
    (body.approved_date !== undefined ||
      body.approvedDate !== undefined ||
      body.approved_total !== undefined ||
      body.approvedTotal !== undefined)
  ) {
    return true;
  }
  return false;
}

/** Native ProLine payment webhooks carry a payment id + per-payment amounts (not project totals). */
export function pickProlinePaymentIdFromRecord(body: Record<string, unknown>): string | null {
  for (const k of ["payment_id", "paymentId"]) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function looksLikeProlinePaymentWebhook(body: Record<string, unknown>): boolean {
  return pickProlinePaymentIdFromRecord(body) != null;
}

/**
 * Per-payment net amount to add to job `amountPaid`.
 * Prefer `net_revenue` / cents net; otherwise total minus merchant fee.
 */
export function pickProlinePaymentDelta(body: Record<string, unknown>): number | undefined {
  const net = numberFromUnknown(body.net_revenue);
  if (net !== undefined) return Math.max(0, net);

  const centsNet = numberFromUnknown(body.cents_net_revenue);
  if (centsNet !== undefined) return Math.max(0, centsNet / 100);

  const total =
    numberFromUnknown(body.total_amount) ??
    numberFromUnknown(body.payment_amount) ??
    numberFromUnknown(body.amount);
  const fee = numberFromUnknown(body.merchant_fee) ?? numberFromUnknown(body.merchant_fees) ?? 0;
  if (total !== undefined) return Math.max(0, total - Math.max(0, fee));

  const centsTotal = numberFromUnknown(body.cents_total_amount);
  if (centsTotal !== undefined) {
    const centsFee = numberFromUnknown(body.cents_merchant_fee) ?? 0;
    return Math.max(0, (centsTotal - Math.max(0, centsFee)) / 100);
  }
  return undefined;
}

export type NormalizedProlineEvent = {
  internalType: z.infer<typeof legacyType> | "job.upsert";
  prolineJobId: string;
  year?: number;
  leadNumber?: string | null;
  name?: string | null;
 contractAmount?: number;
  /** Native ProLine `approved_value` (authoritative contract $ when present). */
  approvedValue?: number;
  approvedDate?: string | null;
  approvedTotal?: number;
  quoteId?: string;
  quoteName?: string | null;
  shareLink?: string;
  amountPaid?: number;
  /**
   * Cumulative paid revenue for commissions (net of card/merchant fees when ProLine
   * provides `net_revenue` or `merchant_fees`).
   */
  grossRevenue?: number;
  /** True when paid amount came from ProLine net (or gross minus merchant fees). */
  authoritativeNetPaid?: boolean;
  /**
   * Per-payment increment from a payment webhook (`payment_id` present).
   * Applied as amountPaid += paymentDelta (with payment_id dedupe).
   */
  paymentDelta?: number;
  paymentId?: string;
  paymentNumber?: string;
  invoicedDelta?: number;
  invoiceId?: string;
  invoiceNumber?: string;
  status?: string;
  /** Pipeline stage for display; automation uses `status` only. */
  prolineStage?: string;
  /** ProLine office/branch location (e.g. "Troy"). */
  location?: string | null;
  paidInFull?: boolean;
  paidDate?: string | null;
  cost?: number;
  costingComplete?: boolean;
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

function boolFromUnknown(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (!s) return undefined;
    if (["true", "1", "yes", "y", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "off"].includes(s)) return false;
  }
  return undefined;
}

function isInvoicePaidLikeLabel(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s === "invoice paid" || s === "paid closed" || s === "paid in full";
}

/**
 * Cumulative paid revenue from native ProLine project payloads, net of card fees.
 * Prefer `net_revenue`; otherwise strip `merchant_fees` from gross when present.
 */
function pickMerchantFee(body: Record<string, unknown>): number | undefined {
  return numberFromUnknown(body.merchant_fees) ?? numberFromUnknown(body.merchant_fee);
}

export function pickProlineRecognizedPaidRevenue(body: Record<string, unknown>): number | undefined {
  // Per-payment webhooks: net_revenue is this payment only — not project cumulative paid.
  if (looksLikeProlinePaymentWebhook(body)) return undefined;

  const net = numberFromUnknown(body.net_revenue);
  if (net !== undefined) return Math.max(0, net);

  const gross = numberFromUnknown(body.gross_revenue);
  const fees = pickMerchantFee(body);
  if (gross !== undefined && fees !== undefined) {
    return Math.max(0, gross - fees);
  }

  const paymentsReceived = numberFromUnknown(body.payments_received);
  if (paymentsReceived !== undefined) {
    if (fees !== undefined) return Math.max(0, paymentsReceived - fees);
    return Math.max(0, paymentsReceived);
  }

  if (gross !== undefined) return Math.max(0, gross);
  return undefined;
}

/** True when ProLine sent an authoritative net paid figure (not fee-inclusive gross alone). */
export function hasProlineAuthoritativeNetPaid(body: Record<string, unknown>): boolean {
  if (looksLikeProlinePaymentWebhook(body)) return false;
  if (numberFromUnknown(body.net_revenue) !== undefined) return true;
  const fees = pickMerchantFee(body);
  if (fees === undefined || fees <= 0.0005) return false;
  return (
    numberFromUnknown(body.gross_revenue) !== undefined ||
    numberFromUnknown(body.payments_received) !== undefined
  );
}

function resolveAmountPaidFromBody(body: Record<string, unknown>): number | undefined {
  const recognized = pickProlineRecognizedPaidRevenue(body);
  // When ProLine provides net (or gross minus fees), that is the commission basis —
  // do not Math.max with fee-inclusive gross from other fields.
  if (recognized !== undefined && hasProlineAuthoritativeNetPaid(body)) {
    return recognized;
  }

  const candidates: number[] = [];
  const explicit = numberFromUnknown(body.amountPaid);
  if (explicit !== undefined) candidates.push(explicit);

  const previousPayments = numberFromUnknown(body.previous_payments);
  if (previousPayments !== undefined) candidates.push(previousPayments);

  const total = numberFromUnknown(body.total);
  const amountDue = numberFromUnknown(body.amount_due);
  const balance = numberFromUnknown(body.balance);
  // Prefer `balance` when present: ProLine sometimes leaves `amount_due` stale after card pay.
  const dueForPaidCalc = balance !== undefined ? balance : amountDue;
  if (total !== undefined && dueForPaidCalc !== undefined) {
    candidates.push(Math.max(0, total - dueForPaidCalc));
  }

  if (recognized !== undefined) candidates.push(recognized);

  if (!candidates.length) return undefined;
  return Math.max(...candidates);
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

/** ProLine office/branch location (distinct from contact `city`). */
export function pickProlineLocationFromRecord(body: Record<string, unknown>): string | undefined {
  const v = body.location;
  if (typeof v === "string" && v.trim()) return v.trim();
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

  // ProLine native payloads: `approved_value` is the authoritative contract amount when present.
  const approvedValueNum = numberFromUnknown(body.approved_value);
  if (approvedValueNum !== undefined) {
    body.contractAmount = approvedValueNum;
  } else if (body.contractAmount === undefined) {
    const at = numberFromUnknown(body.approved_total);
    const qv = numberFromUnknown(body.quoted_value);
    if (at !== undefined) body.contractAmount = at;
    else if (qv !== undefined) body.contractAmount = qv;
  }

  if (body.cost === undefined) {
    const c = numberFromUnknown(body.project_cost_actual);
    if (c !== undefined) body.cost = c;
  }

  if (body.costingComplete === undefined) {
    const direct =
      boolFromUnknown(body.costingComplete) ??
      boolFromUnknown(body.cost_complete) ??
      boolFromUnknown(body.project_cost_complete) ??
      boolFromUnknown(body.project_costing_complete);
    if (direct !== undefined) {
      body.costingComplete = direct;
    } else if (typeof body.webhook_content === "string") {
      const m = body.webhook_content.match(/cost\s*complete\s*=\s*(true|false|1|0|yes|no)/i);
      if (m?.[1]) {
        const parsed = boolFromUnknown(m[1]);
        if (parsed !== undefined) body.costingComplete = parsed;
      }
    } else {
      // Some ProLine/Zap payloads encode cost-complete as project_cost_2=1.
      const cost2 = numberFromUnknown(body.project_cost_2);
      if (cost2 === 1) body.costingComplete = true;
    }
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
  if (
    (body.status === undefined || body.status === null || String(body.status).trim() === "") &&
    typeof body.project_status === "string" &&
    body.project_status.trim()
  ) {
    body.status = body.project_status.trim();
  }

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

  const isPaymentEvent = looksLikeProlinePaymentWebhook(body);

  // Invoice payloads usually carry total + amount_due/previous_payments.
  // Skip for per-payment webhooks — `total`/`total_amount` is the payment, not an invoice delta.
  if (!isPaymentEvent && body.invoicedDelta === undefined && body.invoiceId !== undefined) {
    const total = numberFromUnknown(body.total);
    if (total !== undefined) body.invoicedDelta = total;
  }

  if (isPaymentEvent) {
    const delta = pickProlinePaymentDelta(body);
    if (delta !== undefined) body.paymentDelta = delta;
    // Do not treat per-payment net_revenue as cumulative job amountPaid.
  } else {
    const resolved = resolveAmountPaidFromBody(body);
    if (resolved !== undefined) {
      // ProLine project revenue is cumulative; prefer net (job amount) over card gross.
      body.amountPaid = resolved;
    }
  }

  if (body.paidInFull === undefined) {
    const explicitPaid =
      boolFromUnknown(body.paid_in_full) ??
      boolFromUnknown(body.paidInFull) ??
      boolFromUnknown(body.is_paid) ??
      boolFromUnknown(body.payment_complete);
    // Prefer `balance` — ProLine invoice webhooks can keep `amount_due` at the invoice
    // total after a card payment while `balance` correctly goes to 0.
    const balance = numberFromUnknown(body.balance) ?? numberFromUnknown(body.balance_due);
    const amountDue = numberFromUnknown(body.amount_due);
    const remainingDue = balance !== undefined ? balance : amountDue;
    // payment_status "Complete" means this payment finished — not that the job is paid in full.
    const statusCandidates = (isPaymentEvent
      ? [body.status, body.invoice_status]
      : [body.status, body.invoice_status, body.payment_status]
    )
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim().toLowerCase());
    const stagePaidLike = isInvoicePaidLikeLabel(body.stage);
    const hasPaidDate = typeof body.paidDate === "string" && body.paidDate.trim() !== "";
    if (explicitPaid !== undefined) {
      body.paidInFull = explicitPaid;
    } else if (!isPaymentEvent && hasPaidDate) {
      body.paidInFull = true;
    } else if (remainingDue !== undefined) {
      body.paidInFull = remainingDue <= 0.0005;
    } else if (stagePaidLike) {
      body.paidInFull = true;
    } else if (
      statusCandidates.some(
        (s) =>
          s === "paid" ||
          s === "complete" ||
          s.includes("paid in full") ||
          s === "paid closed"
      )
    ) {
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
    // ProLine often sends null for unused category/type fields — treat as absent.
    type: z.string().nullish(),
    trigger: z.string().nullish(),
    prolineJobId: idish,
    projectId: idish,
    project_id: idish,
    id: idish,
    prolineProjectId: idish,
    year: z.number().int().nullish(),
    leadNumber: z.string().nullish(),
    name: z.string().nullish(),
    contractAmount: z.number().nullish(),
    invoicedDelta: z.number().nullish(),
    status: z.string().nullish(),
    paidInFull: z.boolean().nullish(),
    paidDate: z.string().nullish(),
    salespersonName: z.string().nullish(),
    prolineUserId: z.string().nullish(),
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
  } else if (looksLikeProlinePaymentWebhook(body)) {
    // Prefer payment routing before invoice_id heuristics — payment payloads often include invoice_*.
    internalType = "payment";
  } else if (trig === "project_created") {
    internalType = "job.signed";
  } else if (trig === "project_created_or_updated") {
    internalType = "job.upsert";
  } else if (trig === "quote_sent_or_approved") {
    internalType = "job.updated";
  } else if (looksLikeProlineQuoteWebhook(body)) {
    // Quote approve/sign payloads often include project_id; still treat as quote → job.updated
    // so the handler can create a job when approved_date is present.
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
      approvedValue: numberFromUnknown(body.approved_value),
      contractAmount: numberFromUnknown(body.contractAmount),
      approvedTotal: numberFromUnknown(body.approvedTotal),
      quoteId: typeof body.quoteId === "string" ? body.quoteId : undefined,
      quoteName: (body.quoteName as string | null | undefined) ?? null,
      shareLink: typeof body.shareLink === "string" ? body.shareLink : undefined,
      amountPaid: typeof body.amountPaid === "number" ? body.amountPaid : undefined,
      grossRevenue: pickProlineRecognizedPaidRevenue(body),
      authoritativeNetPaid: hasProlineAuthoritativeNetPaid(body),
      paymentDelta: typeof body.paymentDelta === "number" ? body.paymentDelta : undefined,
      paymentId: pickProlinePaymentIdFromRecord(body) ?? undefined,
      paymentNumber: (() => {
        const v = body.payment_number ?? body.paymentNumber;
        if (v === undefined || v === null) return undefined;
        const s = String(v).trim();
        return s || undefined;
      })(),
      invoicedDelta: typeof body.invoicedDelta === "number" ? body.invoicedDelta : undefined,
      invoiceId: typeof body.invoiceId === "string" ? body.invoiceId : undefined,
      invoiceNumber: typeof body.invoiceNumber === "string" ? body.invoiceNumber : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      prolineStage: pickProlineStageFromRecord(body),
      location: pickProlineLocationFromRecord(body),
      paidInFull: typeof body.paidInFull === "boolean" ? body.paidInFull : undefined,
      paidDate: (body.paidDate as string | null | undefined) ?? null,
      approvedDate: (body.approvedDate as string | null | undefined) ?? null,
      cost: typeof body.cost === "number" ? body.cost : undefined,
      costingComplete: typeof body.costingComplete === "boolean" ? body.costingComplete : undefined,
      salespersonName,
      raw: json,
    },
  };
}
