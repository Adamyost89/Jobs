# Workbook inventory (canonical)

The main Excel exports (`commissions.xlsx`, `job numbering.xlsx`, plus any `*billed*projects*.xlsx` trackers) may or may not be present in the repo at implementation time. This document is the **authoritative tab/column inventory** derived from [Job Numbering Sheet/Apps Script.gs](../Job%20Numbering%20Sheet/Apps%20Script.gs), [Commission Sheet/Apps Script.gs](../Commission%20Sheet/Apps%20Script.gs), [SHEETS_TO_CREATE.md](../SHEETS_TO_CREATE.md), and Zapier scripts under [Zapier/](../Zapier/).

Re-run tab discovery when files are added:

```bash
cd platform && npm install && npm run inventory
```

Place workbooks at repo root (or set `WORKBOOK_DIR`). **File names do not have to match exactly** — the inventory/import scripts accept common variants, for example `Job Numbering(1).xlsx`, `Commissions.xlsx`, and `Drew Billed Projects.xlsx` (see `platform/scripts/workbook-paths.ts`).

---

## job numbering.xlsx (maps to Google “Job Numbering” spreadsheet)

| Tab (sheet) | Purpose | Row key | Notes |
|-------------|---------|---------|-------|
| `2024` | Historical jobs | `B` Job Number | Zap/revenue uses K; AC = paid date |
| `2025` | Active year jobs | `B` Job Number | Commission sync from I,K; coloring F,O,S,U |
| `2026` | Active year jobs | `B` Job Number | Same + `AA` Drew participation |
| `2025 Brett`, `2025 Drew`, … `2026 Mike` | Per-salesperson commission views | `B` Job Number | K = basis/owed display; L = paid checkbox |
| `Commission Data` | Central commission rows | `B`+`C` Job+Salesperson | Headers: Lead, Job, Salesperson, Paid, Owed, Override |
| `Paid 2026` | Month-filter paid report | N/A (report) | A1 month; output B..S from year sheets |
| `Index` | Navigation | N/A | Hyperlinks to tabs |

### Year sheet columns (2024–2026) used in code / Zaps

| Col | Letter | Meaning |
|-----|--------|---------|
| 1 | A | Lead number / Job ID (Zap lookup) |
| 2 | B | Job number |
| 3 | C | Name / customer |
| 5 | E | Timestamp (auto when C set) |
| 6 | F | Contract / selling price |
| 9 | I | Salesperson |
| 10 | J | Invoiced total (Zap increments) |
| 11 | K | Project revenue / commission basis (Zap); triggers commission + AC on 2024/2025 |
| 12 | L | Change orders (Paid 2026 export) |
| 13 | M | Cost |
| 14 | N | GP |
| 15 | O | GP % |
| 18 | R | Invoice flag (Zap sets true) |
| 19 | S | Paid-in-full style checkbox |
| 20 | T | Update marker (Zap) |
| 21 | U | Status (e.g. In Billing) |
| 27 | AA | Drew participation (2026) |
| 29 | AC | Paid date |

---

## commissions.xlsx (maps to Google “Commission” spreadsheet)

| Tab | Purpose | Row key |
|-----|---------|---------|
| `Brett 2025`, `Drew 2025`, `James 2025`, `Geoff 2025`, `Adam 2025` | Per-person commission lines | A = Job number |
| `Brett 2026`, … `Mike 2026` | 2026 commission sheets | A = Job number |
| `Total Commissions 2025` | Pay-period multiline payment log | A = Pay period label |
| `Total Commissions 2026` | Same for 2026 | A = Pay period label |

### Commission sheet columns (from Commission Apps Script)

| Col | Letter | Meaning |
|-----|--------|---------|
| 1 | A | Job number (payment source row) |
| 2 | B | Customer name |
| 11 | K | Amount owed (basis for payout) |
| 12 | L | Paid checkbox (triggers `processPayment`) |

### Total Commissions layout

- Col A: Pay period text  
- Cols B–F (2025): Brett, Drew, James, Geoff, Will/Adam  
- Cols B–E (2026): Brett, Drew, James, Mike  

