"use client";

import { Eraser } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { saveAvailabilityAction } from "@/app/actions/participation";
import { heatmap, memberStatusAt, normalizeWindows } from "@/domain/availability";
import { allowedDates, timeBounds } from "@/domain/dimensions";
import { addDays, formatClockShort, formatDateLabel, formatRange, localDate, minutesOfDay, zonedInstant } from "@/domain/time";
import type { AvailabilityLevel, AvailabilityWindow } from "@/domain/types";
import { Avatar, Button, EmptyState, ErrorNote, cn } from "@/components/ui/primitives";
import { useWorkspace } from "./context";

const SLOT = 30;
type Brush = AvailabilityLevel | "erase";

const LEVEL_STYLE: Record<AvailabilityLevel, string> = {
  ideal: "bg-resolved text-white",
  works: "bg-[color-mix(in_oklab,var(--resolved)_38%,var(--surface))]",
  unavailable: "bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--blocked)_35%,transparent)_0_4px,transparent_4px_8px)] ring-1 ring-inset ring-blocked/50",
};

const BRUSHES: Array<{ id: Brush; label: string; hint: string }> = [
  { id: "ideal", label: "Ideal", hint: "Best for me" },
  { id: "works", label: "Works", hint: "I can make it" },
  { id: "unavailable", label: "Not available", hint: "Hard no" },
  { id: "erase", label: "Clear", hint: "Unmark" },
];

