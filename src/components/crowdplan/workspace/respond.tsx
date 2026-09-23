"use client";

import { CheckCircle2, CircleHelp, LocateFixed, MessageSquareText, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { getMyPreferencesAction } from "@/app/actions/account";
import {
  deleteConstraintAction,
  interpretStatementAction,
  resolveClarificationAction,
  saveResponseAction,
  saveStatementAction,
  setConstraintStrengthAction,
} from "@/app/actions/participation";
import { describeConstraint } from "@/domain/constraints";
import type { ConstraintExtraction } from "@/domain/interpretation/schema";
import { Button, ErrorNote, Field, Input, Sheet, Textarea, cn } from "@/components/ui/primitives";
import { AvailabilityEditor } from "./availability";
import { useWorkspace } from "./context";

const DIETARY = ["Vegetarian", "Vegan", "Gluten-free", "Shellfish allergy", "Nut allergy", "Dairy-free", "Halal", "Kosher"];
const CUISINES = ["Italian", "Mexican", "Thai", "Sushi", "Chinese", "Indian", "BBQ", "Steak", "Seafood", "Pizza", "Burgers", "Mediterranean"];

type SavedPrefs = { homeArea: string | null; usualDinnerBudget: number | null; favoriteCuisines: string[]; dietaryRestrictions: string[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/ allergy$/, "");
/** Split saved free-text items into ones matching a chip and ones that don't. */
function matchChips(saved: string[], chips: string[]) {
  const matched: string[] = [];
  const other: string[] = [];
  for (const item of saved) {
    const chip = chips.find((c) => norm(c) === norm(item));
    if (chip) matched.push(chip);
    else if (item.trim()) other.push(item.trim());
  }
  return { matched, other };
}

export function YourPart() {
  const ws = useWorkspace();
  const me = ws.me;
  const [sheet, setSheet] = useState<null | "availability" | "questions" | "statement">(null);
  if (!me) {
    return (
      <p className="rounded-2xl border border-rule bg-surface p-4 text-sm text-ink-2">You&apos;re viewing this plan. Ask the organizer for an invite link to take part.</p>
    );
  }
  if (ws.bundle.plan.status !== "collecting") return null;
  const hasAvailability = ws.bundle.availability.some((w) => w.memberId === me.id);
  const response = ws.bundle.responses[me.id];
  const myConstraints = ws.bundle.constraints.filter((c) => c.member_id === me.id);
  const openClars = ws.bundle.clarifications.filter((c) => c.member_id === me.id && c.status === "open");
  const kind = ws.bundle.plan.kind;

  const steps = [
    { id: "availability" as const, done: hasAvailability, title: "When can you make it?", body: hasAvailability ? "Shared — update anytime." : "Mark the times that work." },
    { id: "questions" as const, done: !!response?.submittedAt, title: kind === "travel" ? "Trip details" : kind === "dinner" ? "Budget & food" : "Budget & distance", body: response?.submittedAt ? "Answered." : kind === "travel" ? "Where you're flying from, budget, flights." : kind === "dinner" ? "Budget, dietary needs, cuisines." : "Budget, travel distance, anything you can't do." },
    { id: "statement" as const, done: myConstraints.some((c) => c.source !== "user"), title: "Anything else?", body: "Say it in your own words — CrowdPlan checks it with you." },
  ];

  return (
    <section aria-labelledby="your-part-heading" className="rounded-[1.4rem] border border-rule bg-surface p-4" data-testid="your-part">
      <div className="flex items-center justify-between">
        <h2 id="your-part-heading" className="t-heading">
          Your part, {me.display_name}
        </h2>
        {ws.flags.demo ? null : <span className="text-xs text-ink-3">{steps.filter((s) => s.done).length}/3</span>}
      </div>

      {openClars.length ? (
        <div className="mt-3 space-y-3">
          {openClars.map((c) => (
            <ClarificationCard key={c.id} id={c.id} question={c.question} sourceText={c.source_text} options={c.options.map((o) => o.label)} />
          ))}
        </div>
      ) : null}

      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setSheet(s.id)}
              className="flex w-full items-start gap-3 rounded-xl border border-rule p-3 text-left hover:border-ink-3"
              data-testid={`step-${s.id}`}
            >
              {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-resolved" aria-label="Done" /> : <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-ink-3" aria-label="To do" />}
              <span>
                <span className="block font-semibold">{s.title}</span>
                <span className="block text-sm text-ink-2">{s.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {myConstraints.length ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-ink-2">What CrowdPlan knows about you</p>
          <ul className="mt-2 space-y-1.5">
            {myConstraints.map((c) => (
              <MyConstraint key={c.id} id={c.id} label={c.label ?? describeConstraint(c)} strength={c.strength} kind={c.kind} />
            ))}
          </ul>
        </div>
      ) : null}

      <Sheet open={sheet === "availability"} onClose={() => setSheet(null)} title="Your availability">
        <AvailabilityEditor onSaved={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === "questions"} onClose={() => setSheet(null)} title={steps[1].title}>
        <QuestionsForm onDone={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === "statement"} onClose={() => setSheet(null)} title="Anything else we should know?">
        <StatementFlow onDone={() => setSheet(null)} />
      </Sheet>
    </section>
  );
}

function MyConstraint({ id, label, strength, kind }: { id: string; label: string; strength: "hard" | "soft"; kind: string }) {
  const ws = useWorkspace();
  const [pending, start] = useTransition();
  const disabled = ws.flags.demo || pending;
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm">
      <span className="min-w-0">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {kind !== "note" ? (
          <button
            disabled={disabled}
            onClick={() => start(async () => { await setConstraintStrengthAction({ constraintId: id, strength: strength === "hard" ? "soft" : "hard" }); await ws.refresh(); })}
            className={cn("rounded-md px-1.5 py-0.5 text-xs font-bold", strength === "hard" ? "bg-ink text-paper" : "border border-rule text-ink-2")}
            title={strength === "hard" ? "Must-have (tap to make it a preference)" : "Preference (tap to make it a must-have)"}
          >
            {strength === "hard" ? "Must" : "Prefer"}
          </button>
        ) : null}
        <button disabled={disabled} onClick={() => start(async () => { await deleteConstraintAction(id); await ws.refresh(); })} className="rounded p-1 text-ink-3 hover:text-blocked" aria-label={`Remove ${label}`}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}

function ClarificationCard({ id, question, sourceText, options }: { id: string; question: string; sourceText: string; options: string[] }) {
  const ws = useWorkspace();
  const [choice, setChoice] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isOther = choice !== null && /something else/i.test(options[choice]);
  return (
    <div className="rounded-xl border-2 border-warn/70 bg-warn/6 p-3" data-testid="clarification">
      <p className="flex items-start gap-2 font-semibold">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
        {question}
      </p>
      <p className="mt-1 text-xs text-ink-3">You said: &ldquo;{sourceText}&rdquo; — nothing is set until you choose.</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {options.map((o, i) => (
          <label key={i} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm", choice === i ? "border-brand bg-brand/8" : "border-rule")}>
            <input type="radio" name={`clar-${id}`} className="accent-[var(--brand)]" checked={choice === i} onChange={() => setChoice(i)} />
            {o}
          </label>
        ))}
      </div>
      {isOther ? <Textarea className="mt-2" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell the group what you mean" aria-label="Details" /> : null}
      {error ? <div className="mt-2"><ErrorNote>{error}</ErrorNote></div> : null}
      <Button
        size="sm"
        className="mt-2"
        disabled={choice === null || ws.flags.demo}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await resolveClarificationAction({ clarificationId: id, optionIndex: choice!, note: note || undefined });
            if (!r.ok) return setError(r.error);
            await ws.refresh();
          })
        }
      >
        Confirm
      </Button>
    </div>
  );
}

