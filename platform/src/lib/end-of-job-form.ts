import type { Job, Prisma } from "@prisma/client";

export type EndOfJobFormTriggerMatch = "substring" | "exact";

export type EndOfJobFormTriggerConfig = {
  match: EndOfJobFormTriggerMatch;
  value: string;
};

export type EndOfJobFormFieldType = "text" | "textarea" | "number" | "boolean" | "select";

/** Show this field only when another field's answer is one of `equals`. */
export type EndOfJobFormShowIf = {
  fieldId: string;
  equals: string[];
};

export type EndOfJobFormField = {
  id: string;
  label: string;
  type: EndOfJobFormFieldType;
  required?: boolean;
  options?: string[];
  showIf?: EndOfJobFormShowIf;
};

export type EndOfJobFormConfig = {
  version: number;
  fields: EndOfJobFormField[];
};

const DEFAULT_TRIGGER: EndOfJobFormTriggerConfig = {
  match: "substring",
  value: "End of Job Checklist",
};

const DEFAULT_FORM: EndOfJobFormConfig = { version: 1, fields: [] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseEndOfJobFormTrigger(raw: unknown): EndOfJobFormTriggerConfig {
  if (!isRecord(raw)) return DEFAULT_TRIGGER;
  const match = raw.match === "exact" || raw.match === "substring" ? raw.match : DEFAULT_TRIGGER.match;
  const value = typeof raw.value === "string" ? raw.value.trim() : DEFAULT_TRIGGER.value;
  if (!value) return { ...DEFAULT_TRIGGER, match };
  return { match, value };
}

function parseShowIf(raw: unknown, fieldId: string): { ok: true; value?: EndOfJobFormShowIf } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isRecord(raw)) return { ok: false, error: `Field "${fieldId}" has invalid showIf` };
  const depId = typeof raw.fieldId === "string" ? raw.fieldId.trim() : "";
  if (!depId) return { ok: false, error: `Field "${fieldId}" showIf needs a fieldId` };
  if (depId === fieldId) return { ok: false, error: `Field "${fieldId}" showIf cannot reference itself` };
  if (!Array.isArray(raw.equals)) return { ok: false, error: `Field "${fieldId}" showIf needs equals[]` };
  const equals = raw.equals.map((o) => String(o).trim()).filter(Boolean);
  if (equals.length === 0) return { ok: false, error: `Field "${fieldId}" showIf needs at least one equals value` };
  return { ok: true, value: { fieldId: depId, equals } };
}

export function parseEndOfJobFormConfig(raw: unknown): { ok: true; value: EndOfJobFormConfig } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: true, value: DEFAULT_FORM };
  const version = typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 1;
  const fieldsRaw = raw.fields;
  if (!Array.isArray(fieldsRaw)) return { ok: true, value: { version, fields: [] } };
  const fields: EndOfJobFormField[] = [];
  for (let i = 0; i < fieldsRaw.length; i++) {
    const fr = fieldsRaw[i];
    if (!isRecord(fr)) continue;
    const id = typeof fr.id === "string" ? fr.id.trim() : "";
    const label = typeof fr.label === "string" ? fr.label.trim() : "";
    const type = fr.type;
    if (!id || !label) return { ok: false, error: `Field at index ${i} needs non-empty id and label` };
    if (type !== "text" && type !== "textarea" && type !== "number" && type !== "boolean" && type !== "select") {
      return { ok: false, error: `Field "${id}" has invalid type` };
    }
    const required = Boolean(fr.required);
    let options: string[] | undefined;
    if (type === "select") {
      if (!Array.isArray(fr.options) || fr.options.length === 0) {
        return { ok: false, error: `Select field "${id}" needs options[]` };
      }
      options = fr.options.map((o) => String(o).trim()).filter(Boolean);
      if (options.length === 0) return { ok: false, error: `Select field "${id}" needs at least one option` };
    }
    const showIfParsed = parseShowIf(fr.showIf, id);
    if (!showIfParsed.ok) return showIfParsed;
    fields.push({
      id,
      label,
      type,
      required: required || undefined,
      options,
      ...(showIfParsed.value ? { showIf: showIfParsed.value } : {}),
    });
  }
  const ids = new Set(fields.map((f) => f.id));
  for (const field of fields) {
    if (!field.showIf) continue;
    if (!ids.has(field.showIf.fieldId)) {
      return { ok: false, error: `Field "${field.id}" showIf references unknown field "${field.showIf.fieldId}"` };
    }
  }
  return { ok: true, value: { version, fields } };
}

