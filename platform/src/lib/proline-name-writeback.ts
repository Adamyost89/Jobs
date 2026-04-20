export type ProlineNameWritebackInput = {
  prolineJobId: string;
  leadNumber?: string | null;
  jobNumber: string;
  projectName: string;
};

function trimString(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export function buildProlineProjectNameForAssignedJob(
  originalProjectName: string | null | undefined,
  jobNumber: string
): string {
  const jn = trimString(jobNumber);
  const original = trimString(originalProjectName);
  const base = original || "Project";
  const withSuffixPattern = new RegExp(`\\s-\\s${jn}$`, "i");
  if (withSuffixPattern.test(base)) return base;
  return `${base} - ${jn}`;
}

export async function sendProlineNameWritebackViaZapier(
  input: ProlineNameWritebackInput
): Promise<void> {
  const url = (process.env.ZAPIER_PROLINE_NAME_WEBHOOK_URL || "").trim();
  if (!url) {
    throw new Error("Missing ZAPIER_PROLINE_NAME_WEBHOOK_URL");
  }
  const secret = (process.env.ZAPIER_BRIDGE_SECRET || "").trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers["x-bridge-secret"] = secret;
    headers.authorization = `Bearer ${secret}`;
  }

  const payload = {
    project_id: input.prolineJobId,
    project_number: input.leadNumber ?? null,
    project_name: input.projectName,
    assigned_job_number: input.jobNumber,
    source: "elevated_platform",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (res.ok) return;
  const bodyText = await res.text().catch(() => "");
  throw new Error(`Proline name write-back failed (${res.status}): ${bodyText.slice(0, 300)}`);
}
