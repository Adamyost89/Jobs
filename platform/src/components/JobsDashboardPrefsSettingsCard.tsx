"use client";

import { useCallback, useEffect, useState } from "react";
import { JobsDashboardPrefsForm } from "@/components/JobsDashboardPrefsForm";
import {
  DEFAULT_JOBS_TABLE_PREFS,
  type JobsTablePrefsV1,
  loadJobsTablePrefsFromStorage,
  saveJobsTablePrefsToStorage,
} from "@/lib/jobs-table-preferences";

export function JobsDashboardPrefsSettingsCard() {
  const [prefs, setPrefs] = useState<JobsTablePrefsV1>(DEFAULT_JOBS_TABLE_PREFS);

  useEffect(() => {
    setPrefs(loadJobsTablePrefsFromStorage());
  }, []);

  const persist = useCallback((next: JobsTablePrefsV1) => {
    setPrefs(next);
    saveJobsTablePrefsToStorage(next);
  }, []);

  return <JobsDashboardPrefsForm prefs={prefs} onChange={persist} variant="settings" startOpen />;
}
