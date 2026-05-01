export function isInsuranceCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^ins(\b|[\s-_:])/i.test(name.trim());
}

