"use client";

import { AlertCircle, Trash2 } from "lucide-react";
import type { DimensionDraft } from "@/domain/interpretation/schema";
import { formatMoney } from "@/domain/money";
import { formatDateLabel, formatTimeLabel } from "@/domain/time";
import type { DimensionState, DimensionValue } from "@/domain/types";
import { cn, Input } from "@/components/ui/primitives";
import { StateStamp } from "./stamps";

const STATES: DimensionState[] = ["LOCKED", "CONSTRAINED", "UNDECIDED"];

const STATE_HELP: Record<DimensionState, string> = {
  LOCKED: "Settled. CrowdPlan won't change it.",
  CONSTRAINED: "Flexible within limits.",
  UNDECIDED: "Let the group figure it out.",
};

/** Build the human-readable summary shown on the board. */
export function displayFor(value: DimensionValue | null): string {
  if (!value) return "Undecided";
  switch (value.type) {
    case "text":
      return value.text;
    case "place":
      return value.name;
    case "dates":
      return value.dates.map(formatDateLabel).join(", ");
    case "dateRange":
      return `${formatDateLabel(value.start)} – ${formatDateLabel(value.end)}`;
    case "timeWindow":
      return value.end === "24:00" ? `After ${formatTimeLabel(value.start)}` : `${formatTimeLabel(value.start)} – ${formatTimeLabel(value.end)}`;
    case "time":
      return formatTimeLabel(value.start);
    case "money":
      return `${value.min != null ? `${formatMoney(value.min)}–` : "Up to "}${value.max != null ? formatMoney(value.max) : "any"}${value.basis === "per_person" ? "/person" : " total"}`;
    case "list":
      return value.items.join(", ");
    case "nights":
      return value.min === value.max ? `${value.min} nights` : `${value.min}–${value.max} nights`;
    case "area":
      return value.label;
    case "minutes":
      return `${value.minutes} min`;
  }
}

/** Sensible empty value when switching a dimension from UNDECIDED. */
export function defaultValueFor(key: string, today: string): DimensionValue {
  switch (key) {
    case "date":
      return { type: "dates", dates: [today] };
    case "dates":
      return { type: "dateRange", start: today, end: today };
    case "time":
      return { type: "timeWindow", start: "18:00", end: "22:00" };
    case "budget":
      return { type: "money", max: 50, currency: "USD", basis: "per_person" };
    case "cuisine":
      return { type: "list", items: ["Italian"] };
    case "nights":
      return { type: "nights", min: 2, max: 3 };
    case "area":
      return { type: "area", label: "" };
    case "place":
    case "destination":
      return { type: "place", name: "" };
    default:
      return { type: "text", text: "" };
  }
}

