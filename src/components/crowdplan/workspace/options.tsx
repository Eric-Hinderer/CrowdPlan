"use client";

import { AlertTriangle, Check, CircleHelp, ExternalLink, Map as MapIcon, MapPin, Plane, Plus, Search, Sparkles, Star, Wand2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import { answerProposalAction, decideProposalAction, makeThisWorkAction, runSearchAction } from "@/app/actions/decide";
import { confirmObjectionConstraintAction, markCheckedAction, reactAction } from "@/app/actions/participation";
import { addCandidateAction, updatePlanSettingsAction, withdrawCandidateAction } from "@/app/actions/plans";
import { OBJECTION_REASONS, REACTION_LABELS, type ObjectionDiagnosis } from "@/domain/consensus";
import { formatMoney, formatMoneyRange } from "@/domain/money";
import type { RepairResult } from "@/domain/repair";
import { formatClockShort, formatDay } from "@/domain/time";
import type { CandidateEvaluation, ObjectionReason, ReactionKind } from "@/domain/types";
import { Avatar, Button, EmptyState, ErrorNote, Field, Input, Sheet, cn } from "@/components/ui/primitives";
import type { CandidateRow, ComponentRow, ProposalRow } from "@/lib/plan-data";
import { SourceBadge, relativeTime } from "../stamps";
import { nameOf, useWorkspace } from "./context";
import { FinalizeButton } from "./final";

const PlanMap = dynamic(() => import("./map").then((m) => m.PlanMap), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-2xl bg-surface-2" /> });

const REACTIONS: Array<{ id: ReactionKind; emoji: string }> = [
  { id: "love", emoji: "😍" },
  { id: "works", emoji: "👍" },
  { id: "acceptable", emoji: "🙂" },
  { id: "rather_not", emoji: "😕" },
  { id: "cant", emoji: "🚫" },
];

export function OptionsView() {
  const ws = useWorkspace();
  const [showMap, setShowMap] = useState(false);
  const byId = useMemo(() => new Map(ws.bundle.candidates.map((c) => [c.id, c])), [ws.bundle.candidates]);
  const evals = ws.evaluation.evaluations;
  const feasible = evals.filter((e) => e.status === "FEASIBLE");
  const unverified = evals.filter((e) => e.status === "UNVERIFIED");
  const infeasible = evals.filter((e) => e.status === "INFEASIBLE");
  const withdrawn = ws.bundle.candidates.filter((c) => c.status === "withdrawn");
  const located = ws.bundle.candidates.filter((c) => c.status === "active" && c.lat != null && c.lng != null);

  return (
    <div className="space-y-8" data-testid="options-view">
      <OptionsToolbar onToggleMap={located.length ? () => setShowMap((v) => !v) : undefined} showMap={showMap} />
      {showMap ? <PlanMap candidates={located} evaluations={evals} /> : null}
      {evals.length === 0 ? (
        <EmptyState title={ws.bundle.plan.mode === "shortlist" ? "Add the places you're choosing between" : ws.bundle.plan.kind === "travel" ? "No trips to compare yet" : "No options yet"}>
          {ws.bundle.plan.kind === "travel"
            ? "Once people share their dates, the organizer can search flights and hotels that fit."
            : ws.bundle.plan.mode === "criteria" || ws.bundle.plan.mode === "discovery"
              ? "Once people share when they're free, CrowdPlan searches inside your limits. You can also add a place by name or link."
              : "Add a place by name or paste a link."}
        </EmptyState>
      ) : null}
      {feasible.length ? (
        <Group title="Works for everyone" hint="Ranked by how well it fits the whole group — including the least-happy person." testId="group-feasible">
          {feasible.map((e) => (
            <CandidateCard key={e.candidateId} evaluation={e} candidate={byId.get(e.candidateId)!} />
          ))}
        </Group>
      ) : null}
      {unverified.length ? (
        <Group title="Needs checking" hint="Nothing rules these out, but some requirements can't be verified yet." testId="group-unverified">
          {unverified.map((e) => (
            <CandidateCard key={e.candidateId} evaluation={e} candidate={byId.get(e.candidateId)!} />
          ))}
        </Group>
      ) : null}
      {infeasible.length ? (
        <Group title="Not currently feasible" hint="Each breaks at least one hard requirement. Try Make This Work." testId="group-infeasible">
          {infeasible.map((e) => (
            <CandidateCard key={e.candidateId} evaluation={e} candidate={byId.get(e.candidateId)!} />
          ))}
        </Group>
      ) : null}
      {withdrawn.length && ws.isOrganizer ? (
        <details className="text-sm text-ink-2">
          <summary className="cursor-pointer font-semibold">Removed options ({withdrawn.length})</summary>
          <ul className="mt-2 space-y-1">
            {withdrawn.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                {c.title}
                <button className="font-semibold text-brand" onClick={async () => { await withdrawCandidateAction({ candidateId: c.id, restore: true }); await ws.refresh(); }}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Group({ title, hint, children, testId }: { title: string; hint: string; children: React.ReactNode; testId: string }) {
  return (
    <section data-testid={testId}>
      <h2 className="t-heading">{title}</h2>
      <p className="text-sm text-ink-2">{hint}</p>
      <ol className="mt-3 space-y-4">{children}</ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Toolbar: add, search (only when allowed), budget
// ---------------------------------------------------------------------------

function OptionsToolbar({ onToggleMap, showMap }: { onToggleMap?: () => void; showMap: boolean }) {
  const ws = useWorkspace();
  const { plan } = ws.bundle;
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canSearch = ws.isOrganizer && plan.status === "collecting" && !ws.flags.demo;
  const searchAllowed = plan.kind === "travel" || plan.mode === "criteria" || plan.mode === "discovery" || plan.discovery_enabled;

  const search = () =>
    start(async () => {
      setMessage(null);
      const r = await runSearchAction(plan.id);
      if (!r.ok) return setMessage({ kind: "error", text: r.error });
      const out = r.data;
      if (out.outcome === "ok") setMessage({ kind: "ok", text: out.added ? `Added ${out.added} option${out.added > 1 ? "s" : ""} from live search.` : "Search finished — nothing new that fits." });
      else setMessage({ kind: "error", text: out.message ?? "Search couldn't run." });
      await ws.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ws.me && plan.status === "collecting" ? (
          <Button variant="secondary" onClick={() => setAdding(true)} data-testid="add-option" disabled={ws.flags.demo}>
            <Plus className="size-4" aria-hidden="true" /> Add an option
          </Button>
        ) : null}
        {canSearch && searchAllowed ? (
          <Button onClick={search} loading={pending} disabled={!ws.flags.searchConfigured} data-testid="run-search">
            {plan.kind === "travel" ? <Plane className="size-4" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
            {plan.kind === "travel" ? "Search flights & hotels" : plan.mode === "discovery" ? "Find ideas" : "Find places that fit"}
          </Button>
        ) : null}
        {canSearch && !searchAllowed ? (
          <Button
            variant="ghost"
            onClick={() => start(async () => { await updatePlanSettingsAction({ planId: plan.id, discoveryEnabled: true }); await ws.refresh(); })}
            data-testid="enable-suggestions"
          >
            <Sparkles className="size-4" aria-hidden="true" /> Suggest more options
          </Button>
        ) : null}
        {onToggleMap ? (
          <Button variant="ghost" onClick={onToggleMap} aria-pressed={showMap}>
            <MapIcon className="size-4" aria-hidden="true" /> {showMap ? "Hide map" : "Map"}
          </Button>
        ) : null}
      </div>
      {canSearch && searchAllowed ? (
        <p className="text-xs text-ink-3" data-testid="search-budget">
          {ws.flags.searchConfigured ? `${plan.searches_used} of ${plan.search_budget} live searches used on this plan. Results are cached and reused.` : "Live search isn't configured on this server — add options by name or link."}
        </p>
      ) : null}
      {message ? (
        message.kind === "error" ? <ErrorNote>{message.text}</ErrorNote> : <p role="status" className="text-sm text-resolved">{message.text}</p>
      ) : null}
      <AddCandidateSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddCandidateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet open={open} onClose={onClose} title="Add an option">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await addCandidateAction({ planId: ws.bundle.plan.id, title: title || undefined, url: url || undefined, priceMax: price ? Number(price) : undefined });
            if (!r.ok) return setError(r.error);
            setTitle("");
            setUrl("");
            setPrice("");
            await ws.refresh();
            onClose();
          });
        }}
      >
        <Field label="Name" htmlFor="cand-title" hint="A place, event, or idea.">
          <Input id="cand-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Charleston's" />
        </Field>
        <Field label="Link (optional)" htmlFor="cand-url" hint="Google Maps, Yelp, or the place's website. CrowdPlan never opens it on your behalf.">
          <Input id="cand-url" value={url} maxLength={1000} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <Field label="Price per person, if you know it" htmlFor="cand-price">
          <Input id="cand-price" type="number" inputMode="numeric" min={1} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$" />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button type="submit" loading={pending} disabled={!title.trim() && !url.trim()} data-testid="add-option-submit">
          Add option
        </Button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Candidate card
// ---------------------------------------------------------------------------

function CandidateCard({ evaluation: e, candidate: c }: { evaluation: CandidateEvaluation; candidate: CandidateRow }) {
  const ws = useWorkspace();
  const reduce = useReducedMotion();
  const tz = ws.tz;
  const proposals = ws.bundle.proposals.filter((p) => p.candidate_id === c.id && p.status === "open");
  const components = ws.bundle.components.filter((x) => x.candidate_id === c.id);
  const statusTone = e.status === "FEASIBLE" ? "border-rule" : e.status === "UNVERIFIED" ? "border-warn/50" : "border-blocked/40";
  const cost = c.type === "travel_package" ? null : c.cost ? formatMoneyRange(c.cost.min, c.cost.max) + (c.cost.kind === "price_level" ? " est." : "") : "Price not verified";

  return (
    <motion.li layout={!reduce} transition={{ type: "spring", stiffness: 420, damping: 38 }} className={cn("rounded-2xl border-2 bg-surface", statusTone)} data-testid="candidate-card" data-candidate-title={c.title} data-status={e.status} data-rank={e.rank ?? ""}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {e.rank ? <span className="grid size-7 place-items-center rounded-full bg-ink text-sm font-bold text-paper" aria-label={`Rank ${e.rank}`}>{e.rank}</span> : null}
              <h3 className="text-lg font-bold break-words">{c.title}</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
              <SourceBadge kind={c.source_kind} fetchedAt={c.fetched_at} provider={c.provider} />
              {c.categories[0] ? <span>{c.categories[0]}</span> : null}
              {c.rating != null ? (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="size-3.5 fill-current text-warn" aria-hidden="true" /> {Number(c.rating).toFixed(1)}
                  {c.review_count ? <span className="text-ink-3"> ({c.review_count.toLocaleString("en-US")})</span> : null}
                </span>
              ) : null}
              {cost ? <span className={cn(!c.cost && "text-ink-3")}>{cost}</span> : null}
              {c.starts_at ? <span>{formatDay(Date.parse(c.starts_at), tz)} {formatClockShort(Date.parse(c.starts_at), tz)}</span> : null}
            </div>
            {c.address ? (
              <p className="mt-1 flex items-center gap-1 text-sm text-ink-3">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" /> {c.address}
              </p>
            ) : null}
            {c.enrichment_status === "pending" ? <p className="mt-1 text-xs text-ink-3">Looking up details…</p> : null}
            {c.enrichment_status === "not_found" ? <p className="mt-1 text-xs text-ink-3">No live listing matched this name — details are as entered.</p> : null}
          </div>
          {e.status === "FEASIBLE" ? <FitMeter e={e} /> : e.status === "UNVERIFIED" ? <span className="stamp border-[1.5px] border-dashed border-warn text-warn">Unverified</span> : <span className="stamp stamp-blocked">Not feasible</span>}
        </div>

        {c.type === "travel_package" ? <TravelBreakdown candidate={c} components={components} e={e} /> : null}
        <Explanation e={e} />
        <PeopleStrip e={e} />
        {ws.me && ws.bundle.plan.status === "collecting" ? <ReactionBar candidate={c} /> : null}
        <ConsensusMini e={e} />
        {proposals.length ? <Proposals proposals={proposals} /> : null}
        <CardActions c={c} e={e} />
      </div>
    </motion.li>
  );
}

function FitMeter({ e }: { e: CandidateEvaluation }) {
  const fit = e.metrics.groupFit;
  return (
    <div className="shrink-0 text-right" title={`Average ${e.metrics.averageSatisfaction}, lowest ${e.metrics.minimumSatisfaction}. A model estimate, not a measurement.`}>
      <p className="text-2xl leading-none font-bold" data-testid="group-fit">
        {fit}
        <span className="text-sm font-semibold text-ink-3">%</span>
      </p>
      <p className="text-xs text-ink-3">group fit</p>
      <p className="text-xs text-ink-3">lowest {e.metrics.minimumSatisfaction}</p>
    </div>
  );
}

function Explanation({ e }: { e: CandidateEvaluation }) {
  const { positives, compromises, hardViolations, unknowns } = e.explanation;
  return (
    <div className="mt-3 grid gap-1 text-sm" data-testid="explanation">
      {hardViolations.map((t) => (
        <p key={t} className="flex items-start gap-2 font-semibold text-blocked" data-testid="hard-violation">
          <X className="mt-0.5 size-4 shrink-0" aria-label="Hard violation" /> {t}
        </p>
      ))}
      {positives.slice(0, 5).map((t) => (
        <p key={t} className="flex items-start gap-2 text-ink">
          <Check className="mt-0.5 size-4 shrink-0 text-resolved" aria-label="Positive" /> {t}
        </p>
      ))}
      {compromises.map((t) => (
        <p key={t} className="flex items-start gap-2 text-ink-2">
          <span className="mt-[-1px] w-4 shrink-0 text-center font-bold text-warn" aria-label="Compromise">~</span> {t}
        </p>
      ))}
      {unknowns.map((t) => (
        <p key={t} className="flex items-start gap-2 text-ink-3">
          <CircleHelp className="mt-0.5 size-4 shrink-0" aria-label="Unknown" /> {t}
        </p>
      ))}
    </div>
  );
}

function PeopleStrip({ e }: { e: CandidateEvaluation }) {
  const ws = useWorkspace();
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Who this works for">
      {e.members.map((m) => {
        const member = ws.memberById.get(m.memberId);
        if (!member) return null;
        const Icon = m.feasibility === "PASS" ? Check : m.feasibility === "FAIL" ? X : CircleHelp;
        const tone = m.feasibility === "PASS" ? "text-resolved" : m.feasibility === "FAIL" ? "text-blocked" : "text-ink-3";
        return (
          <li key={m.memberId} className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-2 pl-0.5 text-xs" title={m.hard.filter((h) => h.result !== "PASS").map((h) => h.message).join("; ") || "All requirements met"}>
            <Avatar name={member.display_name} color={member.color} size={20} />
            <span className="font-semibold">{member.display_name}</span>
            <Icon className={cn("size-3.5", tone)} aria-label={m.feasibility === "PASS" ? "works" : m.feasibility === "FAIL" ? "blocked" : "unverified"} />
          </li>
        );
      })}
    </ul>
  );
}

function ConsensusMini({ e }: { e: CandidateEvaluation }) {
  const ws = useWorkspace();
  if (!e.consensus.respondents) return null;
  const reactions = ws.bundle.reactions.filter((r) => r.candidateId === e.candidateId);
  return (
    <p className="mt-2 text-xs text-ink-2" data-testid="reaction-summary">
      {reactions.map((r) => `${nameOf(ws, r.memberId)}: ${REACTION_LABELS[r.reaction]}${r.reaction === "cant" && r.reason ? ` (${OBJECTION_REASONS[r.reason as ObjectionReason].toLowerCase()})` : ""}`).join(" · ")}
    </p>
  );
}

function ReactionBar({ candidate }: { candidate: CandidateRow }) {
  const ws = useWorkspace();
  const reduce = useReducedMotion();
  const mine = ws.bundle.reactions.find((r) => r.candidateId === candidate.id && r.memberId === ws.me!.id);
  const [asking, setAsking] = useState(false);
  const [diagnosis, setDiagnosis] = useState<ObjectionDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const send = (reaction: ReactionKind | null, reason?: ObjectionReason, note?: string) => {
    const prev = ws.bundle.reactions;
    // Optimistic: show my reaction immediately; the server + realtime reconcile.
    ws.patch((b) => ({
      ...b,
      reactions: [...b.reactions.filter((r) => !(r.candidateId === candidate.id && r.memberId === ws.me!.id)), ...(reaction ? [{ candidateId: candidate.id, memberId: ws.me!.id, reaction, reason: reason ?? null, note: note ?? null }] : [])],
    }));
    if (ws.flags.demo) return;
    start(async () => {
      setError(null);
      const r = await reactAction({ planId: ws.bundle.plan.id, candidateId: candidate.id, reaction, reason: reason ?? null, note: note ?? null });
      if (!r.ok) {
        ws.patch((b) => ({ ...b, reactions: prev })); // roll back
        setError(r.error);
        return;
      }
      if (r.data.diagnosis) setDiagnosis(r.data.diagnosis);
      await ws.refresh();
    });
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Your reaction to ${candidate.title}`}>
        {REACTIONS.map((r) => {
          const on = mine?.reaction === r.id;
          return (
            <motion.button
              key={r.id}
              whileTap={reduce ? undefined : { scale: 0.9 }}
              animate={on && !reduce ? { scale: [1, 1.12, 1] } : { scale: 1 }}
              transition={{ duration: 0.25 }}
              aria-pressed={on}
              data-testid={`react-${r.id}`}
              onClick={() => (r.id === "cant" ? setAsking(true) : send(on ? null : r.id))}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-sm font-semibold transition-colors",
                on ? (r.id === "cant" ? "border-blocked bg-blocked text-white" : r.id === "rather_not" ? "border-warn bg-warn text-white" : "border-ink bg-ink text-paper") : "border-rule hover:border-ink-3",
              )}
            >
              <span aria-hidden="true">{r.emoji}</span>
              {REACTION_LABELS[r.id]}
            </motion.button>
          );
        })}
      </div>
      {error ? <div className="mt-2"><ErrorNote>{error}</ErrorNote></div> : null}
      <CantSheet
        open={asking}
        title={candidate.title}
        onClose={() => setAsking(false)}
        onPick={(reason, note) => {
          setAsking(false);
          send("cant", reason, note);
        }}
      />
      {diagnosis ? <DiagnosisSheet diagnosis={diagnosis} onClose={() => setDiagnosis(null)} /> : null}
    </div>
  );
}

function CantSheet({ open, title, onClose, onPick }: { open: boolean; title: string; onClose: () => void; onPick: (r: ObjectionReason, note?: string) => void }) {
  const [reason, setReason] = useState<ObjectionReason | null>(null);
  const [note, setNote] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title={`Why can't you do ${title}?`}>
      <div className="space-y-3">
        <p className="text-ink-2">Knowing why helps CrowdPlan find something that works for you.</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(OBJECTION_REASONS) as ObjectionReason[]).map((r) => (
            <button key={r} aria-pressed={reason === r} onClick={() => setReason(r)} data-testid={`reason-${r}`} className={cn("rounded-xl border px-3 py-2.5 text-left font-semibold", reason === r ? "border-brand bg-brand/8" : "border-rule")}>
              {OBJECTION_REASONS[r]}
            </button>
          ))}
        </div>
        <Input aria-label="Add a detail (optional)" placeholder="Add a detail (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button disabled={!reason} onClick={() => reason && onPick(reason, note || undefined)} data-testid="cant-submit">
          Send
        </Button>
      </div>
    </Sheet>
  );
}

function DiagnosisSheet({ diagnosis, onClose }: { diagnosis: ObjectionDiagnosis; onClose: () => void }) {
  const ws = useWorkspace();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={diagnosis.alreadyExplained ? "Already accounted for" : "Should this be a rule?"}>
      <div className="space-y-3" data-testid="objection-diagnosis">
        <p className="text-ink-2">{diagnosis.question}</p>
        {diagnosis.proposal ? (
          <>
            <p className="rounded-xl border border-rule bg-surface-2 p-3 font-semibold">{diagnosis.proposal.prompt}</p>
            <p className="text-sm text-ink-3">If you confirm, every option is re-checked against it. Nothing changes if you don&apos;t.</p>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <div className="flex gap-2">
              <Button
                loading={pending}
                data-testid="confirm-objection"
                onClick={() =>
                  start(async () => {
                    const p = diagnosis.proposal!;
                    const r = await confirmObjectionConstraintAction({ planId: ws.bundle.plan.id, kind: p.kind, strength: p.strength, params: p.params, label: p.prompt.replace(/\?$/, "") });
                    if (!r.ok) return setError(r.error);
                    await ws.refresh();
                    onClose();
                  })
                }
              >
                Yes, make it a rule
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Just a reaction
              </Button>
            </div>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Got it
          </Button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Travel breakdown (per traveler, component provenance)
// ---------------------------------------------------------------------------

function TravelBreakdown({ candidate, components, e }: { candidate: CandidateRow; components: ComponentRow[]; e: CandidateEvaluation }) {
  const ws = useWorkspace();
  const tz = ws.tz;
  const hotel = components.find((x) => x.kind === "hotel" && x.is_selected);
  const local = components.find((x) => x.kind === "local_estimate" && x.is_selected);
  const attrs = candidate.attributes as { startDate?: string; endDate?: string; nights?: number };
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-rule" data-testid="travel-breakdown">
      {attrs.startDate ? <p className="border-b border-rule bg-surface-2 px-3 py-2 text-sm font-semibold">{attrs.nights} nights · {attrs.startDate} → {attrs.endDate}</p> : null}
      <ul className="divide-y divide-rule">
        {e.members.map((m) => {
          const member = ws.memberById.get(m.memberId);
          const flights = components.filter((x) => x.kind === "flight" && x.member_id === m.memberId && x.is_selected).sort((a, b) => ((a.data.direction === "outbound") === (b.data.direction === "outbound") ? 0 : a.data.direction === "outbound" ? -1 : 1));
          return (
            <li key={m.memberId} className="px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  {member ? <Avatar name={member.display_name} color={member.color} size={20} /> : null}
                  {member?.display_name}
                </span>
                <span className="font-bold" data-testid="traveler-total">
                  {m.cost?.high != null ? formatMoney(m.cost.high) : m.cost?.low != null ? `${formatMoney(m.cost.low)}+ (incomplete)` : "Price not verified"}
                  {m.cost?.estimated ? <span className="ml-1 text-xs font-semibold text-warn">incl. estimates</span> : null}
                </span>
              </div>
              {flights.length === 0 ? <p className="mt-1 text-ink-3">No flights found yet</p> : null}
              {flights.map((f) => {
                const d = f.data as { direction?: string; departAt?: number; arriveAt?: number; stops?: number; tzAssumed?: boolean };
                return (
                  <p key={f.id} className="mt-1 flex flex-wrap items-center gap-x-2 text-ink-2">
                    <span className="font-semibold text-ink">{d.direction === "return" ? "Return" : "Out"}</span>
                    <span>{f.title}</span>
                    {d.departAt && d.arriveAt ? <span>{formatDay(d.departAt, tz)} {formatClockShort(d.departAt, tz)} → {formatClockShort(d.arriveAt, tz)}{d.tzAssumed ? "*" : ""}</span> : null}
                    <span>{d.stops ? `${d.stops} stop${d.stops > 1 ? "s" : ""}` : "nonstop"}</span>
                    <span className="font-semibold text-ink">{f.cost?.max != null ? formatMoney(f.cost.max) : "Price not verified"}</span>
                    <SourceBadge kind={f.source_kind} fetchedAt={f.fetched_at} provider={f.provider} />
                  </p>
                );
              })}
            </li>
          );
        })}
      </ul>
      <div className="space-y-1 border-t border-rule bg-surface-2/60 px-3 py-2.5 text-sm">
        {hotel ? (
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-semibold">Hotel</span> {hotel.title}
            {hotel.cost?.max != null ? <span>{formatMoney(hotel.cost.max)}/night · {String((hotel.data as { rooms?: number }).rooms ?? "")} rooms, split {e.members.length} ways</span> : <span className="text-ink-3">Price not verified</span>}
            <SourceBadge kind={hotel.source_kind} fetchedAt={hotel.fetched_at} provider={hotel.provider} />
          </p>
        ) : (
          <p className="text-ink-3">No hotel selected yet</p>
        )}
        {local ? (
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-semibold">Local costs</span> {local.title} <SourceBadge kind="estimate" />
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Make This Work + proposals
// ---------------------------------------------------------------------------

function CardActions({ c, e }: { c: CandidateRow; e: CandidateEvaluation }) {
  const ws = useWorkspace();
  const [result, setResult] = useState<RepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const collecting = ws.bundle.plan.status === "collecting";
  const needsWork = e.status !== "FEASIBLE";
  const dietaryUnknown = e.members.flatMap((m) => m.hard).find((h) => h.kind === "dietary" && h.result === "UNKNOWN");
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {needsWork && collecting && ws.me ? (
          <Button
            variant={e.status === "INFEASIBLE" ? "primary" : "secondary"}
            size="sm"
            loading={pending}
            data-testid="make-this-work"
            onClick={() =>
              start(async () => {
                setError(null);
                if (ws.flags.demo) {
                  const { makeThisWork } = await import("@/domain/repair");
                  setResult(makeThisWork(c.id, ws.input));
                  return;
                }
                const r = await makeThisWorkAction({ planId: ws.bundle.plan.id, candidateId: c.id });
                if (!r.ok) return setError(r.error);
                setResult(r.data);
                await ws.refresh();
              })
            }
          >
            <Wand2 className="size-4" aria-hidden="true" /> Make this work
          </Button>
        ) : null}
        {ws.isOrganizer && collecting && dietaryUnknown && !ws.flags.demo ? (
          <Button variant="ghost" size="sm" onClick={() => start(async () => { const restriction = (ws.input.constraints.find((x) => x.id === dietaryUnknown.constraintId)?.params as { restriction?: string })?.restriction ?? ""; await markCheckedAction({ candidateId: c.id, restriction }); await ws.refresh(); })}>
            Mark {String((ws.input.constraints.find((x) => x.id === dietaryUnknown.constraintId)?.params as { restriction?: string })?.restriction ?? "")} as checked
          </Button>
        ) : null}
        {ws.isOrganizer && collecting ? <FinalizeButton candidateId={c.id} status={e.status} /> : null}
        {c.source_url ? (
          <a href={c.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2">
            <ExternalLink className="size-4" aria-hidden="true" /> {c.provider?.includes("google_maps") ? "Maps" : "Link"}
          </a>
        ) : null}
        {ws.isOrganizer && collecting && !ws.flags.demo ? (
          <Button variant="ghost" size="sm" onClick={() => start(async () => { await withdrawCandidateAction({ candidateId: c.id }); await ws.refresh(); })}>
            Remove
          </Button>
        ) : null}
      </div>
      {error ? <div className="mt-2"><ErrorNote>{error}</ErrorNote></div> : null}
      {result ? <RepairPanel result={result} onClose={() => setResult(null)} /> : null}
    </div>
  );
}

function RepairPanel({ result, onClose }: { result: RepairResult; onClose: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="mt-3 rounded-xl border-2 border-brand/50 bg-brand/5 p-3.5" data-testid="repair-panel">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">Make this work</p>
        <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {result.blockers.length ? (
        <div className="mt-2 text-sm">
          <p className="font-semibold">What&apos;s in the way</p>
          <ul className="mt-1 space-y-0.5">
            {result.blockers.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-blocked">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {b.memberId ? `${nameOf(ws, b.memberId)}: ` : ""}
                {b.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.proposals.length && !ws.flags.demo ? (
        <p className="mt-2 text-sm text-ink-2">Proposal{result.proposals.length > 1 ? "s" : ""} added below for the group.</p>
      ) : result.noFixReason ? (
        <p className="mt-2 text-sm" data-testid="no-fix">{result.noFixReason}</p>
      ) : !result.blockers.length && !result.focusedQuestion ? (
        <p className="mt-2 text-sm text-resolved">This already works for everyone.</p>
      ) : null}
      {result.focusedQuestion ? (
        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm font-semibold" data-testid="focused-question">
          {result.focusedQuestion.text}
        </p>
      ) : null}
      {ws.flags.demo && result.proposals.length ? (
        <ul className="mt-2 space-y-2">
          {result.proposals.map((p, i) => (
            <li key={i} className="rounded-lg bg-surface p-3 text-sm">
              <p className="font-bold">{p.headline}</p>
              <p className="text-ink-2">{p.summary}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Proposals({ proposals }: { proposals: ProposalRow[] }) {
  const ws = useWorkspace();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 space-y-2" data-testid="proposals">
      {proposals.map((p) => {
        const payload = p.payload as { summary?: string; impacts?: Array<{ text: string }>; costDelta?: number; resultStatus?: string };
        const answers = ws.bundle.proposalAnswers.filter((a) => a.proposal_id === p.id);
        const mine = answers.find((a) => a.member_id === ws.me?.id);
        const yes = answers.filter((a) => a.answer === "yes").length;
        return (
          <div key={p.id} className="rounded-xl border-2 border-brand/50 bg-brand/5 p-3.5" data-testid="proposal">
            <p className="font-bold">{p.summary}</p>
            {payload.summary ? <p className="mt-0.5 text-sm text-ink-2">{payload.summary}</p> : null}
            {payload.impacts?.length ? (
              <ul className="mt-1.5 list-disc pl-5 text-sm text-ink-2">
                {payload.impacts.map((i, k) => (
                  <li key={k}>{i.text}</li>
                ))}
              </ul>
            ) : null}
            {p.kind === "question" ? <p className="mt-1.5 text-xs text-ink-3">{yes} of {ws.bundle.members.length} said yes{answers.length - yes ? ` · ${answers.length - yes} no` : ""}</p> : null}
            {error ? <div className="mt-2"><ErrorNote>{error}</ErrorNote></div> : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {p.kind === "question" && ws.me ? (
                <>
                  <Button size="sm" variant={mine?.answer === "yes" ? "primary" : "secondary"} onClick={() => start(async () => { const r = await answerProposalAction({ proposalId: p.id, answer: "yes" }); if (!r.ok) setError(r.error); await ws.refresh(); })}>
                    Works for me
                  </Button>
                  <Button size="sm" variant={mine?.answer === "no" ? "danger" : "secondary"} onClick={() => start(async () => { const r = await answerProposalAction({ proposalId: p.id, answer: "no" }); if (!r.ok) setError(r.error); await ws.refresh(); })}>
                    Doesn&apos;t work
                  </Button>
                </>
              ) : null}
              {ws.isOrganizer ? (
                <>
                  <Button size="sm" loading={pending} data-testid="apply-proposal" onClick={() => start(async () => { const r = await decideProposalAction({ proposalId: p.id, accept: true }); if (!r.ok) setError(r.error); await ws.refresh(); })}>
                    Apply change
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => start(async () => { await decideProposalAction({ proposalId: p.id, accept: false }); await ws.refresh(); })}>
                    Dismiss
                  </Button>
                </>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-ink-3">Proposed {relativeTime(p.created_at)}. Nothing changes until the organizer applies it.</p>
          </div>
        );
      })}
    </div>
  );
}
