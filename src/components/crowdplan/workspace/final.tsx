"use client";

import { CalendarCheck2, ExternalLink, Flag, Undo2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { finalizeAction, reopenAction } from "@/app/actions/decide";
import type { CandidateStatus } from "@/domain/types";
import { Avatar, Button, ErrorNote, Sheet, Textarea } from "@/components/ui/primitives";
import { useWorkspace } from "./context";

const PlanMap = dynamic(() => import("./map").then((m) => m.PlanMap), { ssr: false });

export function FinalizeButton({ candidateId, status }: { candidateId: string; status: CandidateStatus }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const e = ws.evaluation.evaluations.find((x) => x.candidateId === candidateId);
  const title = ws.bundle.candidates.find((c) => c.id === candidateId)?.title;
  if (ws.flags.demo) return null;
  return (
    <>
      <Button size="sm" variant={status === "FEASIBLE" ? "primary" : "secondary"} onClick={() => setOpen(true)} data-testid="finalize-open">
        <Flag className="size-4" aria-hidden="true" /> Finalize
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Finalize ${title}?`}>
        <div className="space-y-4">
          <p className="text-ink-2">Everyone in the plan sees the final details. CrowdPlan doesn&apos;t book, reserve or pay for anything — you&apos;ll get links to do that yourself.</p>
          {status === "INFEASIBLE" && e ? (
            <div className="rounded-xl border-2 border-blocked/50 bg-blocked/6 p-3 text-sm">
              <p className="font-semibold text-blocked">This option still breaks a hard requirement:</p>
              <ul className="mt-1 list-disc pl-5">
                {e.explanation.hardViolations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--blocked)]" checked={ack} onChange={(ev) => setAck(ev.target.checked)} />
                Finalize anyway — the group has agreed to this exception
              </label>
            </div>
          ) : status === "UNVERIFIED" && e ? (
            <p className="rounded-xl border border-warn/60 bg-warn/6 p-3 text-sm">Some details are unverified: {e.explanation.unknowns.join("; ")}.</p>
          ) : null}
          <label className="block">
            <span className="text-sm font-semibold">Notes for everyone (optional)</span>
            <Textarea className="mt-1.5" rows={3} maxLength={2000} value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Meet at the front entrance. Jake is driving." />
          </label>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button
            loading={pending}
            disabled={status === "INFEASIBLE" && !ack}
            data-testid="finalize-confirm"
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await finalizeAction({ planId: ws.bundle.plan.id, candidateId, expectedVersion: ws.bundle.plan.version, notes, acknowledgeBlockers: ack });
                if (!r.ok) {
                  setError(r.error);
                  await ws.refresh();
                  return;
                }
                await ws.refresh();
                setOpen(false);
              })
            }
          >
            Finalize plan
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function FinalPlanView() {
  const ws = useWorkspace();
  const { plan } = ws.bundle;
  const snap = plan.final_snapshot;
  const [pending, start] = useTransition();
  const cand = ws.bundle.candidates.find((c) => c.id === plan.finalized_candidate_id);
  if (!snap) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24" data-testid="final-plan">
      <div className="rounded-[1.6rem] border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_var(--ink)] sm:p-7">
        <p className="flex items-center gap-2 text-sm font-semibold text-resolved">
          <CalendarCheck2 className="size-4" aria-hidden="true" /> It&apos;s set
        </p>
        <h2 className="t-display mt-2 break-words" data-testid="final-title">
          {snap.candidateTitle}
        </h2>
        {snap.when ? (
          <p className="mt-3 text-xl font-bold">
            <span className="highlighter rounded px-1.5 py-0.5">{snap.when}</span>
          </p>
        ) : null}
        {plan.final_notes ? <p className="mt-4 rounded-xl bg-surface-2 p-3 whitespace-pre-line">{plan.final_notes}</p> : null}

        <h3 className="t-heading mt-6">Who&apos;s going</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {snap.participants.map((p) => (
            <li key={p.name} className="flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-sm font-semibold">
              <Avatar name={p.name} color={p.color} size={24} />
              {p.name}
              {p.cost ? <span className="font-normal text-ink-2">· {p.cost}</span> : null}
            </li>
          ))}
        </ul>

        {snap.facts.length ? (
          <>
            <h3 className="t-heading mt-6">Details</h3>
            <dl className="mt-2 divide-y divide-rule">
              {snap.facts.map((f, i) => (
                <div key={i} className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-sm font-semibold text-ink-2">{f.label}</dt>
                  <dd>
                    {f.value}
                    <span className="block text-xs text-ink-3">{f.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        {cand?.lat != null && cand.lng != null ? (
          <div className="mt-6">
            <PlanMap candidates={[cand]} evaluations={[]} compact />
          </div>
        ) : null}

        {snap.links.length ? (
          <>
            <h3 className="t-heading mt-6">Links</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {snap.links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-xl border border-rule px-3 py-2 text-sm font-semibold hover:border-ink-3">
                    <ExternalLink className="size-4" aria-hidden="true" /> {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-6 text-xs text-ink-3">CrowdPlan doesn&apos;t book or pay for anything.{snap.links.length ? " Use the links above to reserve on your own." : ""}</p>

        {snap.blockers.length ? (
          <p className="mt-6 rounded-xl border border-blocked/40 bg-blocked/6 p-3 text-sm">
            <span className="font-semibold text-blocked">Finalized with a known exception: </span>
            {snap.blockers.join("; ")}
          </p>
        ) : null}
        <p className="mt-6 text-xs text-ink-3">
          Finalized by {snap.finalizedBy}
          {plan.finalized_at ? ` on ${new Date(plan.finalized_at).toLocaleString()}` : ""}.
        </p>
      </div>
      {ws.isOrganizer && !ws.flags.demo ? (
        <Button variant="ghost" className="mt-4" loading={pending} onClick={() => start(async () => { await reopenAction(plan.id); await ws.refresh(); })}>
          <Undo2 className="size-4" aria-hidden="true" /> Reopen planning
        </Button>
      ) : null}
    </div>
  );
}