Cell text format: lines like `JOB - customer - $amount` (parsed in Job Numbering script).

---

## Per-person billed projects workbooks (Drew, Brett, James, Mike, …)

No Apps Script reference in-repo. Typical layout (see `workbook-inventory.generated.json` when files exist):

- Year tabs `2025`, `2026`, … — job-level billed/commission columns (`Job #`, `Name`, `Contract`, `Invoiced`, `Commission Paid`, `Commission Owed`, …).
- Pay tabs `2025 Pay`, `2026 Pay`, … — `Pay Period`, a salesperson column with multiline `job - customer - $amount` cells (same pattern as Total Commissions).

Place **one workbook per owner** at repo root, for example `Drew Billed Projects.xlsx`, `Brett Billed Projects.xlsx`, `James billed projects.xlsx`. `npm run inventory` lists every matching file under `billed_projects:<filename>` in `docs/workbook-inventory.generated.json`.

Import: `npm run import:billed-projects` (after `import:jobs`). Full stack: `npm run import:all`.

Treat as **secondary source** after Job Numbering; `BilledProjectLine` stores the grid, and pay tabs also append `CommissionPayout` rows keyed with `BP:…`.

---

## Machine-readable inventory

Static snapshot: [workbook-inventory.json](./workbook-inventory.json)  
Generated (after `npm run inventory`): `workbook-inventory.generated.json` (gitignored in `platform/.gitignore`).

---

## Software coverage (Elevated platform)

What the **Next.js + Postgres** app stores today, and how to get the rest in:

| Source area | In Postgres? | How |
|-------------|--------------|-----|
| Job Numbering year tabs `2024` / `2025` / `2026` | Yes — `Job` | `cd platform && npm run import:jobs` |
| Job Numbering `Commission Data` | Partial — rows drive `Commission` only after each job exists (import recalculates from job + rules) | Same job import + workflow |
| Commission workbook per-person tabs (`Brett 2026`, `James 2025`, …) | Yes — `Commission` | `npm run import:commission-sheets` (after `import:jobs`) |
| Job Numbering tab **Commission Data** | Yes — `Commission` | `npm run import:commission-data` |
| **Total Commissions 2025 / 2026** (pay period grid, multiline cells) | Yes — `CommissionPayout` | `npm run import:payouts` (parses `job - customer - $amount` lines). In-app “Mark paid” also appends `CommissionPayout`. |
| **`{Name} Billed Projects.xlsx`** year + pay tabs | Yes — `BilledProjectLine` + pay cells → `CommissionPayout` | `npm run import:billed-projects` |
| Per-salesperson year tabs on Job Numbering (`2026 Brett`, …) | No separate table — same job row + commission lines | Optional future “views” only |
| `Paid 2026`, `Index` | Not imported | Report-only in Sheets; use Jobs filters / `paidDate` in app |
| **Drew / Brett / James / Mike … `*billed*projects*.xlsx`** | Yes — `BilledProjectLine` (+ pay tabs → `CommissionPayout` with `importSourceKey` prefix `BP:`) | `npm run import:billed-projects` |
| **Every `.xlsx` tab (Surveys, Reports, OPs Callback, Index, …)** | Yes — `SpreadsheetSnapshot` (full row JSON) | **`npm run import:xlsx-snapshots` first** (included in `npm run import:all`) |
| **Job Numbering `2025 Brett`, `2026 Mike`, …** | Yes — `Commission` (aligned to main year rows or full grid when Job # present) | `npm run import:job-person-sheets` (end of `import:all`) |
| Zapier / ProLine | Runtime `Job` updates | Webhooks + bridge per `docs/PROLINE_INTEGRATION.md` |

**HR / payroll:** Admins and the **`HR`** role can open **Dashboard → Payroll** (`/dashboard/hr/commissions`) for every payout line grouped by **pay period label**, plus CSV download (`/api/reports/payroll-payouts`). Seed an HR login with `SEED_HR_EMAIL` / `SEED_HR_PASSWORD` (see `platform/.env.example`).
