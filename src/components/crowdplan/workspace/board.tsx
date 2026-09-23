"use client";

import { Pencil } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { updateDimensionAction } from "@/app/actions/plans";
import { REACTION_LABELS } from "@/domain/consensus";
import type { DimensionDraft } from "@/domain/interpretation/schema";
import type { DimensionStatus, ReactionKind } from "@/domain/types";
import { Avatar, Button, ErrorNote, Sheet, cn } from "@/components/ui/primitives";
import { DimensionRow } from "../dimension-editor";
import { ProgressStamp, StateStamp } from "../stamps";
import { useWorkspace } from "./context";

const ORDER = ["activity", "place", "destination", "date", "dates", "time", "nights", "participants", "budget", "cuisine", "area", "flights", "lodging"];
const LABEL: Record<string, string> = {
  activity: "What",
  place: "Where",
  destination: "Destination",
  date: "When",
  dates: "Dates",
  time: "Time",
  nights: "Length",
  participants: "Who",
  budget: "Budget",
  cuisine: "Cuisine",
  area: "Area",
  flights: "Flights",
  lodging: "Hotel",
};

export function ResolutionBoard() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);
  const rows = useMemo(() => {
    const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
    return [...ws.evaluation.dimensionStatus].sort((a, b) => rank(a.key) - rank(b.key));
  }, [ws.evaluation.dimensionStatus]);
  const editable = ws.isOrganizer && ws.bundle.plan.status === "collecting" && !ws.flags.demo;
  const dim = editing ? ws.bundle.dimensions.find((d) => d.key === editing) : null;

  return (
    <section aria-labelledby="board-heading" className="rounded-[1.4rem] border-2 border-ink bg-surface shadow-[5px_5px_0_var(--ink)]">
      <h2 id="board-heading" className="sr-only">
        Plan resolution board
      </h2>
      <ul className="divide-y divide-rule" data-testid="resolution-board">
        {rows.map((r) => (
          <BoardRow key={r.key} row={r} onEdit={editable && ws.bundle.dimensions.some((d) => d.key === r.key) ? () => setEditing(r.key) : undefined} />
        ))}
      </ul>
      <ConsensusBlock />
      {dim ? <EditDimensionSheet key={dim.key} dim={{ ...dim, needsConfirmation: false }} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

const noopSubscribe = () => () => {};

function BoardRow({ row, onEdit }: { row: DimensionStatus; onEdit?: () => void }) {
  const reduce = useReducedMotion();
  // Animate only changes after hydration (no fade-in on page load / SSR).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <li className="group relative px-4 py-3.5" data-testid={`board-row-${row.key}`} data-state={row.state} data-progress={row.progress}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8rem] font-semibold text-ink-3">{LABEL[row.key] ?? row.label}</p>
          <motion.p
            key={row.summary + (row.detail ?? "")}
            initial={reduce || !hydrated ? false : { opacity: 0.2, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={cn("mt-0.5 text-[1.15rem] leading-snug font-bold break-words", row.state === "UNDECIDED" && row.progress !== "RESOLVED" && "text-ink-2")}
          >
            {row.summary}
          </motion.p>
          {row.detail ? <p className="mt-0.5 text-sm text-ink-2">{row.detail}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {row.key !== "participants" ? <StateStamp state={row.state} /> : null}
          <ProgressStamp progress={row.progress} />
        </div>
      </div>
      {onEdit ? (
        <button
          onClick={onEdit}
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand opacity-70 group-hover:opacity-100 focus:opacity-100"
          aria-label={`Edit ${LABEL[row.key] ?? row.label}`}
        >
          <Pencil className="size-3" aria-hidden="true" /> Edit
        </button>
      ) : null}
    </li>
  );
}

function EditDimensionSheet({ dim, onClose }: { dim: DimensionDraft; onClose: () => void }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState(dim);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = new Date(ws.bundle.loadedAt).toLocaleDateString("en-CA", { timeZone: ws.tz });
  return (
    <Sheet open onClose={onClose} title={`Edit ${LABEL[dim.key] ?? dim.label}`}>
      <div className="space-y-4">
        <DimensionRow dim={draft} today={today} onChange={setDraft} />
        <p className="text-sm text-ink-2">Changing something locked updates everyone&apos;s view immediately and re-checks every option.</p>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await updateDimensionAction({ planId: ws.bundle.plan.id, dimension: draft });
              if (!r.ok) return setError(r.error);
              await ws.refresh();
              onClose();
            })
          }
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}

const BAR_COLORS: Record<ReactionKind, string> = {
  love: "var(--resolved)",
  works: "color-mix(in oklab, var(--resolved) 55%, var(--surface))",
  acceptable: "var(--undecided)",
  rather_not: "var(--warn)",
  cant: "var(--blocked)",
};

export function ConsensusBlock() {
  const ws = useWorkspace();
  const c = ws.evaluation.consensus;
  const leader = ws.evaluation.evaluations.find((e) => e.candidateId === c.leadingCandidateId);
  const leaderTitle = ws.bundle.candidates.find((x) => x.id === c.leadingCandidateId)?.title;
  const total = ws.bundle.members.length;
  const stateStyle = {
    strong: "text-resolved",
    leaning: "text-constrained",
    gathering: "text-ink-2",
    split: "text-warn",
    objection: "text-blocked",
    no_options: "text-ink-3",
  }[c.state];
  return (
    <div className="border-t-2 border-ink px-4 py-4" data-testid="consensus" data-state={c.state}>
      <p className="text-[0.8rem] font-semibold text-ink-3">Consensus</p>
      <p className={cn("mt-0.5 text-[1.15rem] font-bold", stateStyle)}>{c.label}</p>
      {leader && leaderTitle ? (
        <>
          <p className="mt-0.5 text-sm text-ink-2">
            On <span className="font-semibold text-ink">{leaderTitle}</span> · {leader.consensus.respondents}/{total} reacted
          </p>
          <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={(Object.keys(REACTION_LABELS) as ReactionKind[]).map((k) => `${REACTION_LABELS[k]}: ${leader.consensus.counts[k]}`).join(", ")}>
            {(Object.keys(BAR_COLORS) as ReactionKind[]).map((k) =>
              leader.consensus.counts[k] ? <span key={k} style={{ width: `${(leader.consensus.counts[k] / total) * 100}%`, background: BAR_COLORS[k] }} /> : null,
            )}
          </div>
        </>
      ) : null}
      {c.waitingOn.length && c.state !== "no_options" ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <span className="flex -space-x-1.5">
            {c.waitingOn.slice(0, 5).map((id) => {
              const m = ws.memberById.get(id);
              return m ? <Avatar key={id} name={m.display_name} color={m.color} size={22} ring /> : null;
            })}
          </span>
          haven&apos;t weighed in
        </div>
      ) : null}
      <p className="mt-3 text-xs text-ink-3">Based on reactions so far — a read on alignment, not a vote count.</p>
    </div>
  );
}
