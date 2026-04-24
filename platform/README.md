# Elevated Job Operations Platform

Web app + API replacing multi-sheet Zapier workflows: jobs, GP, commissions, role-based reporting, ProLine webhook, and optional Zapier bridge.

**Product direction:** [docs/PRODUCT_DIRECTION.md](../docs/PRODUCT_DIRECTION.md) (parity with Job Numbering + simpler navigation).

## Prerequisites

- Node 20+
- PostgreSQL 16 (or use Docker)

## Setup

```bash
cd platform
cp .env.example .env
# Edit .env — set JWT_SECRET and DATABASE_URL

docker compose up -d   # optional: local Postgres
npm install
npx prisma db push
npm run db:seed
npm run dev
```

### Restart the dev server (pick up code or `.env` changes)

1. In **Cursor**, open the **Terminal** panel (Ctrl+Backtick, or **View → Terminal**).
2. Click the terminal tab where the app is running (you should see lines like `next dev` or `Ready in …`).
3. **Stop** the server: click inside that terminal and press **Ctrl+C** once (if it asks, press **Ctrl+C** again). Wait until the prompt returns and it is no longer printing Next.js logs.
4. **Start** again (same folder must be `platform`):

```bash
cd platform
npm run dev
```

If you are not sure which terminal is the app, stop every terminal that shows `next dev`, then run `npm run dev` once from `platform/`. If port 3000 is “in use,” something is still running—close that terminal or end the Node process, then try step 4 again.

Open [http://localhost:3000](http://localhost:3000). Default seed users (change passwords immediately):

| Email | Password | Role |
|-------|----------|------|
| From `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` env | | SUPER_ADMIN |
| admin@example.com | AdminChangeMe123! | ADMIN |
| brett@example.com | SalesChangeMe123! | SALESMAN (Brett) |
| From `SEED_HR_EMAIL` / `SEED_HR_PASSWORD` (defaults `hr@example.com` / `HrChangeMe123!`) | | HR (payroll page only) |

After changing the Prisma schema, run `npx prisma db push` and `npm run db:seed` again so the `HR` role and HR user exist.

### Windows: `EPERM` when renaming `query_engine-windows.dll.node`

Something else is using the Prisma engine file (often **`npm run dev`**, another terminal, or antivirus). **Stop the dev server**, close other terminals running Node from this project, then run:

```bash
npm run db:generate
```

If it still fails, close Cursor/VS Code, reopen the repo, and run `npm run db:generate` again from `platform/`.

### Shell tip

If your prompt is already `...\Elevated Sheets\platform>`, you are in the right folder — **do not** run `cd platform` again (that looks for `platform\platform`).

## Workbook inventory & import

Place workbooks in the **repo root** (parent of `platform/`). Names are matched flexibly (Windows often uses **Title Case** or `File (1).xlsx`), for example:

- `Job Numbering(1).xlsx`, `Job Numbering.xlsx`, or `job numbering.xlsx`
- `Commissions.xlsx` or `commissions.xlsx`
- Any supplemental billed file matching **`*billed*projects*.xlsx`** (e.g. `Drew Billed Projects.xlsx`, `Brett billed projects.xlsx`, `Mike Billed Projects (1).xlsx`)

Then:

```bash
cd platform
npm run inventory          # writes docs/workbook-inventory.generated.json
npm run import:xlsx-snapshots    # FIRST: every .xlsx tab → SpreadsheetSnapshot (lossless)
npm run import:jobs              # Job Numbering year tabs → Job
npm run import:commission-data   # tab Commission Data → Commission
npm run import:commission-sheets # Commissions.xlsx Brett 2026, … → Commission
npm run import:payouts         # Total Commissions * → CommissionPayout
npm run import:billed-projects   # all *billed*projects*.xlsx → BilledProjectLine + pay tabs → CommissionPayout
npm run import:job-person-sheets # Job Numbering 2025 Brett, 2026 Mike, … → Commission
npm run import:all             # runs all of the above in order
npm run validate:import        # validation gates (exits non-zero on hard fail)
npm run prune:shell-jobs       # delete empty placeholder Job rows (no $ / lead / rep) with zero commissions — then re-import jobs if needed
npm run sync:commission-ledger-from-payouts  # align Commission.paid/owed columns with sum of CommissionPayout (after Excel check import)
```

**If you can log in but Jobs is empty:** the database only has seed users until you run `npm run import:jobs`. After it finishes, refresh the browser.

**If lead / project # looks wrong after an earlier import:** run `npm run import:jobs` again (it upserts by job number and refreshes lead fields).

## API highlights

| Method | Path | Notes |
|--------|------|------|
| POST | `/api/auth/login` | JSON `{ email, password }` |
| GET | `/api/jobs` | Role-filtered |
| POST | `/api/jobs` | Admin: create job + next job number |
| PATCH | `/api/jobs/:id` | Admin: update financials |
| GET | `/api/commissions` | Role-filtered |
| POST | `/api/commissions/pay` | Admin: posts payout; **pay period defaults to current biweekly window** (`PAY_PERIOD_ANCHOR` in `.env`) |
| PATCH | `/api/commissions/:id` | Super admin: override lock |
| POST | `/api/webhooks/proline` | ProLine triggers + legacy `type`; see [docs/PROLINE_INTEGRATION.md](../docs/PROLINE_INTEGRATION.md) |
| GET | `/api/webhooks/proline` | Health / URL verification |
| POST | `/api/integrations/proline/reconcile-payments` | Admin: compare local payment fields to ProLine; body `{ apply?: boolean, maxPages?: number }` |

**ProLine webhooks on localhost:** use a public HTTPS tunnel to port 3000 (`npm run tunnel:dev` in `platform`), then paste `https://<tunnel-host>/api/webhooks/proline` in ProLine — details in [docs/PROLINE_INTEGRATION.md](../docs/PROLINE_INTEGRATION.md) (*Local testing*).
| POST | `/api/integrations/zapier-bridge` | Bearer `ZAPIER_BRIDGE_SECRET` |
| GET | `/api/reports/export?scope=mine|full` | CSV |
| GET | `/api/reports/payroll-payouts` | CSV of all `CommissionPayout` rows (HR / admin) |
| GET | `/api/admin/snapshots` | Admin: list `SpreadsheetSnapshot` sheets; add `?workbookKey=&sheetName=` for full JSON rows |

## Documentation

- [docs/workbook-inventory.md](../docs/workbook-inventory.md)
- [docs/SOURCE_TO_TARGET_MAPPING.md](../docs/SOURCE_TO_TARGET_MAPPING.md)
- [docs/IMPORT_VALIDATION.md](../docs/IMPORT_VALIDATION.md)