export function DimensionRow({
  dim,
  onChange,
  onRemove,
  today,
  readOnly,
}: {
  dim: DimensionDraft;
  onChange: (d: DimensionDraft) => void;
  onRemove?: () => void;
  today: string;
  readOnly?: boolean;
}) {
  const id = `dim-${dim.key}`;
  const setState = (state: DimensionState) => {
    const value = state === "UNDECIDED" ? null : dim.value ?? defaultValueFor(dim.key, today);
    onChange({ ...dim, state, value, display: displayFor(value), needsConfirmation: false });
  };
  const setValue = (value: DimensionValue) => onChange({ ...dim, value, display: displayFor(value), needsConfirmation: false });

  return (
    <div className={cn("rounded-2xl border bg-surface p-4", dim.needsConfirmation ? "border-warn" : "border-rule")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold" id={`${id}-label`}>
            {dim.label}
          </span>
          {readOnly ? <StateStamp state={dim.state} /> : null}
        </div>
        {!readOnly ? (
          <div className="flex items-center gap-1" role="radiogroup" aria-labelledby={`${id}-label`}>
            {STATES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={dim.state === s}
                title={STATE_HELP[s]}
                onClick={() => setState(s)}
                className={cn("rounded-md p-0.5 transition", dim.state === s ? "opacity-100" : "opacity-40 grayscale hover:opacity-80")}
              >
                <StateStamp state={s} />
              </button>
            ))}
            {onRemove ? (
              <button type="button" onClick={onRemove} className="ml-1 rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-blocked" aria-label={`Remove ${dim.label}`}>
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {dim.needsConfirmation ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-warn">
          <AlertCircle className="size-4" aria-hidden="true" />
          CrowdPlan assumed this — check it.
        </p>
      ) : null}
      <div className="mt-3">
        {dim.state === "UNDECIDED" || !dim.value ? (
          <p className="text-ink-3">{dim.key === "place" ? "The group will decide" : "Open — CrowdPlan will work it out with the group"}</p>
        ) : readOnly ? (
          <p className="text-lg font-semibold">{dim.display || displayFor(dim.value)}</p>
        ) : (
          <ValueEditor id={id} value={dim.value} onChange={setValue} />
        )}
      </div>
    </div>
  );
}

function ValueEditor({ id, value, onChange }: { id: string; value: DimensionValue; onChange: (v: DimensionValue) => void }) {
  switch (value.type) {
    case "text":
      return <Input aria-label="Value" id={id} value={value.text} maxLength={160} onChange={(e) => onChange({ ...value, text: e.target.value })} />;
    case "place":
      return <Input aria-label="Place" id={id} value={value.name} maxLength={160} onChange={(e) => onChange({ type: "place", name: e.target.value })} />;
    case "area":
      return <Input aria-label="Area" id={id} value={value.label} maxLength={120} onChange={(e) => onChange({ type: "area", label: e.target.value })} />;
    case "list":
      return (
        <Input
          aria-label="Options (comma separated)"
          id={id}
          defaultValue={value.items.join(", ")}
          onBlur={(e) => {
            const items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
            if (items.length) onChange({ type: "list", items });
          }}
        />
      );
    case "dates":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="Date" id={id} className="w-auto" value={value.dates[0]} onChange={(e) => e.target.value && onChange({ type: "dates", dates: [e.target.value] })} />
          <button type="button" className="text-sm font-semibold text-brand" onClick={() => onChange({ type: "dateRange", start: value.dates[0], end: value.dates[0] })}>
            Make it a range
          </button>
        </div>
      );
    case "dateRange":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="From" id={id} className="w-auto" value={value.start} onChange={(e) => e.target.value && onChange({ ...value, start: e.target.value, end: value.end < e.target.value ? e.target.value : value.end })} />
          <span className="text-ink-3">to</span>
          <Input type="date" aria-label="To" className="w-auto" value={value.end} min={value.start} onChange={(e) => e.target.value && onChange({ ...value, end: e.target.value })} />
        </div>
      );
    case "timeWindow":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="time" aria-label="From" id={id} className="w-auto" value={value.start} onChange={(e) => e.target.value && onChange({ ...value, start: e.target.value })} />
          <span className="text-ink-3">to</span>
          <Input type="time" aria-label="Until" className="w-auto" value={value.end === "24:00" ? "23:59" : value.end} onChange={(e) => e.target.value && onChange({ ...value, end: e.target.value === "23:59" ? "24:00" : e.target.value })} />
          <button type="button" className="text-sm font-semibold text-brand" onClick={() => onChange({ type: "time", start: value.start })}>
            Exact start time
          </button>
        </div>
      );
    case "time":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="time" aria-label="Start time" id={id} className="w-auto" value={value.start} onChange={(e) => e.target.value && onChange({ type: "time", start: e.target.value })} />
          <button type="button" className="text-sm font-semibold text-brand" onClick={() => onChange({ type: "timeWindow", start: value.start, end: "24:00" })}>
            Use a window instead
          </button>
        </div>
      );
    case "money":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-3">$</span>
          <Input type="number" inputMode="numeric" min={0} aria-label="Minimum" placeholder="min" id={id} className="w-24" value={value.min ?? ""} onChange={(e) => onChange({ ...value, min: e.target.value ? Number(e.target.value) : undefined })} />
          <span className="text-ink-3">to $</span>
          <Input type="number" inputMode="numeric" min={1} aria-label="Maximum" placeholder="max" className="w-24" value={value.max ?? ""} onChange={(e) => onChange({ ...value, max: e.target.value ? Number(e.target.value) : undefined })} />
          <select
            aria-label="Budget basis"
            value={value.basis}
            onChange={(e) => onChange({ ...value, basis: e.target.value as "per_person" | "per_group" })}
            className="h-11 rounded-xl border border-rule bg-surface px-2"
          >
            <option value="per_person">per person</option>
            <option value="per_group">for the group</option>
          </select>
        </div>
      );
    case "nights":
      return (
        <div className="flex items-center gap-2">
          <Input type="number" min={1} max={60} aria-label="Minimum nights" id={id} className="w-20" value={value.min} onChange={(e) => onChange({ ...value, min: Math.max(1, Number(e.target.value) || 1), max: Math.max(value.max, Number(e.target.value) || 1) })} />
          <span className="text-ink-3">to</span>
          <Input type="number" min={value.min} max={60} aria-label="Maximum nights" className="w-20" value={value.max} onChange={(e) => onChange({ ...value, max: Math.max(value.min, Number(e.target.value) || value.min) })} />
          <span className="text-ink-3">nights</span>
        </div>
      );
    case "minutes":
      return <Input type="number" min={1} aria-label="Minutes" id={id} className="w-24" value={value.minutes} onChange={(e) => onChange({ type: "minutes", minutes: Math.max(1, Number(e.target.value) || 1) })} />;
  }
}
