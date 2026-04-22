import { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  salespersonId: string | null;
  salespersonIds: string[];
};

export function canViewAllJobs(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

/** Payroll / commission check runs by pay period (HR + admins). */
export function canViewHrPayroll(user: SessionUser): boolean {
  return user.role === Role.HR || user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

export function canViewExcelSnapshots(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

export function canViewCompanyRevenue(user: SessionUser): boolean {
  return true;
}

export function canModifyData(user: SessionUser): boolean {
  return user.role === Role.SUPER_ADMIN;
}

export function canMarkCommissionPaid(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

/** Adjust commission ledger rows (lock / amounts) and fix mis-assigned reps. */
export function canEditCommissions(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

export function canRunFullReports(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

export function canEditJobs(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}
