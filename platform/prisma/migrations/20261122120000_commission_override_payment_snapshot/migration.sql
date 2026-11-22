-- Manual commission adjustments lock the cash collected at that moment.
-- Later customer payments still add commission on the new cash.
ALTER TABLE "Commission" ADD COLUMN "overrideCustomerPaid" DECIMAL(14,2),
ADD COLUMN "overrideOwedAmount" DECIMAL(14,2),
ADD COLUMN "overridePaidAmount" DECIMAL(14,2),
ADD COLUMN "overrideSyncedPaid" DECIMAL(14,2);
