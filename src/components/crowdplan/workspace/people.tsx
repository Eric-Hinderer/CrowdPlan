"use client";

import { Check, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import { describeConstraint } from "@/domain/constraints";
import { Avatar, EmptyState, cn } from "@/components/ui/primitives";
import { useWorkspace } from "./context";

export function PeopleView() {
  const ws = useWorkspace();
  const evals = ws.evaluation.evaluations.slice(0, 6);
  const titles = new Map(ws.bundle.candidates.map((c) => [c.id, c.title]));
  const [focus, setFocus] = useState<{ memberId: string; candidateId: string } | null>(null);
  const focusOutcome = focus ? evals.find((e) => e.candidateId === focus.candidateId)?.members.find((m) => m.memberId === focus.memberId) : null;

  return (
    <div className="space-y-10">
      <section aria-labelledby="matrix-heading" data-testid="constraint-matrix">
        <h2 id="matrix-heading" className="t-heading">
          Who is blocked by what
        </h2>
        <p className="text-sm text-ink-2">Every person&apos;s hard requirements checked against each option. Tap a cell for the reason.</p>
        {evals.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No options to check yet" />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-paper pb-2 text-left font-semibold text-ink-3">
                    Person
                  </th>
                  {evals.map((e) => (
                    <th key={e.candidateId} scope="col" className="max-w-[8rem] px-1 pb-2 text-center align-bottom font-semibold">
                      <span className="line-clamp-2">{titles.get(e.candidateId)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ws.bundle.members.map((m) => (
                  <tr key={m.id}>
                    <th scope="row" className="sticky left-0 border-t border-rule bg-paper py-2 pr-3 text-left font-semibold">
                      <span className="flex items-center gap-2">
                        <Avatar name={m.display_name} color={m.color} size={24} />
                        {m.display_name}
                      </span>
                    </th>
                    {evals.map((e) => {
                      const o = e.members.find((x) => x.memberId === m.id)!;
                      const softMiss = o.soft.some((s) => !s.met);
                      const state = o.feasibility === "FAIL" ? "fail" : o.feasibility === "UNKNOWN" ? "unknown" : softMiss ? "soft" : "pass";
                      const Icon = state === "fail" ? X : state === "unknown" ? CircleHelp : Check;
                      const selected = focus?.memberId === m.id && focus.candidateId === e.candidateId;
                      return (
                        <td key={e.candidateId} className="border-t border-rule px-1 py-1.5 text-center">
                          <button
                            onClick={() => setFocus(selected ? null : { memberId: m.id, candidateId: e.candidateId })}
                            aria-label={`${m.display_name} and ${titles.get(e.candidateId)}: ${state === "fail" ? "blocked" : state === "unknown" ? "unverified" : state === "soft" ? "works with a compromise" : "works"}`}
                            data-state={state}
                            className={cn(
                              "mx-auto grid size-9 place-items-center rounded-lg",
                              state === "fail" && "stamp-blocked",
                              state === "unknown" && "border-[1.5px] border-dashed border-ink-3 text-ink-3",
                              state === "soft" && "bg-warn/15 text-warn",
                              state === "pass" && "bg-resolved/15 text-resolved",
                              selected && "ring-2 ring-ink",
                            )}
                          >
                            {state === "soft" ? <span className="font-bold">~</span> : <Icon className="size-4" aria-hidden="true" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {focusOutcome ? (
          <div className="mt-3 rounded-xl border border-rule bg-surface p-3 text-sm" role="status">
            <p className="font-semibold">
              {ws.memberById.get(focus!.memberId)?.display_name} · {titles.get(focus!.candidateId)}
            </p>
            <ul className="mt-1 space-y-0.5">
              {focusOutcome.hard.map((h, i) => (
                <li key={i} className={cn(h.result === "FAIL" ? "text-blocked" : h.result === "UNKNOWN" ? "text-ink-3" : "text-ink-2")}>
                  {h.result === "PASS" ? "✓" : h.result === "FAIL" ? "✕" : "?"} {h.message}
                  {h.estimated ? " (estimate)" : ""}
                </li>
              ))}
              {focusOutcome.soft.map((s, i) => (
                <li key={`s${i}`} className={s.met ? "text-ink-2" : "text-warn"}>
                  {s.met ? "✓" : "~"} {s.message}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-ink-3">Satisfaction estimate {focusOutcome.satisfaction}{focusOutcome.lowConfidence ? " (little data yet)" : ""}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="people-heading">
        <h2 id="people-heading" className="t-heading">
          Everyone&apos;s requirements
        </h2>
        <ul className="mt-3 space-y-3">
          {ws.bundle.members.map((m) => {
            const cs = ws.bundle.constraints.filter((c) => c.member_id === m.id && c.status === "active");
            const responded = !!m.responded_at || ws.bundle.availability.some((w) => w.memberId === m.id);
            const open = ws.bundle.clarifications.filter((c) => c.member_id === m.id && c.status === "open").length;
            return (
              <li key={m.id} className="rounded-2xl border border-rule bg-surface p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <Avatar name={m.display_name} color={m.color} size={28} />
                    {m.display_name}
                    {m.role === "organizer" ? <span className="text-xs font-normal text-ink-3">organizer</span> : null}
                  </span>
                  <span className={cn("text-sm", responded ? "text-resolved" : "text-ink-3")}>{responded ? "Responded" : "Waiting"}</span>
                </div>
                {cs.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {cs.map((c) => (
                      <li key={c.id} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", c.strength === "hard" ? "bg-ink text-paper" : "border border-rule text-ink-2")}>
                        {c.label ?? describeConstraint(c)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {open ? <p className="mt-2 text-xs text-warn">{open} answer{open > 1 ? "s" : ""} waiting on clarification — not applied yet.</p> : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
