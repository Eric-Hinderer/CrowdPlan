"use client";

import { Link2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPlanAction, interpretPlanAction } from "@/app/actions/plans";
import { defaultValueFor, DimensionRow, displayFor } from "@/components/crowdplan/dimension-editor";
import { Button, ErrorNote, Field, Input, Textarea, cn } from "@/components/ui/primitives";
import type { DimensionDraft, PlanExtraction } from "@/domain/interpretation/schema";
import type { PlanKind, PlanMode } from "@/domain/types";

const MODES: Array<{ id: PlanMode; title: string; body: string }> = [
  { id: "fixed", title: "We know where", body: "The place is settled. Work out the rest." },
  { id: "criteria", title: "We know what we want", body: "Constraints first, then search inside them." },
  { id: "shortlist", title: "We have a few options", body: "Compare only the places we name." },
  { id: "discovery", title: "Give us ideas", body: "Suggest options that fit everyone." },
];

const KINDS: Array<{ id: PlanKind; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "dinner", label: "Food & drinks" },
  { id: "travel", label: "Trip" },
];

const OPTIONAL_DIMS: Record<PlanKind, Array<{ key: string; label: string }>> = {
  activity: [
    { key: "time", label: "Time" },
    { key: "budget", label: "Budget" },
    { key: "area", label: "Area" },
  ],
  dinner: [
    { key: "time", label: "Time" },
    { key: "cuisine", label: "Cuisine" },
    { key: "area", label: "Area" },
    { key: "budget", label: "Budget" },
  ],
  travel: [
    { key: "nights", label: "Length" },
    { key: "budget", label: "Budget" },
  ],
};

