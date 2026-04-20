# Google Sheets to Create/Modify

## Critical Fix Applied
The code has been updated to use "Total Commissions 2025" instead of "Total Commissions". You can now run the `syncPaidAmountsFromTotalCommissions` function from the menu to recover your paid amounts data.

## Sheets to Create in Target Spreadsheet (ID: 1eO365hmI2Nm9_YssKGka92teOkoRD0uzSnM0r31D7ek)

### Keep Existing 2025 Sheets:
- `2025` (keep)
- `2025 Brett` (keep)
- `2025 Drew` (keep)
- `2025 James` (keep)
- `2025 Geoff` (keep for historical data)
- `2025 Adam` (keep for historical data)
- `2025 Will` (if exists, keep for historical data)
- `Commission Data` (keep)

### Create New 2026 Sheets:
1. **`2026`** - Main sheet for 2026 jobs
2. **`2026 Brett`** - Individual sheet for Brett's 2026 jobs
3. **`2026 Drew`** - Individual sheet for Drew's 2026 jobs
4. **`2026 James`** - Individual sheet for James's 2026 jobs (must have column J for paid amounts tracking)
5. **`2026 Mike`** - Individual sheet for Mike's 2026 jobs

## Sheets to Create in Commission Sheet Spreadsheet

### Existing Sheets (keep):
- `Brett 2025` (user renamed - keep)
- `Drew 2025` (user renamed - keep)
- `James 2025` (user renamed - keep, column J contains paid amounts)
- `Geoff 2025` (if exists, keep for historical)
- `Adam 2025` (if exists, keep for historical)
- `Total Commissions 2025` (user renamed - keep)

### Create New 2026 Sheets:
1. **`Brett 2026`** - Individual commission sheet for Brett's 2026 jobs
2. **`Drew 2026`** - Individual commission sheet for Drew's 2026 jobs
3. **`James 2026`** - Individual commission sheet for James's 2026 jobs (must have column J for paid amounts tracking - used for bonus calculation)
4. **`Mike 2026`** - Individual commission sheet for Mike's 2026 jobs
5. **`Total Commissions 2026`** - Payment tracking sheet for 2026

### Total Commissions Sheet Structure:

**Total Commissions 2025:**
- Column A: Pay Period (Jan 6 & 13, Jan 20 & 27, etc.)
- Column B: Brett
- Column C: Drew
- Column D: James
- Column E: Geoff
- Column F: Will/Adam (if applicable)

**Total Commissions 2026:**
- Column A: Pay Period (user to provide dates)
- Column B: Brett
- Column C: Drew
- Column D: James
- Column E: Mike

## Important Notes:

1. **Column J in James sheets**: The James bonus structure requires column J in "James 2025" and "James 2026" sheets to track paid amounts. When the sum of column J reaches $1,000,000 for a given year, James's commission rate increases to 10.5% for that year's remaining jobs.

2. **Pay Period Dates**: The 2026 pay period dates are currently placeholders in the code. User needs to update the dates in `recordCommissionPayment` function (lines 280-321 in Commission Sheet/Apps Script.gs) with the actual 2026 pay period dates.

3. **Commission Rates for 2026:**
   - Brett: 5%
   - Drew: 1%
   - James: 10% base, 10.5% after $1M paid (column J)
   - Mike: 5%

4. **Data Recovery**: After creating the sheets, run the "Sync Paid Amounts" function from the Custom Actions menu in the Job Numbering Sheet to recover paid amounts from "Total Commissions 2025".
