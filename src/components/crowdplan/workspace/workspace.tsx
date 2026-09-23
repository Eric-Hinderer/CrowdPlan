"use client";

import { CalendarDays, ListChecks, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluatePlan } from "@/domain/evaluate";
import { cn } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { loadPlanBundle, toPlanInput, type PlanBundle } from "@/lib/plan-data";
import { WhenView } from "./availability";
import { ResolutionBoard } from "./board";
import { WorkspaceContext, type WorkspaceFlags, type WorkspaceValue } from "./context";
import { FinalPlanView } from "./final";
import { PlanHeader } from "./header";
import { OptionsView } from "./options";
import { PeopleView } from "./people";
import { YourPart } from "./respond";

type Tab = "options" | "when" | "people";

export function PlanWorkspace({ initial, userId, flags, welcome }: { initial: PlanBundle; userId: string | null; flags: WorkspaceFlags; welcome?: boolean }) {
  const [bundle, setBundle] = useState(initial);
  const [connection, setConnection] = useState<WorkspaceValue["connection"]>(flags.demo ? "live" : "connecting");
  const [tab, setTab] = useState<Tab>(initial.plan.kind === "travel" || initial.candidates.length ? "options" : "when");
  const versionRef = useRef(initial.plan.version);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (flags.demo) return;
    if (inflight.current) {
      again.current = true; // coalesce bursts of realtime events
      return inflight.current;
    }
    inflight.current = (async () => {
      try {
        do {
          again.current = false;
          const next = await loadPlanBundle(getBrowserSupabase(), initial.plan.id, userId);
          versionRef.current = next.plan.version;
          setBundle(next);
        } while (again.current);
      } catch (e) {
        console.error("[workspace] refresh failed", e);
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, [flags.demo, initial.plan.id, userId]);

  useEffect(() => {
    if (flags.demo) return;
    const supabase = getBrowserSupabase();
    let wasDown = false;
    const channel = supabase
      .channel(`plan:${initial.plan.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "plans", filter: `id=eq.${initial.plan.id}` }, (payload: { new: Record<string, unknown> }) => {
        const v = Number((payload.new as { version?: number }).version ?? 0);
        // Ignore duplicate/out-of-order events: only newer versions trigger a refetch.
        if (v > versionRef.current) void refresh();
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          setConnection("live");
          if (wasDown) void refresh(); // reconnect: converge to the latest state
          wasDown = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("offline");
          wasDown = true;
        }
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [flags.demo, initial.plan.id, refresh]);

  const input = useMemo(() => toPlanInput(bundle, bundle.loadedAt), [bundle]);
  const evaluation = useMemo(() => evaluatePlan(input), [input]);
  const value: WorkspaceValue = useMemo(
    () => ({
      bundle,
      input,
      evaluation,
      me: bundle.me,
      isOrganizer: bundle.isOrganizer,
      tz: bundle.plan.timezone,
      memberById: new Map(bundle.members.map((m) => [m.id, m])),
      flags,
      refresh,
      patch: (fn) => setBundle((b) => ({ ...fn(b), loadedAt: b.loadedAt })),
      demoMutate: flags.demo ? (fn) => setBundle((b) => ({ ...fn(b), loadedAt: b.loadedAt })) : undefined,
      connection,
    }),
    [bundle, input, evaluation, flags, refresh, connection],
  );

  const finalized = bundle.plan.status === "finalized";
  const tabs: Array<{ id: Tab; label: string; Icon: typeof Users }> = [
    { id: "options", label: bundle.plan.kind === "travel" ? "Trips" : "Options", Icon: ListChecks },
    { id: "when", label: "When", Icon: CalendarDays },
    { id: "people", label: "People", Icon: Users },
  ];

  return (
    <WorkspaceContext.Provider value={value}>
      <PlanHeader welcome={welcome} />
      {finalized ? (
        <FinalPlanView />
      ) : (
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-24 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:gap-10">
          <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <ResolutionBoard />
            <YourPart />
          </aside>
          <section className="min-w-0">
            <div role="tablist" aria-label="Plan views" className="sticky top-14 z-20 -mx-4 mb-5 flex gap-1 border-b border-rule bg-paper/95 px-4 pt-2 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:px-0">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-[3px] px-3 py-2.5 font-semibold transition",
                    tab === t.id ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  <t.Icon className="size-4" aria-hidden="true" />
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "options" ? <OptionsView /> : tab === "when" ? <WhenView /> : <PeopleView />}
            </div>
          </section>
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