/** Normalize an answer for showIf matching (select/text compare as trimmed strings). */
export function endOfJobAnswerMatchString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Whether `field` should be shown given current answers.
 * Walks the showIf chain so a hidden parent cannot unlock a child.
 */
export function isEndOfJobFieldVisible(
  field: EndOfJobFormField,
  values: Record<string, unknown>,
  allFields: EndOfJobFormField[] = []
): boolean {
  if (!field.showIf) return true;
  const fieldsById = new Map(allFields.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let current: EndOfJobFormField | undefined = field;
  while (current?.showIf) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    const answer = endOfJobAnswerMatchString(values[current.showIf.fieldId]);
    if (answer === null || !current.showIf.equals.includes(answer)) return false;
    current = fieldsById.get(current.showIf.fieldId);
  }
  return true;
}

export function shouldRequireEndOfJobFormFromStage(
  stage: string | null | undefined,
  trigger: EndOfJobFormTriggerConfig
): boolean {
  const needle = (trigger.value || "").trim();
  if (!needle) return false;
  const hay = String(stage ?? "").trim();
  if (!hay) return false;
  if (trigger.match === "exact") return hay.toLowerCase() === needle.toLowerCase();
  return hay.toLowerCase().includes(needle.toLowerCase());
}

export function commissionPayoutBlockedForJob(job: {
  endOfJobFormRequiredAt: Date | null;
  endOfJobFormSubmittedAt: Date | null;
}): boolean {
  return Boolean(job.endOfJobFormRequiredAt && !job.endOfJobFormSubmittedAt);
}

/** Use in Prisma `Commission` queries so payout-oriented lists exclude jobs pending the end-of-job form. */
export const commissionJobAllowedForPayoutSheetWhere: Prisma.CommissionWhereInput = {
  OR: [
    { job: { endOfJobFormRequiredAt: null } },
    { job: { endOfJobFormSubmittedAt: { not: null } } },
  ],
};

export type ValidatedEndOfJobResponses = Record<string, string | number | boolean | null>;

export function validateEndOfJobFormSubmission(
  config: EndOfJobFormConfig,
  body: Record<string, unknown>
): { ok: true; values: ValidatedEndOfJobResponses } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const values: ValidatedEndOfJobResponses = {};

  for (const field of config.fields) {
    if (!isEndOfJobFieldVisible(field, body, config.fields)) {
      values[field.id] = null;
      continue;
    }

    const raw = body[field.id];
    const missing = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");

    if (field.required && missing) {
      errors.push(`"${field.label}" is required`);
      continue;
    }
    if (missing) {
      values[field.id] = null;
      continue;
    }

    switch (field.type) {
      case "text":
      case "textarea": {
        values[field.id] = String(raw).trim();
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).trim());
        if (!Number.isFinite(n)) {
          errors.push(`"${field.label}" must be a number`);
        } else {
          values[field.id] = n;
        }
        break;
      }
      case "boolean": {
        if (typeof raw === "boolean") {
          values[field.id] = raw;
        } else if (raw === "true" || raw === "1" || raw === 1) values[field.id] = true;
        else if (raw === "false" || raw === "0" || raw === 0) values[field.id] = false;
        else errors.push(`"${field.label}" must be true or false`);
        break;
      }
      case "select": {
        const s = String(raw).trim();
        const opts = field.options ?? [];
        if (!opts.includes(s)) {
          errors.push(`"${field.label}" must be one of the allowed choices`);
        } else {
          values[field.id] = s;
        }
        break;
      }
      default:
        errors.push(`Unknown field type for "${field.label}"`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, values };
}

/** If stage matches trigger and job never had requirement set, return Date to set. */
export function endOfJobFormRequiredAtIfNewlyTriggered(
  existing: Pick<Job, "endOfJobFormRequiredAt" | "endOfJobFormSubmittedAt">,
  nextStage: string | null | undefined,
  trigger: EndOfJobFormTriggerConfig
): Date | null {
  if (existing.endOfJobFormSubmittedAt) return null;
  if (existing.endOfJobFormRequiredAt) return null;
  if (!shouldRequireEndOfJobFormFromStage(nextStage, trigger)) return null;
  return new Date();
}
