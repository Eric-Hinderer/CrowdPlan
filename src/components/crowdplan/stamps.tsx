import { CircleDashed, CircleCheck, Lock, OctagonAlert, SlidersHorizontal } from "lucide-react";
import type { DimensionProgress, DimensionState, SourceKind } from "@/domain/types";
import { cn } from "@/lib/cn";

const STATE_META: Record<DimensionState, { label: string; className: string; Icon: typeof Lock }> = {
  LOCKED: { label: "Locked", className: "stamp-locked", Icon: Lock },
  CONSTRAINED: { label: "Constrained", className: "stamp-constrained", Icon: SlidersHorizontal },
  UNDECIDED: { label: "Undecided", className: "stamp-undecided", Icon: CircleDashed },
};

export function StateStamp({ state, className }: { state: DimensionState; className?: string }) {
  const meta = STATE_META[state];
  return (
    <span className={cn("stamp", meta.className, className)}>
      <meta.Icon className="size-3" aria-hidden="true" strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

const PROGRESS_META: Record<DimensionProgress, { label: string; className: string; Icon: typeof Lock } | null> = {
  RESOLVED: { label: "Resolved", className: "stamp-resolved", Icon: CircleCheck },
  BLOCKED: { label: "Blocked", className: "stamp-blocked", Icon: OctagonAlert },
  OPEN: null,
};

export function ProgressStamp({ progress, className }: { progress: DimensionProgress; className?: string }) {
  const meta = PROGRESS_META[progress];
  if (!meta) return null;
  return (
    <span className={cn("stamp", meta.className, className)}>
      <meta.Icon className="size-3" aria-hidden="true" strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

const SOURCE_META: Record<SourceKind, { label: string; className: string }> = {
  live: { label: "Live data", className: "text-resolved border-resolved/40" },
  estimate: { label: "Estimate", className: "text-warn border-warn/50 border-dashed" },
  user: { label: "Added by the group", className: "text-ink-2 border-rule" },
  unknown: { label: "Unverified", className: "text-ink-3 border-rule border-dashed" },
  demo: { label: "Demo data", className: "text-brand border-brand/50 bg-brand/8" },
};

export function SourceBadge({ kind, fetchedAt, provider, className }: { kind: SourceKind; fetchedAt?: string | null; provider?: string | null; className?: string }) {
  const meta = SOURCE_META[kind];
  const when = fetchedAt ? relativeTime(fetchedAt) : null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-semibold", meta.className, className)}
      title={fetchedAt ? `${provider ?? "Provider"} · fetched ${new Date(fetchedAt).toLocaleString()}` : undefined}
    >
      {meta.label}
      {kind === "live" && when ? <span className="font-normal opacity-80">· {when}</span> : null}
    </span>
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
