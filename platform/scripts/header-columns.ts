/** Map commission-style sheet headers (Brett 2026, drew billed 2025, …) to column indices. */

function normCell(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findCol(headers: unknown[], matchers: ((h: string) => boolean)[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normCell(headers[i]);
    if (!h) continue;
    for (const m of matchers) {
      if (m(h)) return i;
    }
  }
  return -1;
}

export type CommissionStyleColumns = {
  job: number;
  name: number;
  paidFull: number;
  contract: number;
  changeOrders: number;
  invoiced: number;
  amountPaid: number;
  expectedCommission: number;
  commissionPaid: number;
  commissionOwed: number;
};

export function resolveCommissionStyleColumns(headers: unknown[]): CommissionStyleColumns | null {
  const job = findCol(headers, [
    (h) => h.includes("job") && h.includes("#"),
    (h) => h === "job number",
    (h) => h.startsWith("job#"),
    (h) => h.includes("billed") && h.includes("project"),
  ]);
  if (job < 0) return null;

  const name = findCol(headers, [(h) => h === "name" || h === "customer" || h === "customer name"]);
  const paidFull = findCol(headers, [(h) => h.includes("paid") && h.includes("full")]);
  const contract = findCol(headers, [(h) => h === "contract" || h === "contract amount"]);
  const changeOrders = findCol(headers, [(h) => h.includes("change") && h.includes("order")]);
  const invoiced = findCol(headers, [(h) => h === "invoiced" || h.includes("invoiced total")]);
  const amountPaid = findCol(headers, [
    (h) => h.includes("sum of") && h.includes("amount") && h.includes("paid"),
    (h) => (h.includes("amount paid") || h === "paid amount") && !h.includes("commission"),
  ]);
  const expectedCommission = findCol(headers, [(h) => h.includes("expected") && h.includes("commission")]);
  const commissionPaid = findCol(headers, [
    (h) => h === "commission paid",
    (h) => h.includes("commission") && h.includes("paid") && !h.includes("expected") && !h.includes("owed"),
  ]);
  const commissionOwed = findCol(headers, [(h) => h.includes("commission") && h.includes("owed")]);

  return {
    job,
    name: name >= 0 ? name : -1,
    paidFull: paidFull >= 0 ? paidFull : -1,
    contract: contract >= 0 ? contract : -1,
    changeOrders: changeOrders >= 0 ? changeOrders : -1,
    invoiced: invoiced >= 0 ? invoiced : -1,
    amountPaid: amountPaid >= 0 ? amountPaid : -1,
    expectedCommission: expectedCommission >= 0 ? expectedCommission : -1,
    commissionPaid: commissionPaid >= 0 ? commissionPaid : -1,
    commissionOwed: commissionOwed >= 0 ? commissionOwed : -1,
  };
}

export function cellNum(row: unknown[], col: number): number {
  if (col < 0) return 0;
  return num(row[col]);
}

export function cellStr(row: unknown[], col: number): string | null {
  if (col < 0) return null;
  const v = row[col];
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim() || null;
}

export function num(v: unknown): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const x = parseFloat(v.replace(/[^0-9.-]+/g, ""));
    return isNaN(x) ? 0 : x;
  }
  return 0;
}

export function boolish(v: unknown): boolean {
  return v === true || v === "TRUE" || v === "true" || String(v).toLowerCase() === "yes";
}
