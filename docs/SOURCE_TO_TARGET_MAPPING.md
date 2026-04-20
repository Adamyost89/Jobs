# Source → target field mapping

Maps legacy Google Sheets / Excel exports to the `platform` PostgreSQL schema (`prisma/schema.prisma`).

Legend: **authoritative** (import as-is), **derived** (recompute in app), **legacy** (display only / audit).

## Jobs (`Job` table)

| Source | Tab | Column(s) | Target field | Type | Notes |
|--------|-----|-----------|----------------|------|-------|
| Job Numbering | **Modern** (`2025`/`2026`, “Job #” in column B) | A | `leadNumber` | string | Zap uses A as job id lookup |
| Job Numbering | modern | B | `jobNumber` | string | **Unique** canonical key |
| Job Numbering | modern | C | `name` | string | Customer / job name |
| Job Numbering | modern | E | `contractSignedAt` | datetime? | Imported from Date |
| Job Numbering | modern | F | `contractAmount` | decimal | authoritative |
| Job Numbering | modern | I | `salesperson` → `salespersonId` | FK | “AM”; header scan can relocate |
| Job Numbering | modern | J | `invoicedTotal` | decimal | authoritative; Zap increments |
| Job Numbering | modern | K | `amountPaid` | decimal? | Optional |
| Job Numbering | modern | L | `changeOrders` | decimal | |
| Job Numbering | modern | M | `cost` | decimal | authoritative (manual from ProLine) |
| Job Numbering | modern | N | `gp` | decimal | Sheet value; app recomputes when cost &gt; 0 and paid in full |
| Job Numbering | modern | O | `gpPercent` | decimal | Same rule as `gp` |
| Job Numbering | modern | P | `retailPercent` | decimal? | 0–100 |
| Job Numbering | modern | Q | `insurancePercent` | decimal? | 0–100 |
| Job Numbering | modern | R | `invoiceFlag` | bool | Billed |
| Job Numbering | modern | S | `paidInFull` | bool | |
| Job Numbering | modern | T | `commOwedFlag` | bool | Comm owed checkbox |
| Job Numbering | modern | U | `status` | string | Normalize to enum in app |
| Job Numbering | modern | V | `updateMarker` | bool | “Update this” / Zap |
| Job Numbering | modern | X (index 23+) | `projectRevenue` | decimal | When present and &gt; 0; else derived from J / F+L |
| Job Numbering | `2026` only | AA | `drewParticipation` | string? | Drew side commission |
| Job Numbering | year sheets | AC | `paidDate` | date | Filter for Paid report |
| Job Numbering | **Legacy** (`2024`-style, job # in column A) | A | `jobNumber` | string | **Unique** key |
| Job Numbering | legacy | B | `name` | string | |
| Job Numbering | legacy | D | `contractSignedAt` | datetime? | Imported |
| Job Numbering | legacy | E | `contractAmount` | decimal | |
| Job Numbering | legacy | H | `salesperson` | FK | AM |
| Job Numbering | legacy | I | `invoicedTotal` | decimal | |
| Job Numbering | legacy | J | `changeOrders` | decimal | |
| Job Numbering | legacy | K | `cost` | decimal | |
| Job Numbering | legacy | L | `gp` | decimal | Dollar GP from sheet |
| Job Numbering | legacy | M | `gpPercent` | decimal | |
| Job Numbering | legacy | P | `invoiceFlag` | bool | Billed |
| Job Numbering | legacy | Q | `status` | string | |
| — | — | tab name | `year` | int | `2024`/`2025`/`2026` from sheet name |

## Commissions (`Commission` table)

| Source | Tab | Column(s) | Target field | Notes |
|--------|-----|-----------|----------------|-------|
| Job Numbering | `Commission Data` | A–F | `leadNumber`, `jobNumber`, salesperson, `paidAmount`, `owedAmount`, `override` | Direct map |
| Job Numbering | `2025 Brett`, `2026 Mike`, … (per-AM commission columns) | Paid/Owed columns vs main year row | `Commission` | `import:job-person-sheets`: same row index as main `2025`/`2026`/`2024` tab, or full grid when tab has Job # |
| Commission workbook | `{Name} {Year}` | A,B,K | job, customer, owed display | Sync to `Commission` by job+salesperson |
| Commission workbook | `Total Commissions {Year}` | pay cells | Parsed payments | Aggregate into `CommissionPayout` + update `Commission.paidAmount` |

## Commission payouts (`CommissionPayout`)

| Source | Tab | Target |
|--------|-----|--------|
| Total Commissions * | Row = pay period, column = salesperson | `CommissionPayout` lines (`payPeriodLabel`, `salespersonId`, `amount`, optional `jobId`, `importSourceKey` for idempotent `npm run import:payouts`) |

## Full Excel capture (`SpreadsheetSnapshot`)

| Source | Tab | Target | Notes |
|--------|-----|--------|-------|
| Every `.xlsx` at repo root | **All** sheet names | `SpreadsheetSnapshot` | Run `npm run import:xlsx-snapshots` (first step of `import:all`). Preserves Surveys, Reports, OPs Callback, Index, charts, etc. |

## Billed projects workbooks (`*billed*projects*.xlsx`)

| Source | Tab | Target | Notes |
|--------|-----|--------|-------|
| `{Name} Billed Projects.xlsx` (Drew, Brett, James, Mike, …) | `2025`, `2026`, … | `BilledProjectLine` | Owner parsed from filename; upsert by `sourceFilename` + `year` + `jobNumber`; links `jobId` when `Job` exists. |
| Same file | `2025 Pay`, `2026 Pay`, … | `CommissionPayout` | Multiline cells in the salesperson column (header row col B); `importSourceKey` prefix `BP:`; same line format as Total Commissions. |

## ProLine / Zapier (runtime, not Excel)

| Event | Target |
|-------|--------|
| New job signed | `POST /api/webhooks/proline` → create `Job`, allocate `jobNumber` |
| Invoice | Update `invoicedTotal`, `invoiceFlag` |
| Paid | Update `paidInFull`, `paidDate`, revenue fields per your Zap rules |

## Zapier column touchpoints (for migration parity tests)

- [Update Invoice Total and Set Flag](../Zapier/Update%20Invoice%20Total%20and%20Set%20Flag): `J+=`, `R=true`, lookup `A` in `2026` then `2025`
- See other Zapier files for contract, status, account manager updates → map to same `Job` fields where applicable.
