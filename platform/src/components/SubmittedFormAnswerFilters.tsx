"use client";

import { useMemo, useState } from "react";
import { OTHER, UNANSWERED } from "@/lib/end-of-job-form-analytics";

export type SelectFieldFilterOption = {
  id: string;
  label: string;
  options: string[];
};

export function SubmittedFormAnswerFilters({
  fields,
  initialFieldId,
  initialValue,
}: {
  fields: SelectFieldFilterOption[];
  initialFieldId: string;
  initialValue: string;
}) {
  const [fieldId, setFieldId] = useState(initialFieldId);
  const [value, setValue] = useState(initialValue);

  const selected = useMemo(
    () => fields.find((f) => f.id === fieldId) ?? null,
    [fields, fieldId]
  );

  const valueOptions = useMemo(() => {
    if (!selected) return [];
    return [...selected.options, OTHER, UNANSWERED];
  }, [selected]);

  return (
    <>
      <label>
        Question
        <select
          name="eojField"
          value={fieldId}
          onChange={(e) => {
            const next = e.target.value;
            setFieldId(next);
            setValue("");
          }}
        >
          <option value="">Any question</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Answer
        <select
          name="eojValue"
          value={value}
          disabled={!selected}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">{selected ? "Any answer" : "Select a question first"}</option>
          {valueOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
