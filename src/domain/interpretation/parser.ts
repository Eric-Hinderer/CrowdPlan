// Deterministic interpretation used when no LLM key is configured, and as a
// validated fallback when an LLM response fails schema validation. It handles
// common date/time/budget/place statements and flags ambiguity instead of
// guessing. Everything it extracts is shown to a person for confirmation.
import { formatMoney } from "../money";
import { addDays, formatDateLabel, formatTimeLabel, localDate, weekdayOfDate } from "../time";
import { WEEKDAYS, type Weekday } from "../types";
import {
  constraintExtractionSchema,
  planExtractionSchema,
  type ClarificationDraft,
  type ConstraintDraft,
  type ConstraintExtraction,
  type DimensionDraft,
  type InterpretationContext,
  type PlanExtraction,
} from "./schema";

const DAY_RE = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)";
const DAY_ALIASES: Record<string, Weekday> = {
  sun: "sunday", sunday: "sunday", mon: "monday", monday: "monday", tue: "tuesday", tues: "tuesday", tuesday: "tuesday",
  wed: "wednesday", wednesday: "wednesday", thu: "thursday", thur: "thursday", thurs: "thursday", thursday: "thursday",
  fri: "friday", friday: "friday", sat: "saturday", saturday: "saturday",
};

export const CUISINES = [
  "italian", "mexican", "thai", "sushi", "japanese", "chinese", "indian", "bbq", "barbecue", "steak", "steakhouse",
  "seafood", "pizza", "burgers", "burger", "mediterranean", "french", "korean", "vietnamese", "ramen", "greek",
  "tapas", "spanish", "american", "vegan", "vegetarian", "brunch", "tacos", "middle eastern", "ethiopian", "cajun",
];

