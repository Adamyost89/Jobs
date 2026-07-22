"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseMoneyInputString } from "@/lib/currency";

export function ManualJobCreateForm({
  defaultYear,
  salespersonNames,
}: {
  defaultYear: number;
  salespersonNames: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [year, setYear] = useState(String(defaultYear));
  const [name, setName] = useState("");
  const [leadNumber, setLeadNumber] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [salespersonName, setSalespersonName] = useState("");

  async function createJob() {
    if (busy) return;
    const yearNum = Number.parseInt(year, 10);
    if (!Number.isFinite(yearNum) || yearNum < 2020 || yearNum > 2035) {
      setMsg("Year must be between 2020 and 2035.");
      return;
    }
    let contract: number | undefined;
    if (contractAmount.trim()) {
      const parsed = parseMoneyInputString(contractAmount);
      if (parsed === null) {
        setMsg("Contract amount must be a valid number.");
        return;
      }
      contract = parsed;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: yearNum,
          name: name.trim() || null,
          leadNumber: leadNumber.trim() || null,
          contractAmount: contract,
          salespersonName: salespersonName.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        job?: { jobNumber?: string };
      };
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Could not create job.");
        return;
      }
      setMsg(`Created job ${j.job?.jobNumber ?? ""}. Edit the row to set payments/invoices.`);
      setName("");
      setLeadNumber("");
      setContractAmount("");
      setSalespersonName("");
      setOpen(false);
      router.refresh();
    } catch {
      setMsg("Network error creating job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.65rem" }}>
      <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Manual job entry</h2>
        <button type="button" className="btn secondary" onClick={() => setOpen((v) => !v)} disabled={busy}>
          {open ? "Close" : "Add job"}
        </button>
      </div>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        Use while ProLine webhooks are down. After create, open the job&apos;s Edit row to set amount paid, paid date,
        paid in full, and invoiced total.
      </p>
      {open ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.65rem 0.8rem",
          }}
        >
          <label>
            Year
            <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label>
            Customer name
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer"
            />
          </label>
          <label>
            Lead #
            <input
              className="input"
              value={leadNumber}
              onChange={(e) => setLeadNumber(e.target.value)}
              placeholder="ProLine lead / project #"
            />
          </label>
          <label>
            Contract amount
            <input
              className="input"
              value={contractAmount}
              onChange={(e) => setContractAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            Salesperson
            <input
              className="input"
              list="manual-job-salesperson-options"
              value={salespersonName}
              onChange={(e) => setSalespersonName(e.target.value)}
              placeholder="Optional"
            />
            <datalist id="manual-job-salesperson-options">
              {salespersonNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button type="button" className="btn" onClick={() => void createJob()} disabled={busy}>
              {busy ? "Creating…" : "Create job"}
            </button>
          </div>
        </div>
      ) : null}
      {msg ? <p style={{ margin: 0, fontSize: "0.86rem", color: "var(--muted)" }}>{msg}</p> : null}
    </div>
  );
}
