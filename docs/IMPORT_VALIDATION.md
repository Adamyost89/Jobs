# Import validation gates

Executable checklist implemented in `platform/scripts/validate-import.ts` (row + aggregate checks).

## Hard fail (must be zero)

- Duplicate `jobNumber` in imported `Job` set
- Unmapped `status` values (not in `lib/status.ts` enum)
- Unknown salesperson strings with no mapping row in `Salesperson`
- Commission row where `override=false` and recomputed owed differs from imported by > $0.01

## Soft thresholds

- Parse/type errors ≤ 0.25% of rows (configurable); each error needs `remediationOwner` in report JSON
- Per-year aggregate variance (contract, invoiced, paid, cost, GP) ≤ 0.10% vs source sums

## Cross-source

- For each `jobNumber` present in both Job Numbering and commissions export: `Commission.paidAmount` matches parsed Total Commissions sum within tolerance unless override

## Sign-off

- `Admin` + `SuperAdmin` users must exist; record `AuditLog` entry `import_validated` before cutover flag `SystemConfig.cutoverComplete`