const DESTINATIONS: Record<string, string> = {
  vegas: "Las Vegas", "las vegas": "Las Vegas", chicago: "Chicago", austin: "Austin", nashville: "Nashville",
  denver: "Denver", "new york": "New York City", nyc: "New York City", miami: "Miami", "new orleans": "New Orleans",
  seattle: "Seattle", "san diego": "San Diego", orlando: "Orlando", boston: "Boston", "kansas city": "Kansas City",
  phoenix: "Phoenix", "los angeles": "Los Angeles", "san francisco": "San Francisco", cancun: "Cancún",
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const MEALS: Record<string, string> = {
  dinner: "Dinner", lunch: "Lunch", brunch: "Brunch", breakfast: "Breakfast", drinks: "Drinks", "happy hour": "Happy hour",
};

function cap(s: string) {
  return s.replace(/(^|[\s/-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function weekdayFrom(token: string): Weekday | null {
  return DAY_ALIASES[token.toLowerCase().replace(/\.$/, "")] ?? null;
}

/** Next occurrence of weekday on or after today (local). */
export function nextWeekday(today: string, day: Weekday, includeToday = true): string {
  for (let i = includeToday ? 0 : 1; i < 8; i++) {
    const d = addDays(today, i);
    if (weekdayOfDate(d) === day) return d;
  }
  return today;
}

/**
 * Parse a clock like "5", "5pm", "5:30", "17:00", "9 p.m.". Without am/pm,
 * 1–11 is read as PM (social-plan convention) and marked assumed.
 */
export function parseClock(raw: string): { time: string; assumed: boolean } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(raw.trim());
  if (!m) {
    if (/^noon$/i.test(raw.trim())) return { time: "12:00", assumed: false };
    if (/^midnight$/i.test(raw.trim())) return { time: "24:00", assumed: false };
    return null;
  }
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  const mer = m[3]?.toLowerCase().replace(/\./g, "");
  let assumed = false;
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 11) {
    h += 12;
    assumed = true;
  }
  if (h === 24 && min === 0) return { time: "24:00", assumed };
  if (h > 23) return null;
  return { time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, assumed };
}

const CLOCK = "(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|noon|midnight)";

function money(n: string) {
  return Number(n.replace(/[,$]/g, ""));
}

// ---------------------------------------------------------------------------
// Plan creation
// ---------------------------------------------------------------------------

export function parsePlanStatement(input: string, ctx: InterpretationContext): PlanExtraction {
  const text = input.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const today = localDate(ctx.now, ctx.timezone);
  const dims: DimensionDraft[] = [];
  const clarifications: ClarificationDraft[] = [];
  const shortlist: string[] = [];
  let kind: PlanExtraction["kind"] = "activity";
  let mode: PlanExtraction["mode"] = "criteria";

  const push = (d: DimensionDraft) => {
    const i = dims.findIndex((x) => x.key === d.key);
    if (i >= 0) dims[i] = d;
    else dims.push(d);
  };

  // --- Travel destination ---------------------------------------------------
  let destination: string | null = null;
  for (const [alias, name] of Object.entries(DESTINATIONS).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(lower)) {
      destination = name;
      break;
    }
  }
  const tripWords = /\b(trip|vacation|getaway|fly|flight|flights|hotel)\b|\b\d+\s*(?:(?:-|–|to|or)\s*\d+\s*)?nights?\b/.test(lower);
  if (destination || tripWords) kind = "travel";

  // --- Meals -------------------------------------------------------------------
  let activity: string | null = null;
  for (const [k, label] of Object.entries(MEALS)) {
    if (new RegExp(`\\b${k}\\b`).test(lower)) {
      activity = label;
      if (kind !== "travel") kind = "dinner";
      break;
    }
  }

  // --- Shortlist -------------------------------------------------------------
  const optionsMatch = /(?:options?|choices?|between|choose from|pick from)\s*[:\-]?\s*(.+)$/i.exec(text);
  const whichOf = /\bwhich of (?:these|the(?:se)?)\b/i.test(text);
  if (optionsMatch) {
    const items = optionsMatch[1]
      .split(/,|\bor\b|\band\b|\//i)
      .map((s) => s.replace(/[?.!]+$/, "").trim())
      .filter((s) => s.length > 1 && s.length < 80);
    if (items.length >= 2) {
      shortlist.push(...items.map((s) => cap(s)));
      mode = "shortlist";
    }
  }
  if (whichOf) mode = "shortlist";

  // --- Fixed place: "at Firebirds", leading possessive "Vala's" ------------
  let place: string | null = null;
  const atPlace = /\b(?:at|to)\s+((?:[A-Z][\w'’&.-]*)(?:\s+(?:[A-Z][\w'’&.-]*|of|the|&))*)/.exec(text);
  if (atPlace && !/^(?:[0-9]|Noon|Midnight)/.test(atPlace[1])) place = trimTemporalWords(atPlace[1]);
  if (!place) {
    const lead = /^([A-Z][\w’']*(?:'s|’s)(?:\s+[A-Z][\w’']*)*)/.exec(text);
    if (lead && !DAY_ALIASES[lead[1].toLowerCase()]) place = trimTemporalWords(lead[1]);
  }
  if (place && WEEKDAYS.some((d) => place!.toLowerCase().startsWith(d))) place = null;
  if (place && destination && place.toLowerCase().includes(destination.toLowerCase().split(" ").pop()!)) place = null;

  // --- Discovery ----------------------------------------------------------------
  const discovery = /\b(something|anything|ideas?|find (?:us )?(?:something|a place|somewhere)|what should we do)\b/i.test(lower) && !place && shortlist.length === 0;

  if (kind === "travel") {
    push({
      key: "destination",
      label: "Destination",
      state: destination ? "LOCKED" : "UNDECIDED",
      value: destination ? { type: "place", name: destination } : null,
      display: destination ?? "Undecided",
      needsConfirmation: false,
    });
    mode = destination ? "fixed" : shortlist.length ? "shortlist" : "discovery";
  } else if (place) {
    mode = "fixed";
    push({ key: "place", label: "Where", state: "LOCKED", value: { type: "place", name: place }, display: place, needsConfirmation: false });
  } else {
    push({
      key: "place",
      label: kind === "dinner" ? "Restaurant" : "Where",
      state: "UNDECIDED",
      value: null,
      display: mode === "shortlist" ? (shortlist.length ? `One of ${shortlist.length} options` : "One of your options") : "Undecided",
      needsConfirmation: false,
    });
    if (discovery) mode = "discovery";
  }

  if (activity) {
    push({ key: "activity", label: "What", state: "LOCKED", value: { type: "text", text: activity }, display: activity, needsConfirmation: false });
  } else if (kind === "activity" && !place) {
    // A named place already says what the plan is ("Vala's"); only ask "what" when it's open.
    const fun = /\bsomething fun\b|\bsomething to do\b|\banything\b/i.test(lower);
    push({ key: "activity", label: "What", state: "UNDECIDED", value: null, display: fun ? "Something fun" : "Undecided", needsConfirmation: false });
  }

  // --- Cuisine ------------------------------------------------------------------
  const cuisines = CUISINES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(lower) && !(c === "brunch" && activity === "Brunch"));
  if (cuisines.length && kind !== "travel") {
    push({ key: "cuisine", label: "Cuisine", state: "CONSTRAINED", value: { type: "list", items: cuisines.map(cap) }, display: cuisines.map(cap).join(" or "), needsConfirmation: false });
    kind = "dinner";
  }

  // --- Area -------------------------------------------------------------------
  const area =
    /\b([Ww]est|[Ee]ast|[Nn]orth|[Ss]outh)\s+([A-Z][a-z]+)\b/.exec(text) ??
    /\b(?:somewhere\s+)?out\s+(west|east|north|south)\b/i.exec(text) ??
    /\b(downtown|midtown|uptown)\b/i.exec(text) ??
    /\b(?:in|near|around)\s+((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?)/.exec(text);
  if (area && kind !== "travel") {
    let label: string;
    let confirm = false;
    if (/out\s+/i.test(area[0])) {
      label = `${cap(area[1])} side`;
      confirm = true;
    } else if (area[2]) label = `${cap(area[1])} ${area[2]}`;
    else label = cap(area[1]);
    const isDay = WEEKDAYS.includes(label.toLowerCase() as Weekday) || MONTHS.includes(label.toLowerCase());
    if (!isDay && label.toLowerCase() !== (place ?? "").toLowerCase()) {
      push({ key: "area", label: "Area", state: "CONSTRAINED", value: { type: "area", label }, display: label, needsConfirmation: confirm });
    }
  }

  // --- Budget -------------------------------------------------------------------
  const range = /\$\s?(\d[\d,]*)\s*(?:-|–|to)\s*\$?\s?(\d[\d,]*)/.exec(text);
  const under = /(?:under|below|less than|max(?:imum)?|no more than|up to|<=?)\s*\$\s?(\d[\d,]*)/i.exec(text) ?? /\$\s?(\d[\d,]*)\s*(?:max|or less|tops)/i.exec(text);
  if (range || under) {
    const min = range ? money(range[1]) : undefined;
    const max = range ? money(range[2]) : money(under![1]);
    const each = /\beach|per person|a head|pp\b|\/person/i.test(lower) || kind !== "travel";
    push({
      key: "budget",
      label: "Budget",
      state: "CONSTRAINED",
      value: { type: "money", min, max, currency: "USD", basis: each ? "per_person" : "per_group" },
      display: `${min != null ? `${formatMoney(min)}–` : "≤ "}${formatMoney(max)}${each ? "/person" : " total"}`,
      needsConfirmation: false,
    });
  }

  // --- Dates ----------------------------------------------------------------------
  let dateDim: DimensionDraft | null = null;
  const dateKey = kind === "travel" ? "dates" : "date";
  const dateLabel = kind === "travel" ? "Dates" : "When";
  const monthMatch = new RegExp(`\\b(?:in|during|sometime in|some time in)?\\s*(${MONTHS.join("|")})\\b`, "i").exec(lower);
  const nextWeekend = /\bnext weekend\b/.test(lower);
  const thisWeekend = /\b(this|the) weekend\b/.test(lower);
  const dayMatch = new RegExp(`\\b(this|next|on)?\\s*${DAY_RE}\\b`, "i").exec(lower);
  if (/\btonight\b/.test(lower)) {
    dateDim = { key: dateKey, label: dateLabel, state: "LOCKED", value: { type: "dates", dates: [today] }, display: `Tonight (${formatDateLabel(today)})`, needsConfirmation: false };
  } else if (/\btomorrow\b/.test(lower)) {
    const d = addDays(today, 1);
    dateDim = { key: dateKey, label: dateLabel, state: "LOCKED", value: { type: "dates", dates: [d] }, display: `Tomorrow (${formatDateLabel(d)})`, needsConfirmation: false };
  } else if (nextWeekend || thisWeekend) {
    const sat = nextWeekday(today, "saturday", true);
    const start = nextWeekend ? addDays(sat, 7) : sat;
    const end = addDays(start, 1);
    dateDim = {
      key: dateKey,
      label: dateLabel,
      state: "CONSTRAINED",
      value: { type: "dateRange", start, end },
      display: `${nextWeekend ? "Next" : "This"} weekend (${formatDateLabel(start)} – ${formatDateLabel(end)})`,
      needsConfirmation: true,
    };
  } else if (monthMatch) {
    const monthIdx = MONTHS.indexOf(monthMatch[1].toLowerCase());
    const [y, m] = today.split("-").map(Number);
    const year = monthIdx + 1 < m ? y + 1 : y;
    const start = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
    const endDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    const end = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
    const s = monthIdx + 1 === m ? today : start;
    dateDim = { key: dateKey, label: dateLabel, state: "CONSTRAINED", value: { type: "dateRange", start: s, end }, display: `${cap(MONTHS[monthIdx])} ${year}`, needsConfirmation: false };
  } else if (dayMatch) {
    const day = weekdayFrom(dayMatch[2])!;
    const isNext = dayMatch[1]?.toLowerCase() === "next";
    const todayIs = weekdayOfDate(today) === day;
    let d = nextWeekday(today, day, !isNext);
    if (isNext && !todayIs && addDays(today, 7) > d && dayMatch[1]) {
      // "next Friday" said early in the week is commonly the following week: ask.
      clarifications.push({
        sourceText: dayMatch[0].trim(),
        question: `Which ${cap(day)} do you mean?`,
        options: [
          { label: `This ${cap(day)} (${formatDateLabel(d)})`, constraint: null, dimension: dateDraft(dateKey, dateLabel, d, cap(day)) },
          { label: `The following ${cap(day)} (${formatDateLabel(addDays(d, 7))})`, constraint: null, dimension: dateDraft(dateKey, dateLabel, addDays(d, 7), cap(day)) },
        ],
      });
    }
    if (todayIs && !isNext) {
      clarifications.push({
        sourceText: dayMatch[0].trim(),
        question: `Today is ${cap(day)}. Do you mean today or next ${cap(day)}?`,
        options: [
          { label: `Today (${formatDateLabel(today)})`, constraint: null, dimension: dateDraft(dateKey, dateLabel, today, cap(day)) },
          { label: `Next ${cap(day)} (${formatDateLabel(addDays(today, 7))})`, constraint: null, dimension: dateDraft(dateKey, dateLabel, addDays(today, 7), cap(day)) },
        ],
      });
      d = today;
    }
    dateDim = {
      key: dateKey,
      label: dateLabel,
      state: /\bsometime\b|\bsome time\b|\bor\b/.test(lower) ? "CONSTRAINED" : "LOCKED",
      value: { type: "dates", dates: [d] },
      display: `${cap(day)} (${formatDateLabel(d)})`,
      needsConfirmation: true,
    };
  }
  dims.push(dateDim ?? { key: dateKey, label: dateLabel, state: "UNDECIDED", value: null, display: "Undecided", needsConfirmation: false });

  // --- Nights (travel) --------------------------------------------------------------
  const nights = /(\d{1,2})\s*(?:-|–|to|or)\s*(\d{1,2})\s*nights?/i.exec(lower) ?? /(\d{1,2})\s*nights?/i.exec(lower);
  if (kind === "travel") {
    if (nights) {
      const min = Number(nights[1]);
      const max = Number(nights[2] ?? nights[1]);
      push({ key: "nights", label: "Length", state: "CONSTRAINED", value: { type: "nights", min: Math.min(min, max), max: Math.max(min, max) }, display: min === max ? `${min} nights` : `${Math.min(min, max)}–${Math.max(min, max)} nights`, needsConfirmation: false });
    } else {
      push({ key: "nights", label: "Length", state: "UNDECIDED", value: null, display: "Undecided", needsConfirmation: false });
    }
    push({ key: "flights", label: "Flights", state: "UNDECIDED", value: null, display: "Undecided", needsConfirmation: false });
    push({ key: "lodging", label: "Hotel", state: "UNDECIDED", value: null, display: "Undecided", needsConfirmation: false });
  }

  // --- Time -------------------------------------------------------------------------
  if (kind !== "travel") {
    const between = new RegExp(`\\b(?:from|between)?\\s*${CLOCK}\\s*(?:-|–|to|and)\\s*${CLOCK}`, "i").exec(text);
    const after = new RegExp(`\\bafter\\s+${CLOCK}`, "i").exec(text);
    const at = new RegExp(`\\bat\\s+${CLOCK}(?!\\s*(?:nights?|people))`, "i").exec(text);
    let timeDim: DimensionDraft | null = null;
    if (between) {
      const a = parseClock(between[1]);
      const b = parseClock(between[2]);
      if (a && b) timeDim = { key: "time", label: "Time", state: "CONSTRAINED", value: { type: "timeWindow", start: a.time, end: b.time }, display: `${formatTimeLabel(a.time)}–${formatTimeLabel(b.time)}`, needsConfirmation: a.assumed || b.assumed };
    } else if (after) {
      const a = parseClock(after[1]);
      if (a) timeDim = { key: "time", label: "Time", state: "CONSTRAINED", value: { type: "timeWindow", start: a.time, end: "24:00" }, display: `After ${formatTimeLabel(a.time)}`, needsConfirmation: a.assumed };
    } else if (at) {
      const a = parseClock(at[1]);
      if (a) timeDim = { key: "time", label: "Time", state: "LOCKED", value: { type: "time", start: a.time }, display: formatTimeLabel(a.time), needsConfirmation: a.assumed };
    } else if (/\b(night|evening|tonight)\b/.test(lower)) {
      timeDim = { key: "time", label: "Time", state: "CONSTRAINED", value: { type: "timeWindow", start: "17:00", end: "24:00" }, display: "Evening (5 PM – midnight)", needsConfirmation: true };
    } else if (/\bafternoon\b/.test(lower)) {
      timeDim = { key: "time", label: "Time", state: "CONSTRAINED", value: { type: "timeWindow", start: "12:00", end: "17:00" }, display: "Afternoon (noon – 5 PM)", needsConfirmation: true };
    } else if (/\bmorning\b/.test(lower)) {
      timeDim = { key: "time", label: "Time", state: "CONSTRAINED", value: { type: "timeWindow", start: "08:00", end: "12:00" }, display: "Morning (8 AM – noon)", needsConfirmation: true };
    }
    dims.push(timeDim ?? { key: "time", label: "Time", state: "UNDECIDED", value: null, display: "Undecided", needsConfirmation: false });
  }

  const title = buildTitle(text);
  const draft: PlanExtraction = { title, kind, mode, dimensions: dims, shortlist, clarifications };
  return planExtractionSchema.parse(draft);
}

function dateDraft(key: string, label: string, date: string, dayName: string): DimensionDraft {
  return { key, label, state: "LOCKED", value: { type: "dates", dates: [date] }, display: `${dayName} (${formatDateLabel(date)})`, needsConfirmation: false };
}

const TEMPORAL = new Set([...WEEKDAYS, ...MONTHS, "tonight", "tomorrow", "today", "next", "this", "sometime", "weekend"]);

/** "Firebirds Friday" -> "Firebirds": drop trailing date words from a captured name. */
function trimTemporalWords(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && TEMPORAL.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ""))) words.pop();
  return words.join(" ");
}

function buildTitle(text: string): string {
  const t = text.replace(/[.!?]+$/, "").trim();
  const short = t.length > 80 ? `${t.slice(0, 77)}…` : t;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

// ---------------------------------------------------------------------------
// Participant constraints
// ---------------------------------------------------------------------------

function draft(kind: ConstraintDraft["kind"], strength: "hard" | "soft", params: Record<string, unknown>, label: string, sourceText: string): ConstraintDraft {
  return { kind, strength, params, label, sourceText };
}

function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|,\s*(?:and\s+)?|\s+and\s+(?=i\b|i'|my\b|we\b)|\s+also\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sundayStyleClarification(sourceText: string, day: Weekday, kind: InterpretationContext["kind"]): ClarificationDraft {
  const D = cap(day);
  const prev = WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7];
  if (kind === "travel") {
    return {
      sourceText,
      question: `When you say you can't go ${D}, what do you mean?`,
      options: [
        { label: `I need to be home before ${D}`, constraint: { kind: "latest_arrival_home", strength: "hard", params: { weekday: prev, time: "23:59" } } },
        { label: `I can't travel on ${D}`, constraint: { kind: "no_travel_day", strength: "hard", params: { weekday: day } } },
        { label: `I'm unavailable for the whole day ${D}`, constraint: { kind: "unavailable_day", strength: "hard", params: { weekday: day } } },
        { label: "Something else", constraint: null },
      ],
    };
  }
  return {
    sourceText,
    question: `When you say you can't go ${D}, what do you mean?`,
    options: [
      { label: `I'm unavailable for the whole day ${D}`, constraint: { kind: "unavailable_day", strength: "hard", params: { weekday: day } } },
      { label: `${D} could work, but I'd rather not`, constraint: { kind: "day_preference", strength: "soft", params: { weekday: day, prefer: false } } },
      { label: `Only part of ${D} is out — I'll mark my availability`, constraint: null },
      { label: "Something else", constraint: null },
    ],
  };
}

export function parseParticipantStatement(input: string, ctx: InterpretationContext): ConstraintExtraction {
  const constraints: ConstraintDraft[] = [];
  const clarifications: ClarificationDraft[] = [];
  const unparsed: string[] = [];
  const travel = ctx.kind === "travel";

  for (const clause of splitClauses(input)) {
    const c = clause.toLowerCase().replace(/[’]/g, "'");
    const before = constraints.length + clarifications.length;

    // Budget
    let m = /(?:can(?:no|')?t|cannot|won't|will not|unable to)\s+(?:spend|pay|do)\s+(?:more than|over|above)\s*\$?\s?(\d[\d,]*)/.exec(c)
      ?? /(?:max(?:imum)?(?: budget)?(?: is| of)?|no more than|hard (?:limit|cap)(?: of| is)?|absolute max(?:imum)?(?: is)?)\s*\$\s?(\d[\d,]*)/.exec(c)
      ?? /\$\s?(\d[\d,]*)\s*(?:is my|max(?:imum)?|tops|hard limit)/.exec(c);
    if (m) {
      const amount = money(m[1]);
      constraints.push(draft("max_budget", "hard", { amount, currency: "USD" }, `Cannot spend more than ${formatMoney(amount)}`, clause));
    }
    m = /(?:prefer|rather|ideally|like to|hoping to|want to)\b.{0,25}?(?:under|below|less than|around|about)\s*\$\s?(\d[\d,]*)/.exec(c)
      ?? /(?:keep it|stay) (?:under|below)\s*\$\s?(\d[\d,]*)(?!.*\b(?:must|have to|need)\b)/.exec(c);
    if (m && !constraints.some((x) => x.kind === "max_budget" && x.sourceText === clause)) {
      const amount = money(m[1]);
      constraints.push(draft("preferred_budget", "soft", { amount, currency: "USD" }, `Prefers to keep it under ${formatMoney(amount)}`, clause));
    }

    // Dietary
    m = /allerg(?:ic|y) to ([a-z ]+?)(?:$|[.,;!]|\s+and\b)/.exec(c);
    if (m) {
      const restriction = m[1].trim().replace(/^(?:all\s+)?/, "");
      constraints.push(draft("dietary", "hard", { restriction }, `Allergic to ${restriction}`, clause));
    }
    m = /\b(?:i'm|i am|we're)\s+(vegetarian|vegan|gluten[- ]free|pescatarian|kosher|halal|dairy[- ]free)\b/.exec(c) ?? /\b(?:i|we) (?:don't|do not|can't) eat (meat|pork|gluten|dairy|shellfish|fish|nuts)\b/.exec(c);
    if (m) {
      const restriction = m[1].replace(/\s+/g, "-");
      constraints.push(draft("dietary", "hard", { restriction }, `Dietary: ${restriction}`, clause));
    }

    // Cuisine preferences
    const cuisineHits = CUISINES.filter((x) => new RegExp(`\\b${x}\\b`).test(c));
    if (cuisineHits.length && /\b(love|prefer|craving|in the mood for|really want|fan of|like)\b/.test(c) && !/\bnot a fan|don't like|hate|no\b/.test(c)) {
      constraints.push(draft("cuisine_preference", "soft", { cuisines: cuisineHits.map(cap), mode: "prefer" }, `Prefers ${cuisineHits.map(cap).join(", ")}`, clause));
    } else if (cuisineHits.length && /\b(not a fan of|don't like|do not like|hate|no|skip|avoid)\b/.test(c)) {
      constraints.push(draft("cuisine_preference", "soft", { cuisines: cuisineHits.map(cap), mode: "avoid" }, `Would rather avoid ${cuisineHits.map(cap).join(", ")}`, clause));
    }

    // Areas
    m = /(?:rather not|don't want to|prefer not to|would rather avoid|avoid)\s+(?:drive|driving|go|going|head)?\s*(?:to|into)?\s*(downtown|midtown|uptown|the [a-z]+ side|[a-z]+ omaha)/.exec(c);
    if (m) constraints.push(draft("avoid_area", "soft", { area: cap(m[1].replace(/^the /, "")) }, `Would rather avoid ${cap(m[1].replace(/^the /, ""))}`, clause));

    // Travel distance/time
    m = /(?:within|no more than|less than|under|max(?:imum)?)\s*(\d{1,3})\s*(?:min|minutes)\b/.exec(c);
    if (m) {
      const minutes = Number(m[1]);
      const soft = /\b(prefer|ideally|rather|like)\b/.test(c);
      constraints.push(draft("max_travel_minutes", soft ? "soft" : "hard", { minutes }, soft ? `Prefers under ${minutes} min away` : `Won't travel more than ${minutes} min`, clause));
    }

    // Departure / arrival (travel) and start/end (activities)
    m = new RegExp(`(?:can(?:no|')?t|cannot|unable to)\\s+(?:leave|go|start|head out|get there)\\s+(?:until|before)\\s+${CLOCK}(?:\\s*(?:on\\s+)?${DAY_RE})?`).exec(c);
    if (m) {
      const clock = parseClock(m[1]);
      const day = m[2] ? weekdayFrom(m[2]) : null;
      if (clock) {
        const params = { time: clock.time, ...(day ? { weekday: day } : {}) };
        constraints.push(
          travel
            ? draft("earliest_departure", "hard", params, `Cannot depart before ${formatTimeLabel(clock.time)}${day ? ` ${cap(day)}` : ""}`, clause)
            : draft("earliest_start", "hard", params, `Can't start before ${formatTimeLabel(clock.time)}${day ? ` ${cap(day)}` : ""}`, clause),
        );
      }
    }
    m = new RegExp(`(?:need|have|got) to be (?:home|back)\\s+(?:on\\s+)?(?:${DAY_RE}\\s+)?(?:before|by)\\s+${CLOCK}(?:\\s*(?:on\\s+)?${DAY_RE})?`).exec(c);
    if (m) {
      const clock = parseClock(m[2]);
      const dayToken = m[1] ?? m[3];
      const day = dayToken ? weekdayFrom(dayToken) : null;
      if (clock) {
        const params = { time: clock.time, ...(day ? { weekday: day } : {}) };
        constraints.push(
          travel
            ? draft("latest_arrival_home", "hard", params, `Must arrive home by ${formatTimeLabel(clock.time)}${day ? ` ${cap(day)}` : ""}`, clause)
            : draft("latest_end", "hard", params, `Must wrap up by ${formatTimeLabel(clock.time)}${day ? ` ${cap(day)}` : ""}`, clause),
        );
      }
    }
    m = new RegExp(`(?:have to|need to|must) (?:leave|be done|wrap up|go) by\\s+${CLOCK}`).exec(c);
    if (m && !travel) {
      const clock = parseClock(m[1]);
      if (clock) constraints.push(draft("latest_end", "hard", { time: clock.time }, `Must wrap up by ${formatTimeLabel(clock.time)}`, clause));
    }
    m = new RegExp(`(?:won't|will not|can't|cannot) (?:get|make it) (?:there|in) (?:until|before)\\s+${CLOCK}`).exec(c) ?? new RegExp(`\\b(?:arrive|get there|get in) (?:at|around|after)\\s+${CLOCK}`).exec(c);
    if (m && !travel) {
      const clock = parseClock(m[1]);
      if (clock) constraints.push(draft("earliest_start", "hard", { time: clock.time }, `Can't start before ${formatTimeLabel(clock.time)}`, clause));
    }

    // Day preferences: "I'd rather do Sunday but Saturday works"
    m = new RegExp(`(?:rather|prefer|ideally)\\s+(?:do\\s+|go\\s+)?(?:on\\s+)?${DAY_RE}`).exec(c);
    if (m) {
      const day = weekdayFrom(m[1])!;
      constraints.push(draft("day_preference", "soft", { weekday: day, prefer: true }, `Prefers ${cap(day)}`, clause));
    }

    // Whole-day unavailability — explicit vs ambiguous
    m = new RegExp(`(?:busy|unavailable|out of town|away|working|booked)\\s+(?:all day\\s+)?(?:on\\s+)?${DAY_RE}|${DAY_RE}\\s+(?:is|'s)\\s+(?:out|no good|a no)|(?:all day|the whole day|entire day)\\s+(?:on\\s+)?${DAY_RE}`).exec(c);
    if (m && !/\bnot (?:busy|working)\b/.test(c)) {
      const day = weekdayFrom(m[1] ?? m[2] ?? m[3])!;
      constraints.push(draft("unavailable_day", "hard", { weekday: day }, `Unavailable all day ${cap(day)}`, clause));
    } else {
      m = new RegExp(`\\b(?:i )?(?:can(?:no|')?t|cannot|won't be able to)\\s+(?:go|do|make it|come|make)?\\s*(?:on\\s+)?${DAY_RE}\\b`).exec(c);
      if (m && constraints.length + clarifications.length === before) {
        // Ambiguous: never guess a hard rule.
        clarifications.push(sundayStyleClarification(clause, weekdayFrom(m[1])!, ctx.kind));
      }
    }

    // Nonstop
    if (/\bnonstop|non-stop|direct flights?\b/.test(c)) {
      const hard = /\bonly|must|need|have to\b/.test(c) && !/\bprefer|rather|ideally\b/.test(c);
      constraints.push(draft("nonstop_only", hard ? "hard" : "soft", {}, hard ? "Nonstop flights only" : "Prefers nonstop flights", clause));
    }

    // Accessibility
    if (/\bwheelchair|accessible|mobility|can't do stairs|no stairs\b/.test(c)) {
      constraints.push(draft("accessibility", "hard", { need: "wheelchair accessible" }, "Needs wheelchair accessibility", clause));
    }

    if (constraints.length + clarifications.length === before && clause.replace(/[^a-z]/gi, "").length > 2) {
      unparsed.push(clause);
    }
  }

  // Deduplicate identical constraints.
  const seen = new Set<string>();
  const unique = constraints.filter((x) => {
    const key = `${x.kind}|${x.strength}|${JSON.stringify(x.params)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return constraintExtractionSchema.parse({
    constraints: unique,
    needsClarification: clarifications.length > 0,
    clarifications,
    unparsed,
  });
}
