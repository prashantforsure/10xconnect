"use client";

import type { SendCondition } from "@10xconnect/core";

import { Select } from "@/components/ui/select";

// Extensible by adding entries here + a matching gate in the dispatch engine.
const OPTIONS: { value: SendCondition["type"]; label: string }[] = [
  { value: "always", label: "Always send" },
  { value: "never_messaged", label: "Send only if the recipient has never sent a message" },
];

export function SendConditionSelect({
  value,
  onChange,
  disabled,
}: {
  value: SendCondition;
  onChange: (next: SendCondition) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Send condition</label>
      <Select
        value={value.type}
        disabled={disabled}
        onChange={(e) => onChange({ type: e.target.value as SendCondition["type"] })}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
