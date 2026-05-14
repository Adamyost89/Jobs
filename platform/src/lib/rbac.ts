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

/** Job contract + amount paid under commission-line job cells (same cohort as payroll viewers). */
export function canViewJobContractAndPaidForCommissions(user: SessionUser): boolean {
  return canViewHrPayroll(user);
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

/** Submit end-of-job checklist for a job (primary rep or admins). */
export function canSubmitEndOfJobForm(user: SessionUser, job: { salespersonId: string | null }): boolean {
  if (canViewAllJobs(user)) return true;
  if (job.salespersonId && user.salespersonIds.includes(job.salespersonId)) return true;
  return false;
}
