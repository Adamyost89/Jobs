export function isInsuranceCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^ins(\b|[\s-_:])/i.test(name.trim());
}

/** Warranty jobs (customer name starts with WAR, e.g. "WAR - …") keep a job # but are omitted from sales rollups. */
export function isWarrantyCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^war(\b|[\s-_:])/i.test(name.trim());
}

export function countsTowardSignedTotals(name: string | null | undefined): boolean {
  return !isWarrantyCustomerName(name);
}

