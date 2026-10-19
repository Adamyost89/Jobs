/**
 * Flexible field pickers for Partner API list rows.
 * ProLine's OpenAPI samples leave `results[]` opaque; these tolerate common naming variants.
 */

export type NormalizedPartnerPayment = {
  paymentId: string;
  projectId: string | null;
  /** Project / lead number when Partner embeds it (fallback match to Job.leadNumber). */
  projectNumber: string | null;
  invoiceId: string | null;
  /** Prefer net (fee-exclusive) when available. */
  amount: number;
  grossAmount: number | null;
  status: string | null;
  method: string | null;
  createdAt: Date | null;
  paidAt: Date | null;
  raw: Record<string, unknown>;
};

export type NormalizedPartnerInvoice = {
  invoiceId: string;
  projectId: string | null;
  total: number | null;
  balance: number | null;
  amountPaid: number | null;
  status: string | null;
  createdAt: Date | null;
  paidAt: Date | null;
  raw: Record<string, unknown>;
};

export type NormalizedPartnerProject = {
  projectId: string;
  externalId: string | null;
  name: string | null;
  projectNumber: string | null;
  stageName: string | null;
  stageId: string | null;
  status: string | null;
  location: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  revenue: number | null;
  budget: number | null;
  createdAt: Date | null;
  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickStr(r: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickNum(r: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[$,]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickDate(r: Record<string, unknown>, keys: string[]): Date | null {
  const s = pickStr(r, keys);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nestedId(r: Record<string, unknown>, objectKeys: string[], idKeys: string[]): string | null {
  for (const ok of objectKeys) {
    const v = r[ok];
    // Partner sometimes sends the related id as a bare string/number.
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    const nested = asRecord(v);
    if (!nested) {
      if (Array.isArray(v) && v.length > 0) {
        const first = asRecord(v[0]);
        if (first) {
          const id = pickStr(first, idKeys);
          if (id) return id;
        } else if (typeof v[0] === "string" && v[0].trim()) {
          return v[0].trim();
        }
      }
      continue;
    }
    const id = pickStr(nested, idKeys);
    if (id) return id;
  }
  return null;
}

function pickProjectId(r: Record<string, unknown>): string | null {
  return (
    pickStr(r, [
      "project_id",
      "projectId",
      "proline_project_id",
      "prolineProjectId",
      "Project",
      "project_unique_id",
    ]) ??
    nestedId(r, ["project", "Project", "projects"], ["id", "project_id", "projectId", "_id", "unique_id"])
  );
}

function pickProjectNumber(r: Record<string, unknown>): string | null {
  const direct = pickStr(r, [
    "project_number",
    "projectNumber",
    "lead_number",
    "leadNumber",
    "project_num",
  ]);
  if (direct) return direct;
  for (const ok of ["project", "Project"]) {
    const nested = asRecord(r[ok]);
    if (!nested) continue;
    const n = pickStr(nested, ["project_number", "projectNumber", "number", "lead_number", "leadNumber", "name"]);
    if (n) return n;
  }
  return null;
}

function sampleKeys(r: Record<string, unknown>, max = 40): string[] {
  return Object.keys(r).slice(0, max);
}

/** Sanitize a row for logging/probe: keep keys + scalar sample, drop huge nested blobs. */
export function sanitizePartnerRowSample(row: unknown): Record<string, unknown> {
  const r = asRecord(row);
  if (!r) return { _type: typeof row };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `[array:${v.length}]`;
    } else if (typeof v === "object") {
      const nested = asRecord(v);
      out[k] = nested ? { _keys: sampleKeys(nested, 12) } : "[object]";
    }
  }
  return out;
}

export function normalizePartnerPayment(row: unknown): NormalizedPartnerPayment | null {
  const r = asRecord(row);
  if (!r) return null;
  const paymentId =
    pickStr(r, ["id", "payment_id", "paymentId", "_id"]) ??
    nestedId(r, ["payment"], ["id", "payment_id"]);
  if (!paymentId) return null;

  const projectId = pickProjectId(r);
  const projectNumber = pickProjectNumber(r);

  const invoiceId =
    pickStr(r, ["invoice_id", "invoiceId"]) ??
    nestedId(r, ["invoice", "Invoice"], ["id", "invoice_id", "invoiceId", "_id"]);

  const net =
    pickNum(r, [
      "net_revenue",
      "net_amount",
      "netAmount",
      "amount_net",
      "cents_net_revenue",
    ]) ?? null;
  // cents_net_revenue may already be dollars if not in cents — only divide when key says cents and value looks large
  let netAmount = net;
  if (netAmount != null && "cents_net_revenue" in r && Math.abs(netAmount) >= 1000) {
    const rawCents = pickNum(r, ["cents_net_revenue"]);
    if (rawCents != null && !("net_revenue" in r)) netAmount = rawCents / 100;
  }

  const gross = pickNum(r, [
    "amount",
    "total_amount",
    "payment_amount",
    "gross_revenue",
    "gross_amount",
    "total",
  ]);
  const fee = pickNum(r, ["merchant_fee", "merchant_fees", "fee"]) ?? 0;
  const derivedNet = gross != null ? Math.max(0, gross - Math.max(0, fee)) : null;
  const amount = Math.max(0, netAmount ?? derivedNet ?? gross ?? 0);

  return {
    paymentId,
    projectId,
    projectNumber,
    invoiceId,
    amount,
    grossAmount: gross,
    status: pickStr(r, ["status", "payment_status", "state"]),
    method: pickStr(r, ["method", "payment_method", "type"]),
    createdAt: pickDate(r, ["created_at", "createdAt", "date_created", "payment_date", "paid_at", "paidAt"]),
    paidAt: pickDate(r, ["paid_at", "paidAt", "payment_date", "paid_date", "date"]),
    raw: r,
  };
}

export function normalizePartnerInvoice(row: unknown): NormalizedPartnerInvoice | null {
  const r = asRecord(row);
  if (!r) return null;
  const invoiceId =
    pickStr(r, ["id", "invoice_id", "invoiceId", "_id"]) ??
    nestedId(r, ["invoice"], ["id", "invoice_id"]);
  if (!invoiceId) return null;

  const total = pickNum(r, ["total", "invoice_total", "invoiced_total", "amount", "gross_revenue"]);
  const balance = pickNum(r, ["balance", "balance_due", "amount_due", "amountDue"]);
  let amountPaid = pickNum(r, ["amount_paid", "amountPaid", "paid_amount", "payments_received", "net_revenue"]);
  if (amountPaid == null && total != null && balance != null) {
    amountPaid = Math.max(0, total - balance);
  }

  return {
    invoiceId,
    projectId: pickProjectId(r),
    total,
    balance,
    amountPaid,
    status: pickStr(r, ["status", "invoice_status", "state"]),
    createdAt: pickDate(r, ["created_at", "createdAt", "date_created"]),
    paidAt: pickDate(r, ["paid_at", "paidAt", "paid_date", "paidDate"]),
    raw: r,
  };
}

export function normalizePartnerProject(row: unknown): NormalizedPartnerProject | null {
  const r = asRecord(row);
  if (!r) return null;
  const projectId =
    pickStr(r, ["id", "project_id", "projectId", "_id"]) ??
    nestedId(r, ["project"], ["id", "project_id"]);
  if (!projectId) return null;

  const stageObj = asRecord(r.stage) ?? asRecord(r.project_stage);
  const assigneeObj =
    asRecord(r.assignee) ?? asRecord(r.assigned) ?? asRecord(r.sales_person) ?? asRecord(r.salesperson);

  return {
    projectId,
    externalId: pickStr(r, ["external_id", "externalId", "project_external_id"]),
    name: pickStr(r, ["name", "project_name", "projectName", "title"]),
    projectNumber: pickStr(r, ["project_number", "projectNumber", "number", "lead_number", "leadNumber"]),
    stageName:
      pickStr(r, ["stage", "stage_name", "project_stage", "prolineStage"]) ??
      (stageObj ? pickStr(stageObj, ["name", "label", "title"]) : null),
    stageId: pickStr(r, ["stage_id", "stageId", "project_stage_id"]) ?? (stageObj ? pickStr(stageObj, ["id"]) : null),
    status: pickStr(r, ["status", "project_status", "lifecycle_status"]),
    location:
      pickStr(r, ["location", "location_name", "office", "branch"]) ??
      nestedId(r, ["location"], ["name", "label"]) ??
      (asRecord(r.location) ? pickStr(asRecord(r.location)!, ["name", "label", "id"]) : null),
    assigneeName:
      pickStr(r, ["assignee_name", "salesperson", "salesperson_name", "assigned_name"]) ??
      (assigneeObj ? pickStr(assigneeObj, ["name", "display_name", "full_name", "email"]) : null),
    assigneeId:
      pickStr(r, ["assignee", "assignee_id", "project_assign", "user_id"]) ??
      (assigneeObj ? pickStr(assigneeObj, ["id", "user_id"]) : null),
    revenue: pickNum(r, ["revenue", "expected_revenue", "approved_value", "approved_total", "budget"]),
    budget: pickNum(r, ["budget", "project_budget", "contract_amount"]),
    createdAt: pickDate(r, ["created_at", "createdAt", "date_created"]),
    raw: r,
  };
}