export function CreateFlow({ initialText, defaultName, provider, searchConfigured }: { initialText: string; defaultName: string; provider: string; searchConfigured: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [draft, setDraft] = useState<PlanExtraction | null>(null);
  const [resolved, setResolved] = useState<Record<number, number>>({});
  const [shortlist, setShortlist] = useState<Array<{ title: string; url: string }>>([]);
  const [discovery, setDiscovery] = useState(false);
  const [name, setName] = useState(defaultName);
  const [location, setLocation] = useState("");
  const [decideBy, setDecideBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [interpreting, startInterpret] = useTransition();
  const [creating, startCreate] = useTransition();
  const [usedProvider, setUsedProvider] = useState(provider);
  const autoRan = useRef(false);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago", []);
  const today = useMemo(() => new Date().toLocaleDateString("en-CA", { timeZone: tz }), [tz]);

  const interpret = (value: string) =>
    startInterpret(async () => {
      setError(null);
      const r = await interpretPlanAction({ text: value, timezone: tz });
      if (!r.ok) return setError(r.error);
      const x = r.data.extraction;
      setUsedProvider(r.data.provider);
      setDraft(x);
      setResolved({});
      setShortlist(x.shortlist.length ? x.shortlist.map((t) => ({ title: t, url: "" })) : x.mode === "shortlist" ? [{ title: "", url: "" }, { title: "", url: "" }, { title: "", url: "" }] : []);
      setDiscovery(x.mode === "discovery");
      const area = x.dimensions.find((d) => d.key === "area");
      if (!location && area?.value?.type === "area" && /omaha|lincoln|[A-Z][a-z]+ [A-Z]/.test(area.value.label)) setLocation(area.value.label);
    });

  useEffect(() => {
    if (initialText && !autoRan.current) {
      autoRan.current = true;
      interpret(initialText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDim = (key: string, d: DimensionDraft) => setDraft((x) => (x ? { ...x, dimensions: x.dimensions.map((y) => (y.key === key ? d : y)) } : x));
  const removeDim = (key: string) => setDraft((x) => (x ? { ...x, dimensions: x.dimensions.filter((y) => y.key !== key) } : x));
  const addDim = (key: string, label: string) =>
    setDraft((x) => {
      if (!x) return x;
      const value = defaultValueFor(key, today);
      return { ...x, dimensions: [...x.dimensions, { key, label, state: "CONSTRAINED", value, display: displayFor(value), needsConfirmation: false }] };
    });

  const unresolved = draft ? draft.clarifications.filter((_, i) => resolved[i] === undefined).length : 0;
  const unconfirmed = draft ? draft.dimensions.filter((d) => d.needsConfirmation).length : 0;

  const create = () =>
    startCreate(async () => {
      if (!draft) return;
      setError(null);
      const r = await createPlanAction({
        rawInput: text,
        title: draft.title,
        kind: draft.kind,
        mode: draft.mode,
        discoveryEnabled: draft.mode === "discovery" ? true : discovery,
        timezone: tz,
        organizerName: name,
        dimensions: draft.dimensions.map((d) => ({ ...d, needsConfirmation: false, display: d.display || displayFor(d.value) })),
        shortlist: draft.mode === "shortlist" ? shortlist.filter((s) => s.title.trim() || s.url.trim()).map((s) => ({ title: s.title.trim() || undefined, url: s.url.trim() || undefined })) : [],
        decideBy: decideBy ? new Date(decideBy).toISOString() : null,
        locationLabel: location.trim() || null,
      });
      if (!r.ok) return setError(r.error);
      router.push(`/plan/${r.data.planId}?welcome=1`);
    });

  if (!draft) {
    return (
      <div>
        <h1 className="t-display">What are you trying to plan?</h1>
        <p className="mt-3 text-lg text-ink-2">Say what your group already knows. CrowdPlan figures out the rest.</p>
        <form
          className="mt-8 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) interpret(text);
          }}
        >
          <label htmlFor="plan-text" className="sr-only">
            What are you trying to plan?
          </label>
          <Textarea id="plan-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder="Dinner Friday, Italian, somewhere out west, under $40" className="text-lg" autoFocus />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" size="lg" loading={interpreting} disabled={!text.trim()}>
            Continue
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-ink-3">&ldquo;{text}&rdquo;</p>
        <h1 className="t-title mt-1">Here&apos;s what I understood</h1>
        <p className="mt-2 text-ink-2">
          Everything is editable. Mark what&apos;s settled as <strong>Locked</strong>, what has limits as <strong>Constrained</strong>, and what the group should decide as <strong>Undecided</strong>.
        </p>
        <p className="mt-1 text-xs text-ink-3">
          {usedProvider === "anthropic" ? "Interpreted with Claude, checked against CrowdPlan's rules." : "Interpreted by CrowdPlan's built-in parser."}{" "}
          <button type="button" className="font-semibold text-brand" onClick={() => setDraft(null)}>
            Rephrase
          </button>
        </p>
      </div>

      <Field label="Plan name" htmlFor="title">
        <Input id="title" value={draft.title} maxLength={140} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </Field>

      {draft.clarifications.length ? (
        <section aria-labelledby="clar-heading" className="space-y-3">
          <h2 id="clar-heading" className="t-heading">
            One quick question
          </h2>
          {draft.clarifications.map((c, i) => (
            <fieldset key={i} className="rounded-2xl border-2 border-warn/60 bg-surface p-4">
              <legend className="px-1 font-semibold">{c.question}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {c.options.map((o, j) => (
                  <button
                    key={j}
                    type="button"
                    aria-pressed={resolved[i] === j}
                    onClick={() => {
                      setResolved((r) => ({ ...r, [i]: j }));
                      if (o.dimension) updateDim(o.dimension.key, o.dimension);
                    }}
                    className={cn("rounded-xl border px-3 py-2 text-sm font-semibold", resolved[i] === j ? "border-brand bg-brand text-brand-ink" : "border-rule hover:border-ink-3")}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="kind-heading" className="space-y-3">
        <h2 id="kind-heading" className="t-heading">
          What kind of plan
        </h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="kind-heading">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={draft.kind === k.id}
              onClick={() => setDraft({ ...draft, kind: k.id })}
              className={cn("rounded-xl border px-3.5 py-2 font-semibold", draft.kind === k.id ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink-3")}
            >
              {k.label}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="mode-heading" className="space-y-3">
        <h2 id="mode-heading" className="t-heading">
          How far along is your group?
        </h2>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="mode-heading">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={draft.mode === m.id}
              onClick={() => {
                setDraft({ ...draft, mode: m.id });
                if (m.id === "shortlist" && shortlist.length === 0) setShortlist([{ title: "", url: "" }, { title: "", url: "" }, { title: "", url: "" }]);
              }}
              className={cn("rounded-2xl border-2 p-3.5 text-left transition", draft.mode === m.id ? "border-brand bg-brand/6" : "border-rule hover:border-ink-3")}
            >
              <span className="block font-semibold">{m.title}</span>
              <span className="block text-sm text-ink-2">{m.body}</span>
            </button>
          ))}
        </div>
      </section>

      {draft.mode === "shortlist" ? (
        <section aria-labelledby="short-heading" className="space-y-3">
          <h2 id="short-heading" className="t-heading">
            The options you&apos;re choosing between
          </h2>
          <p className="text-sm text-ink-2">Type a name, paste a Google Maps or Yelp link, or both. CrowdPlan compares only these.</p>
          <ul className="space-y-2">
            {shortlist.map((s, i) => (
              <li key={i} className="flex gap-2">
                <Input aria-label={`Option ${i + 1} name`} placeholder={["Firebirds", "Charleston's", "Texas Roadhouse"][i] ?? "Another place"} value={s.title} maxLength={160} onChange={(e) => setShortlist((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <div className="relative w-2/5">
                  <Link2 className="pointer-events-none absolute top-3.5 left-3 size-4 text-ink-3" aria-hidden="true" />
                  <Input aria-label={`Option ${i + 1} link`} placeholder="Link (optional)" className="pl-9" value={s.url} maxLength={1000} onChange={(e) => setShortlist((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                </div>
                <button type="button" className="rounded-lg px-2 text-ink-3 hover:text-blocked" aria-label={`Remove option ${i + 1}`} onClick={() => setShortlist((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {shortlist.length < 12 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShortlist((l) => [...l, { title: "", url: "" }])}>
              <Plus className="size-4" aria-hidden="true" /> Add an option
            </Button>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="dims-heading" className="space-y-3">
        <h2 id="dims-heading" className="t-heading">
          What&apos;s settled and what&apos;s open
        </h2>
        <div className="space-y-3">
          {draft.dimensions.map((d) => (
            <DimensionRow key={d.key} dim={d} today={today} onChange={(n) => updateDim(d.key, n)} onRemove={["place", "destination", "date", "dates", "activity"].includes(d.key) ? undefined : () => removeDim(d.key)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {OPTIONAL_DIMS[draft.kind]
            .filter((o) => !draft.dimensions.some((d) => d.key === o.key))
            .map((o) => (
              <Button key={o.key} type="button" variant="secondary" size="sm" onClick={() => addDim(o.key, o.label)}>
                <Plus className="size-4" aria-hidden="true" /> {o.label}
              </Button>
            ))}
        </div>
      </section>

      {draft.mode === "fixed" || draft.mode === "shortlist" ? (
        <label className="flex items-start gap-3 rounded-2xl border border-rule bg-surface p-4">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--brand)]" checked={discovery} onChange={(e) => setDiscovery(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-semibold">
              <Sparkles className="size-4 text-brand" aria-hidden="true" /> Let CrowdPlan suggest more options
            </span>
            <span className="block text-sm text-ink-2">Off by default — your group already knows where. Turn on only if you want alternatives.</span>
          </span>
        </label>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="org-name" hint="How friends will see you.">
          <Input id="org-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="Where is your group based?" htmlFor="loc" hint={searchConfigured ? "Used to look up places nearby." : "Helps friends and future search."}>
          <Input id="loc" value={location} maxLength={120} placeholder="Omaha, NE" onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Decide by (optional)" htmlFor="decide-by" hint="CrowdPlan nudges people who haven't answered.">
          <Input id="decide-by" type="datetime-local" value={decideBy} onChange={(e) => setDecideBy(e.target.value)} />
        </Field>
      </section>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="sticky bottom-0 -mx-4 border-t border-rule bg-paper/95 px-4 py-4 backdrop-blur">
        {unresolved ? <p className="mb-2 text-sm text-warn">Answer the question above first — CrowdPlan won&apos;t guess.</p> : unconfirmed ? <p className="mb-2 text-sm text-ink-2">{unconfirmed} assumption{unconfirmed > 1 ? "s" : ""} flagged above. Creating the plan confirms them.</p> : null}
        <Button size="lg" className="w-full sm:w-auto" onClick={create} loading={creating} disabled={unresolved > 0 || !name.trim()}>
          Create plan and invite friends
        </Button>
      </div>
    </div>
  );
}
