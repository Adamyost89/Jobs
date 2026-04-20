"use client";

import { CommissionPlanForm } from "./CommissionPlanForm";

export function CommissionPlanSettings({
  years,
  salespersonNames,
}: {
  years: number[];
  salespersonNames: string[];
}) {
  return <CommissionPlanForm years={years} salespersonNames={salespersonNames} />;
}