function Chips({ options, value, onChange, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            type="button"
            key={o}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", on ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink-3")}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function QuestionsForm({ onDone }: { onDone: () => void }) {
  const ws = useWorkspace();
  const me = ws.me!;
  const kind = ws.bundle.plan.kind;
  const prev = (ws.bundle.responses[me.id]?.answers ?? {}) as Record<string, unknown>;
  const [maxBudget, setMaxBudget] = useState<string>(prev.maxBudget ? String(prev.maxBudget) : "");
  const [prefBudget, setPrefBudget] = useState<string>(prev.preferredBudget ? String(prev.preferredBudget) : "");
  const [dietary, setDietary] = useState<string[]>((prev.dietary as string[]) ?? []);
  const [prefer, setPrefer] = useState<string[]>((prev.cuisinesPreferred as string[]) ?? []);
  const [avoid, setAvoid] = useState<string[]>((prev.cuisinesAvoid as string[]) ?? []);
  const [travelMin, setTravelMin] = useState<string>(prev.maxTravelMinutes ? String(prev.maxTravelMinutes) : "");
  const [travelHard, setTravelHard] = useState(prev.maxTravelStrength === "hard");
  const [nonstop, setNonstop] = useState<"no" | "prefer" | "require">((prev.nonstop as "no" | "prefer" | "require") ?? "no");
  const [origin, setOrigin] = useState<{ label: string; lat: number | null; lng: number | null }>({ label: me.origin_label ?? "", lat: me.origin_lat, lng: me.origin_lng });
  const [buffer, setBuffer] = useState(String(me.home_buffer_minutes ?? 45));
  const [notes, setNotes] = useState<string>((prev.notes as string) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState<SavedPrefs | null>(null);
  const firstTime = !ws.bundle.responses[me.id]?.submittedAt;

  // Account holders answering for the first time can start from their saved
  // preferences. Nothing is stored until they review the form and save it.
  useEffect(() => {
    if (!firstTime || ws.flags.demo) return;
    let live = true;
    getMyPreferencesAction().then((r) => {
      if (live && r.ok && r.data) setSaved(r.data);
    });
    return () => {
      live = false;
    };
  }, [firstTime, ws.flags.demo]);

  const savedSummary = useMemo(() => {
    if (!saved) return [];
    const parts: string[] = [];
    if (saved.homeArea && kind !== "travel") parts.push(`from ${saved.homeArea}`);
    if (saved.usualDinnerBudget && kind === "dinner") parts.push(`usually about $${saved.usualDinnerBudget}`);
    if (kind === "dinner" && saved.dietaryRestrictions.length) parts.push(saved.dietaryRestrictions.join(", "));
    if (kind === "dinner" && saved.favoriteCuisines.length) parts.push(`likes ${saved.favoriteCuisines.join(", ")}`);
    return parts;
  }, [saved, kind]);

  const applySaved = () => {
    if (!saved) return;
    if (saved.homeArea && kind !== "travel" && !origin.label) setOrigin({ label: saved.homeArea, lat: null, lng: null });
    if (kind === "dinner") {
      if (saved.usualDinnerBudget && !prefBudget) setPrefBudget(String(saved.usualDinnerBudget));
      const diet = matchChips(saved.dietaryRestrictions, DIETARY);
      setDietary([...new Set([...dietary, ...diet.matched])]);
      const cuis = matchChips(saved.favoriteCuisines, CUISINES);
      setPrefer([...new Set([...prefer, ...cuis.matched])].filter((c) => !avoid.includes(c)));
      if (diet.other.length && !notes.includes(diet.other.join(", "))) setNotes([notes.trim(), `Dietary: ${diet.other.join(", ")}`].filter(Boolean).join("\n"));
    }
    setSaved(null);
  };

  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setOrigin({ label: origin.label || "My location", lat: Math.round(p.coords.latitude * 100) / 100, lng: Math.round(p.coords.longitude * 100) / 100 }),
      () => setError("Location access was blocked. Type your area instead."),
      { maximumAge: 600_000, timeout: 8000 },
    );

  const submit = () =>
    start(async () => {
      setError(null);
      const num = (s: string) => (s.trim() ? Number(s) : null);
      if (ws.flags.demo) return onDone();
      const r = await saveResponseAction({
        planId: ws.bundle.plan.id,
        answers: {
          maxBudget: num(maxBudget),
          preferredBudget: num(prefBudget),
          dietary: dietary.map((d) => d.replace(/ allergy$/i, "").toLowerCase()),
          cuisinesPreferred: prefer,
          cuisinesAvoid: avoid,
          maxTravelMinutes: num(travelMin),
          maxTravelStrength: travelHard ? "hard" : "soft",
          nonstop,
          notes: notes.trim() || undefined,
        },
        origin: origin.label || origin.lat != null ? origin : null,
        homeBufferMinutes: kind === "travel" ? Math.max(0, Math.min(600, Number(buffer) || 45)) : undefined,
      });
      if (!r.ok) return setError(r.error);
      await ws.refresh();
      onDone();
    });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {savedSummary.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-surface-2 px-4 py-3 text-sm" data-testid="saved-prefs">
          <p>
            <span className="font-semibold">Your saved preferences:</span> {savedSummary.join("; ")}.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={applySaved}>Fill these in</Button>
            <Button type="button" variant="ghost" onClick={() => setSaved(null)}>Not this time</Button>
          </div>
        </div>
      ) : null}

      {kind === "travel" ? (
        <Field label="Where are you flying from?" htmlFor="origin" hint="An airport code like OMA, or a city.">
          <Input id="origin" value={origin.label} maxLength={120} onChange={(e) => setOrigin({ ...origin, label: e.target.value })} placeholder="OMA" />
        </Field>
      ) : (
        <Field label="Where are you coming from?" htmlFor="origin" hint="Used to estimate drive time. Your exact location is rounded and only visible to this plan.">
          <div className="flex gap-2">
            <Input id="origin" value={origin.label} maxLength={120} onChange={(e) => setOrigin({ ...origin, label: e.target.value })} placeholder="West Omaha" />
            <Button type="button" variant="secondary" onClick={locate} aria-label="Use my location">
              <LocateFixed className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {origin.lat != null ? <p className="text-xs text-resolved">Location saved (approximate).</p> : null}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === "travel" ? "Preferred total" : "Prefer to spend"} htmlFor="pref-budget" hint="A preference">
          <Input id="pref-budget" type="number" inputMode="numeric" min={1} value={prefBudget} onChange={(e) => setPrefBudget(e.target.value)} placeholder="$" />
        </Field>
        <Field label={kind === "travel" ? "Absolute max" : "Can't spend more than"} htmlFor="max-budget" hint="A hard limit">
          <Input id="max-budget" type="number" inputMode="numeric" min={1} value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} placeholder="$" />
        </Field>
      </div>

      {kind === "dinner" ? (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Dietary needs (must-haves)</legend>
            <Chips label="Dietary needs" options={DIETARY} value={dietary} onChange={setDietary} />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">In the mood for</legend>
            <Chips label="Preferred cuisines" options={CUISINES} value={prefer} onChange={(v) => { setPrefer(v); setAvoid(avoid.filter((x) => !v.includes(x))); }} />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Rather skip</legend>
            <Chips label="Cuisines to avoid" options={CUISINES} value={avoid} onChange={(v) => { setAvoid(v); setPrefer(prefer.filter((x) => !v.includes(x))); }} />
          </fieldset>
        </>
      ) : null}

      {kind !== "travel" ? (
        <Field label="Longest you'd drive (minutes)" htmlFor="travel-min">
          <div className="flex items-center gap-3">
            <Input id="travel-min" type="number" inputMode="numeric" min={1} max={600} className="w-28" value={travelMin} onChange={(e) => setTravelMin(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--brand)]" checked={travelHard} onChange={(e) => setTravelHard(e.target.checked)} />
              That&apos;s a hard limit
            </label>
          </div>
        </Field>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Flights</legend>
            <div className="flex flex-wrap gap-1.5">
              {(["no", "prefer", "require"] as const).map((v) => (
                <button type="button" key={v} aria-pressed={nonstop === v} onClick={() => setNonstop(v)} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", nonstop === v ? "border-ink bg-ink text-paper" : "border-rule")}>
                  {v === "no" ? "Any flights" : v === "prefer" ? "Prefer nonstop" : "Nonstop only"}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Airport to home (minutes)" htmlFor="buffer" hint="Used to check when you actually get home, not just when you land.">
            <Input id="buffer" type="number" min={0} max={600} className="w-28" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </Field>
        </>
      )}

      <Field label={kind === "travel" ? "Destination, flight or hotel preferences" : "Anything else we should know?"} htmlFor="notes">
        <Textarea id="notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button type="submit" loading={pending} data-testid="save-questions">
        Save answers
      </Button>
    </form>
  );
}

function StatementFlow({ onDone }: { onDone: () => void }) {
  const ws = useWorkspace();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ConstraintExtraction | null>(null);
  const [provider, setProvider] = useState("deterministic");
  const [keep, setKeep] = useState<boolean[]>([]);
  const [strength, setStrength] = useState<Array<"hard" | "soft">>([]);
  const [keepNotes, setKeepNotes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const placeholder = useMemo(
    () => (ws.bundle.plan.kind === "travel" ? "I can't leave before 5 Friday because of work, and I need to be home Sunday before 9." : "I'm allergic to shellfish, and I'd rather not drive downtown."),
    [ws.bundle.plan.kind],
  );

  const interpret = () =>
    start(async () => {
      setError(null);
      const r = await interpretStatementAction({ planId: ws.bundle.plan.id, text });
      if (!r.ok) return setError(r.error);
      setResult(r.data.extraction);
      setProvider(r.data.provider);
      setKeep(r.data.extraction.constraints.map(() => true));
      setStrength(r.data.extraction.constraints.map((c) => c.strength));
    });

  const confirm = () =>
    start(async () => {
      if (!result) return;
      const r = await saveStatementAction({
        planId: ws.bundle.plan.id,
        constraints: result.constraints.filter((_, i) => keep[i]).map((c) => ({ ...c, strength: strength[result.constraints.indexOf(c)] })),
        clarifications: result.clarifications,
        source: provider === "anthropic" ? "llm" : "parser",
        unparsedNotes: keepNotes ? result.unparsed : [],
      });
      if (!r.ok) return setError(r.error);
      await ws.refresh();
      onDone();
    });

  if (!result) {
    return (
      <div className="space-y-3">
        <p className="text-ink-2">Constraints, preferences, anything. CrowdPlan will show you what it understood before saving.</p>
        <Textarea rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Your note" data-testid="statement-input" />
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button onClick={interpret} loading={pending} disabled={text.trim().length < 2 || ws.flags.demo} data-testid="statement-continue">
          <MessageSquareText className="size-4" aria-hidden="true" /> Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="statement-result">
      <p className="text-sm text-ink-3">&ldquo;{text}&rdquo;</p>
      <h3 className="t-heading">Here&apos;s what I understood</h3>
      {result.constraints.length ? (
        <ul className="space-y-2">
          {result.constraints.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-xl border border-rule p-2.5">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={keep[i]} onChange={(e) => setKeep((k) => k.map((x, j) => (j === i ? e.target.checked : x)))} />
                <span className="font-semibold">{c.label}</span>
              </label>
              <button
                type="button"
                onClick={() => setStrength((s) => s.map((x, j) => (j === i ? (x === "hard" ? "soft" : "hard") : x)))}
                className={cn("rounded-md px-2 py-0.5 text-xs font-bold", strength[i] === "hard" ? "bg-ink text-paper" : "border border-rule text-ink-2")}
              >
                {strength[i] === "hard" ? "Must" : "Prefer"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {result.clarifications.map((c, i) => (
        <div key={i} className="rounded-xl border-2 border-warn/70 bg-warn/6 p-3" data-testid="needs-clarification">
          <p className="flex items-start gap-2 font-semibold">
            <CircleHelp className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
            {c.question}
          </p>
          <ul className="mt-1.5 list-disc pl-6 text-sm text-ink-2">
            {c.options.map((o) => (
              <li key={o.label}>{o.label}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-ink-3">CrowdPlan won&apos;t guess. After you confirm, you&apos;ll pick the one you mean — nothing becomes a rule until then.</p>
        </div>
      ))}
      {result.unparsed.length ? (
        <label className="flex items-start gap-2 rounded-xl border border-dashed border-rule p-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={keepNotes} onChange={(e) => setKeepNotes(e.target.checked)} />
          <span>
            Save as a note for the group (not a rule): <span className="text-ink-2">{result.unparsed.join(" · ")}</span>
          </span>
        </label>
      ) : null}
      {!result.constraints.length && !result.clarifications.length && !result.unparsed.length ? <p className="text-ink-2">Nothing to add from that.</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        <Button onClick={confirm} loading={pending} data-testid="statement-confirm">
          Confirm
        </Button>
        <Button variant="ghost" onClick={() => setResult(null)}>
          Edit
        </Button>
      </div>
    </div>
  );
}