function useGrid() {
  const ws = useWorkspace();
  const { input, tz } = ws;
  const travel = input.plan.kind === "travel";
  const dates = useMemo(() => allowedDates(input.dimensions, input.plan, 14).slice(0, travel ? 62 : 14), [input.dimensions, input.plan, travel]);
  const bounds = timeBounds(input.dimensions, input.plan.kind);
  // With a locked start time, show the hours around it so people can say "I can be there by…".
  const fixed = bounds.fixedStart ? minutesOfDay(bounds.fixedStart) : null;
  const hhmm = (m: number) => (m >= 1440 ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  const winStart = fixed != null ? hhmm(Math.max(0, fixed - 180)) : bounds.window.start;
  const winEnd = fixed != null ? hhmm(Math.min(1440, fixed + 300)) : bounds.window.end;
  const slots = useMemo(() => {
    const out: number[] = [];
    if (travel) return out;
    const startMin = Math.floor(minutesOfDay(winStart) / SLOT) * SLOT;
    let endMin = winEnd === "24:00" ? 1440 : minutesOfDay(winEnd);
    if (endMin <= startMin) endMin += 1440;
    for (let m = startMin; m < endMin; m += SLOT) out.push(m);
    return out;
  }, [travel, winStart, winEnd]);
  const cellRange = useCallback((date: string, minute: number | null): [number, number] => {
    if (minute === null) return [zonedInstant(date, "00:00", tz), zonedInstant(addDays(date, 1), "00:00", tz)];
    const d = minute >= 1440 ? addDays(date, 1) : date;
    const m = minute % 1440;
    const hh = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const s = zonedInstant(d, hh, tz);
    return [s, s + SLOT * 60000];
  }, [tz]);
  return { travel, dates, slots, cellRange, tz };
}

export function WhenView() {
  const ws = useWorkspace();
  return (
    <div className="space-y-10">
      {ws.me && ws.bundle.plan.status === "collecting" ? <AvailabilityEditor /> : null}
      <GroupHeatmap />
      {!ws.input.plan.kind.startsWith("travel") ? <OverlapTimeline /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My availability editor
// ---------------------------------------------------------------------------

export function AvailabilityEditor({ onSaved }: { onSaved?: () => void }) {
  const ws = useWorkspace();
  const { travel, dates, slots, cellRange } = useGrid();
  const meId = ws.me?.id ?? "";
  const mine = useMemo(() => ws.bundle.availability.filter((w) => w.memberId === meId), [ws.bundle.availability, meId]);
  const initialCells = useMemo(() => {
    const cells: Record<string, AvailabilityLevel> = {};
    const responded = mine.length > 0;
    for (const date of dates) {
      for (const minute of travel ? [null] : slots) {
        const [s, e] = cellRange(date, minute);
        const st = memberStatusAt(meId, s, e, mine, responded);
        if (st === "ideal" || st === "works" || st === "unavailable") cells[`${date}|${minute}`] = st;
      }
    }
    return cells;
  }, [mine, dates, slots, travel, cellRange, meId]);
  // Unsaved edits live in a draft; without one we show the saved state (which realtime keeps fresh).
  const [draft, setDraft] = useState<Record<string, AvailabilityLevel> | null>(null);
  const cells = draft ?? initialCells;
  const dirty = draft !== null;
  const [brush, setBrush] = useState<Brush>("works");
  const [day, setDay] = useState(dates[0]);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const painting = useRef<boolean>(false);

  const paint = (key: string) => {
    setDraft((d) => {
      const next = { ...(d ?? initialCells) };
      if (brush === "erase") delete next[key];
      else next[key] = brush;
      return next;
    });
  };

  const preset = (date: string, from: number, to: number) => {
    setDraft((d) => {
      const next = { ...(d ?? initialCells) };
      for (const m of slots) if (m >= from && m < to) next[`${date}|${m}`] = brush === "erase" ? next[`${date}|${m}`] : brush;
      if (brush === "erase") for (const m of slots) if (m >= from && m < to) delete next[`${date}|${m}`];
      return next;
    });
  };

  const save = () =>
    start(async () => {
      setError(null);
      const windows: AvailabilityWindow[] = Object.entries(cells).map(([k, level]) => {
        const [date, minuteStr] = k.split("|");
        const [s, e] = cellRange(date, minuteStr === "null" ? null : Number(minuteStr));
        return { memberId: ws.me!.id, start: s, end: e, level };
      });
      const merged = normalizeWindows(windows);
      if (ws.demoMutate) {
        ws.demoMutate((b) => ({ ...b, availability: [...b.availability.filter((w) => w.memberId !== ws.me!.id), ...merged] }));
        setDraft(null);
        setSavedAt(Date.now());
        onSaved?.();
        return;
      }
      const r = await saveAvailabilityAction({ planId: ws.bundle.plan.id, windows: merged.map((w) => ({ start: w.start, end: w.end, level: w.level })) });
      if (!r.ok) return setError(r.error);
      await ws.refresh();
      setDraft(null);
      setSavedAt(Date.now());
      onSaved?.();
    });

  if (!dates.length) return null;

  return (
    <section aria-labelledby="my-avail-heading" data-testid="availability-editor">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="my-avail-heading" className="t-heading">
            When can you make it?
          </h2>
          <p className="text-sm text-ink-2">{travel ? "Tap the days that work." : "Pick a brush, then tap or drag across the times."} Anything you leave blank counts as not available.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Brush">
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              role="radio"
              aria-checked={brush === b.id}
              onClick={() => setBrush(b.id)}
              title={b.hint}
              className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold", brush === b.id ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink-3")}
            >
              {b.id === "erase" ? <Eraser className="size-3.5" aria-hidden="true" /> : <span className={cn("size-3 rounded-sm", LEVEL_STYLE[b.id])} aria-hidden="true" />}
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {travel ? (
        <div className="mt-4 grid grid-cols-7 gap-1.5" onPointerUp={() => (painting.current = false)} onPointerLeave={() => (painting.current = false)}>
          {dates.map((d) => {
            const key = `${d}|null`;
            const level = cells[key];
            return (
              <button
                key={d}
                data-testid={`day-${d}`}
                aria-pressed={!!level}
                aria-label={`${formatDateLabel(d)}: ${level ?? "not marked"}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  painting.current = true;
                  paint(key);
                }}
                onPointerEnter={() => painting.current && paint(key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), paint(key))}
                className={cn("flex h-14 touch-none flex-col items-center justify-center rounded-lg border border-rule text-xs font-semibold", level ? LEVEL_STYLE[level] : "bg-surface hover:border-ink-3")}
              >
                <span>{formatDateLabel(d).split(",")[0]}</span>
                <span className="text-sm">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 md:hidden" role="tablist" aria-label="Day">
            {dates.map((d) => (
              <button key={d} role="tab" aria-selected={day === d} onClick={() => setDay(d)} className={cn("shrink-0 rounded-lg border px-3 py-1.5 text-sm font-semibold", day === d ? "border-brand bg-brand text-brand-ink" : "border-rule")}>
                {formatDateLabel(d)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-sm text-ink-3">Quick fill {dates.length > 1 ? <span className="md:hidden">{formatDateLabel(day)}</span> : null}:</span>
            {[
              { label: "Evening", from: 17 * 60, to: 23 * 60 },
              { label: "After 6", from: 18 * 60, to: 24 * 60 },
              { label: "Afternoon", from: 12 * 60, to: 17 * 60 },
              { label: "All day", from: 0, to: 48 * 60 },
            ].map((p) => (
              <button key={p.label} className="rounded-full border border-rule px-2.5 py-1 text-xs font-semibold hover:border-ink-3" onClick={() => (dates.length > 1 && window.matchMedia("(min-width: 768px)").matches ? dates : [day]).forEach((d) => preset(d, p.from, p.to))}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto" onPointerUp={() => (painting.current = false)} onPointerLeave={() => (painting.current = false)}>
            <div className="grid min-w-min gap-x-1" style={{ gridTemplateColumns: `3.5rem repeat(${dates.length}, minmax(3.2rem, 1fr))` }}>
              <div />
              {dates.map((d) => (
                <div key={d} className={cn("pb-1 text-center text-xs font-semibold text-ink-2", d !== day && "max-md:hidden")}>
                  {formatDateLabel(d)}
                </div>
              ))}
              {slots.map((m) => (
                <SlotRow key={m} minute={m} dates={dates} day={day} cells={cells} onPaint={paint} painting={painting} />
              ))}
            </div>
          </div>
        </>
      )}
      {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} loading={pending} disabled={!dirty && mine.length > 0} data-testid="save-availability">
          {mine.length ? "Update availability" : "Save availability"}
        </Button>
        {savedAt && !dirty ? <span role="status" className="text-sm text-resolved">Saved — the group sees it now.</span> : dirty ? <span className="text-sm text-ink-3">Unsaved changes</span> : null}
      </div>
    </section>
  );
}

function SlotRow({ minute, dates, day, cells, onPaint, painting }: { minute: number; dates: string[]; day: string; cells: Record<string, AvailabilityLevel>; onPaint: (k: string) => void; painting: React.RefObject<boolean> }) {
  const label = minute % 60 === 0 ? formatHour(minute) : "";
  return (
    <>
      <div className="pr-2 text-right text-[0.7rem] leading-7 text-ink-3">{label}</div>
      {dates.map((d) => {
        const key = `${d}|${minute}`;
        const level = cells[key];
        return (
          <button
            key={key}
            data-testid={`cell-${d}-${minute}`}
            aria-label={`${formatDateLabel(d)} ${formatHour(minute)}: ${level ?? "not marked"}`}
            aria-pressed={!!level}
            onPointerDown={(e) => {
              e.preventDefault();
              painting.current = true;
              onPaint(key);
            }}
            onPointerEnter={() => painting.current && onPaint(key)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPaint(key))}
            className={cn(
              "h-7 touch-none border-b border-surface-2 transition-colors",
              minute % 60 === 0 && "border-t border-t-rule",
              level ? LEVEL_STYLE[level] : "bg-surface hover:bg-surface-2",
              d !== day && "max-md:hidden",
            )}
          />
        );
      })}
    </>
  );
}

function formatHour(minute: number) {
  const m = minute % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}` : `${h12} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Group heatmap (signature view): "When can the most people make it?"
// ---------------------------------------------------------------------------

export function GroupHeatmap() {
  const ws = useWorkspace();
  const { travel, dates, slots, cellRange } = useGrid();
  const { overlap } = ws.evaluation;
  const [focus, setFocus] = useState<string | null>(null);
  const members = ws.input.members;
  const total = members.length;
  const best = overlap.best;
  const buckets = useMemo(() => {
    const map = new Map<string, ReturnType<typeof heatmap>[number]>();
    for (const d of dates) {
      for (const m of travel ? [null] : slots) {
        const [s, e] = cellRange(d, m);
        const b = heatmap(members, ws.input.availability, [{ start: s, end: e }], travel ? 1440 : SLOT)[0];
        if (b) map.set(`${d}|${m}`, b);
      }
    }
    return map;
  }, [ws.input.availability, members, dates, slots, travel, cellRange]);

  if (overlap.respondedIds.length === 0) {
    return (
      <section aria-labelledby="heat-heading">
        <h2 id="heat-heading" className="t-heading">
          Group availability
        </h2>
        <div className="mt-3">
          <EmptyState title="No availability yet">Once people mark their times, the overlap shows up here.</EmptyState>
        </div>
      </section>
    );
  }

  const inBest = (s: number, e: number) => !!best && s >= best.start && e <= best.end;
  const focused = focus ? buckets.get(focus) : null;

  return (
    <section aria-labelledby="heat-heading" data-testid="group-heatmap">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="heat-heading" className="t-heading">
            When can the most people make it?
          </h2>
          {best ? (
            <p className="mt-1 text-ink-2" data-testid="best-overlap">
              Strongest overlap: <span className="highlighter rounded px-1.5 py-0.5 font-bold">{formatRange(best.start, best.end, ws.tz)}</span>{" "}
              · {best.available.length}/{total} available{best.ideal.length ? ` · ${best.ideal.length} ideal` : ""}
            </p>
          ) : (
            <p className="mt-1 text-blocked">No time works for everyone who responded yet.</p>
          )}
          {overlap.unknownIds.length ? (
            <p className="text-sm text-ink-3">Still waiting on {overlap.unknownIds.map((id) => ws.memberById.get(id)?.display_name).join(", ")} — not counted as available.</p>
          ) : null}
        </div>
        <Legend total={total} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-min gap-0.5" style={{ gridTemplateColumns: travel ? `repeat(7, minmax(2.6rem, 1fr))` : `3.5rem repeat(${dates.length}, minmax(2.6rem, 1fr))` }}>
          {!travel ? <div /> : null}
          {!travel ? dates.map((d) => <div key={d} className="pb-1 text-center text-xs font-semibold text-ink-2">{formatDateLabel(d)}</div>) : null}
          {travel
            ? dates.map((d) => {
                const b = buckets.get(`${d}|null`);
                return <HeatCell key={d} k={`${d}|null`} label={`${formatDateLabel(d).split(",")[0]} ${Number(d.slice(8))}`} b={b} total={total} best={b ? inBest(b.start, b.end) : false} onFocus={setFocus} focused={focus} />;
              })
            : slots.map((m) => (
                <HeatRow key={m} minute={m} dates={dates} buckets={buckets} total={total} inBest={inBest} onFocus={setFocus} focus={focus} />
              ))}
        </div>
      </div>
      {focused ? (
        <div className="mt-3 rounded-xl border border-rule bg-surface p-3 text-sm" role="status">
          <p className="font-semibold">{formatRange(focused.start, focused.end, ws.tz)}</p>
          <p className="mt-1 text-ink-2">
            <span className="text-resolved">Available: </span>
            {focused.available.map((id) => ws.memberById.get(id)?.display_name).join(", ") || "nobody"}
          </p>
          {focused.unavailable.length ? <p className="text-ink-2"><span className="text-blocked">Not available: </span>{focused.unavailable.map((id) => ws.memberById.get(id)?.display_name).join(", ")}</p> : null}
          {focused.unknown.length ? <p className="text-ink-3">No answer yet: {focused.unknown.map((id) => ws.memberById.get(id)?.display_name).join(", ")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function HeatRow({ minute, dates, buckets, total, inBest, onFocus, focus }: { minute: number; dates: string[]; buckets: Map<string, ReturnType<typeof heatmap>[number]>; total: number; inBest: (s: number, e: number) => boolean; onFocus: (k: string) => void; focus: string | null }) {
  return (
    <>
      <div className="pr-2 text-right text-[0.7rem] leading-6 text-ink-3">{minute % 60 === 0 ? formatHour(minute) : ""}</div>
      {dates.map((d) => {
        const k = `${d}|${minute}`;
        const b = buckets.get(k);
        return <HeatCell key={k} k={k} b={b} total={total} best={b ? inBest(b.start, b.end) : false} onFocus={onFocus} focused={focus} />;
      })}
    </>
  );
}

function HeatCell({ k, b, total, best, onFocus, focused, label }: { k: string; b?: ReturnType<typeof heatmap>[number]; total: number; best: boolean; onFocus: (k: string) => void; focused: string | null; label?: string }) {
  const n = b?.available.length ?? 0;
  const pct = total ? n / total : 0;
  return (
    <button
      onClick={() => onFocus(k)}
      aria-label={`${label ?? ""} ${n} of ${total} available${best ? ", strongest overlap" : ""}`}
      className={cn("relative h-6 rounded-[3px] text-[0.65rem] font-bold", label && "h-12", focused === k && "ring-2 ring-ink")}
      style={{ background: n ? `color-mix(in oklab, var(--brand) ${Math.round(12 + pct * 78)}%, var(--surface))` : "var(--surface-2)", color: pct > 0.55 ? "white" : "var(--ink-2)" }}
    >
      {best ? <span className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-[3px] bg-highlight" aria-hidden="true" /> : null}
      {label ? <span className="block">{label}</span> : null}
      {n ? <span>{n}</span> : null}
    </button>
  );
}

function Legend({ total }: { total: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-3" aria-hidden="true">
      <span>0</span>
      <span className="h-2.5 w-24 rounded-full" style={{ background: "linear-gradient(90deg, var(--surface-2), color-mix(in oklab, var(--brand) 90%, var(--surface)))" }} />
      <span>{total} people</span>
      <span className="ml-2 inline-block h-2 w-5 rounded-sm bg-highlight" /> best
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlap timeline (signature view): "Where do our windows line up?"
// ---------------------------------------------------------------------------

export function OverlapTimeline() {
  const ws = useWorkspace();
  const best = ws.evaluation.overlap.best;
  const day = best ? localDate(best.start, ws.tz) : null;
  if (!best || !day) return null;
  const members = ws.input.members;
  const dayStart = zonedInstant(day, "00:00", ws.tz);
  const windows = ws.input.availability.filter((w) => w.end > dayStart && w.start < dayStart + 30 * 3600_000);
  const from = Math.max(dayStart + 8 * 3600_000, Math.min(best.start, ...windows.map((w) => w.start)) - 3600_000);
  const to = Math.min(dayStart + 30 * 3600_000, Math.max(best.end, ...windows.map((w) => w.end)) + 3600_000);
  const span = to - from;
  const pos = (t: number) => `${((Math.min(Math.max(t, from), to) - from) / span) * 100}%`;
  const width = (s: number, e: number) => `${((Math.min(e, to) - Math.max(s, from)) / span) * 100}%`;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / 7200_000) * 7200_000; t <= to; t += 7200_000) ticks.push(t);

  return (
    <section aria-labelledby="timeline-heading" data-testid="overlap-timeline">
      <h2 id="timeline-heading" className="t-heading">
        Where everyone lines up · {formatDateLabel(day)}
      </h2>
      <div className="mt-4 space-y-2.5">
        {members.map((m) => {
          const mine = windows.filter((w) => w.memberId === m.id);
          return (
            <div key={m.id} className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <Avatar name={m.displayName} color={m.color} size={22} />
                <span className="truncate">{m.displayName}</span>
              </span>
              <div className="relative h-6 rounded-md bg-surface-2">
                {mine.length === 0 ? <span className="absolute inset-0 flex items-center px-2 text-xs text-ink-3">No answer yet</span> : null}
                {mine.map((w, i) => (
                  <span
                    key={i}
                    className={cn("absolute inset-y-0 rounded-md", LEVEL_STYLE[w.level])}
                    style={{ left: pos(w.start), width: width(w.start, w.end) }}
                    title={`${formatClockShort(w.start, ws.tz)}–${formatClockShort(w.end, ws.tz)} ${w.level}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3 pt-1">
          <span className="text-sm font-bold">Group</span>
          <div className="relative h-8 rounded-md border-2 border-dashed border-rule">
            <span className="highlighter absolute inset-y-0 flex items-center justify-center rounded-md text-xs font-bold whitespace-nowrap" style={{ left: pos(best.start), width: width(best.start, best.end) }}>
              {formatClockShort(best.start, ws.tz)}–{formatClockShort(best.end, ws.tz)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-[6.5rem_1fr] gap-3">
          <span />
          <div className="relative h-4 text-[0.65rem] text-ink-3">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>
                {formatClockShort(t, ws.tz)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
