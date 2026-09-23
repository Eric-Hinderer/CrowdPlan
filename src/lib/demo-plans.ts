// Clearly-labeled demo plans. Every record is source_kind "demo"; demo prices
// are never presented as live data. Dates are generated relative to today.
import { addDays, localDate, weekdayOfDate, zonedInstant } from "@/domain/time";
import type { AvailabilityLevel, Dimension, Money, WeeklyHours } from "@/domain/types";
import type { CandidateRow, ComponentRow, ConstraintRow, MemberRow, PlanBundle, PlanRow } from "./plan-data";

const TZ = "America/Chicago";

export const DEMO_PLANS = [
  { slug: "valas", modeLabel: "Place is set", headline: "Vala's sometime next weekend", blurb: "Six people, one pumpkin patch. Find the time that works." },
  { slug: "shortlist", modeLabel: "Shortlist", headline: "Which of these three restaurants Friday?", blurb: "Firebirds, Charleston's or Texas Roadhouse — compared, not re-searched." },
  { slug: "discovery", modeLabel: "Ideas", headline: "Something fun Saturday night", blurb: "Options that fit everyone, plus Make This Work on a timing clash." },
  { slug: "vegas", modeLabel: "Trip", headline: "Vegas in October, under $800", blurb: "Per-person flights, a shared hotel and one late return flight to fix." },
] as const;

export type DemoSlug = (typeof DEMO_PLANS)[number]["slug"];

let seq = 0;
const id = (p: string) => `00000000-0000-4000-8000-${p.padStart(4, "0")}${String(++seq).padStart(8, "0")}`.slice(0, 36);

const COLORS = ["#5b3df5", "#ff6b4a", "#2bb673", "#3d8bfd", "#f5a524", "#b15cff"];

function member(name: string, i: number, extra: Partial<MemberRow> = {}): MemberRow {
  return {
    id: id(`m${i}`),
    plan_id: "",
    user_id: id(`u${i}`),
    role: i === 0 ? "organizer" : "guest",
    display_name: name,
    color: COLORS[i % COLORS.length],
    emoji: null,
    origin_label: null,
    origin_lat: null,
    origin_lng: null,
    home_buffer_minutes: 45,
    responded_at: new Date().toISOString(),
    joined_at: new Date().toISOString(),
    ...extra,
  };
}

function money(min: number | null, max: number | null, basis: Money["basis"] = "per_person"): Money {
  return { min, max, currency: "USD", basis, kind: "range", sourceKind: "demo" };
}

function cand(title: string, extra: Partial<CandidateRow>): CandidateRow {
  return {
    id: id("c"),
    plan_id: "",
    type: "restaurant",
    title,
    description: null,
    origin: "demo",
    status: "active",
    source_kind: "demo",
    provider: null,
    provider_ref: null,
    source_url: null,
    fetched_at: null,
    address: null,
    lat: null,
    lng: null,
    cost: null,
    rating: null,
    review_count: null,
    price_level: null,
    hours: null,
    categories: [],
    attributes: {},
    starts_at: null,
    ends_at: null,
    enrichment_status: "none",
    added_by: null,
    created_at: new Date().toISOString(),
    ...extra,
  };
}

function constraint(memberId: string, kind: ConstraintRow["kind"], strength: "hard" | "soft", params: Record<string, unknown>, label: string): ConstraintRow {
  return { id: id("k"), plan_id: "", member_id: memberId, kind, strength, params, status: "active", source: "demo", source_text: null, label, created_at: new Date().toISOString() };
}

function win(memberId: string, date: string, start: string, end: string, level: AvailabilityLevel = "works") {
  const s = zonedInstant(date, start, TZ);
  let e = zonedInstant(date, end, TZ);
  if (e <= s) e += 86_400_000;
  return { memberId, start: s, end: e, level };
}

function dim(key: string, label: string, state: Dimension["state"], value: Dimension["value"], display: string): Dimension {
  return { key, label, state, value, display, source: "demo", needsConfirmation: false };
}

function plan(title: string, kind: PlanRow["kind"], mode: PlanRow["mode"], extra: Partial<PlanRow> = {}): PlanRow {
  return {
    id: id("p"),
    owner_id: id("owner"),
    title,
    raw_input: title,
    kind,
    mode,
    discovery_enabled: mode === "discovery",
    status: "collecting",
    timezone: TZ,
    location_label: "Omaha, NE",
    location_lat: 41.2565,
    location_lng: -95.9345,
    min_duration_minutes: kind === "dinner" ? 90 : 120,
    decide_by: null,
    share_code: "DEMO22",
    search_budget: 12,
    searches_used: 0,
    version: 1,
    finalized_candidate_id: null,
    finalized_at: null,
    final_snapshot: null,
    final_notes: null,
    is_demo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

function bundle(p: PlanRow, members: MemberRow[], parts: Partial<PlanBundle>): PlanBundle {
  for (const m of members) m.plan_id = p.id;
  const me = members[members.length - 1];
  return {
    plan: p,
    members,
    me,
    isOrganizer: false,
    dimensions: [],
    constraints: [],
    clarifications: [],
    availability: [],
    candidates: [],
    components: [],
    reactions: [],
    responses: {},
    proposals: [],
    proposalAnswers: [],
    events: [],
    loadedAt: Date.now(),
    ...parts,
  };
}

function nextSaturday(today: string, weeksAhead: number) {
  let d = today;
  while (weekdayOfDate(d) !== "saturday") d = addDays(d, 1);
  return addDays(d, 7 * weeksAhead);
}

const weekendHours: WeeklyHours = { saturday: [{ open: "09:00", close: "19:00" }], sunday: [{ open: "09:00", close: "19:00" }], friday: [{ open: "16:00", close: "21:00" }] };
const dinnerHours: WeeklyHours = {
  sunday: [{ open: "11:00", close: "21:00" }], monday: [{ open: "11:00", close: "21:00" }], tuesday: [{ open: "11:00", close: "21:00" }], wednesday: [{ open: "11:00", close: "21:00" }],
  thursday: [{ open: "11:00", close: "22:00" }], friday: [{ open: "11:00", close: "23:00" }], saturday: [{ open: "11:00", close: "23:00" }],
};

export function buildDemo(slug: DemoSlug, now = Date.now()): PlanBundle {
  seq = 0;
  const today = localDate(now, TZ);
  if (slug === "valas") {
    const sat = nextSaturday(today, 1);
    const sun = addDays(sat, 1);
    const p = plan("Vala's sometime next weekend", "activity", "fixed", { min_duration_minutes: 180 });
    const ms = ["Eric", "Jake", "Sarah", "Priya", "Marcus", "You"].map((n, i) => member(n, i));
    const [eric, jake, sarah, priya, marcus, you] = ms;
    const valas = cand("Vala's Pumpkin Patch", { plan_id: p.id, type: "venue", address: "12102 S 180th St, Gretna, NE", lat: 41.1225, lng: -96.2046, rating: 4.5, review_count: 5200, cost: money(28, 34), hours: weekendHours, categories: ["Pumpkin patch", "Family attraction"], origin: "fixed" });
    return bundle(p, ms, {
      dimensions: [
        dim("place", "Where", "LOCKED", { type: "place", name: "Vala's Pumpkin Patch" }, "Vala's Pumpkin Patch"),
        dim("date", "When", "CONSTRAINED", { type: "dateRange", start: sat, end: sun }, "Next weekend"),
        dim("time", "Time", "UNDECIDED", null, "Undecided"),
      ],
      candidates: [valas],
      availability: [
        win(eric.id, sat, "09:00", "13:00"), win(eric.id, sun, "12:00", "19:00", "ideal"),
        win(jake.id, sat, "14:00", "19:00"), win(jake.id, sun, "13:00", "19:00"),
        win(sarah.id, sat, "09:00", "12:00", "unavailable"), win(sarah.id, sun, "13:30", "19:00", "ideal"),
        win(priya.id, sun, "10:00", "18:30"), win(priya.id, sat, "10:00", "15:00"),
        win(marcus.id, sun, "11:00", "19:00", "ideal"),
        win(you.id, sun, "13:00", "19:00"),
      ],
      constraints: [constraint(marcus.id, "max_budget", "hard", { amount: 40 }, "Cannot spend more than $40")],
      reactions: [
        { candidateId: valas.id, memberId: eric.id, reaction: "love" },
        { candidateId: valas.id, memberId: sarah.id, reaction: "love" },
        { candidateId: valas.id, memberId: priya.id, reaction: "works" },
        { candidateId: valas.id, memberId: marcus.id, reaction: "works" },
        { candidateId: valas.id, memberId: jake.id, reaction: "works" },
      ],
    });
  }
  if (slug === "shortlist") {
    let fri = today;
    while (weekdayOfDate(fri) !== "friday") fri = addDays(fri, 1);
    if (fri === today) fri = addDays(fri, 7);
    const p = plan("Which of these three restaurants Friday?", "dinner", "shortlist");
    const ms = ["Eric", "Jake", "Sarah", "Priya", "You"].map((n, i) => member(n, i));
    const [eric, jake, sarah, priya, you] = ms;
    eric.origin_lat = 41.26; eric.origin_lng = -96.18; eric.origin_label = "West Omaha";
    sarah.origin_lat = 41.24; sarah.origin_lng = -95.95; sarah.origin_label = "Midtown";
    const firebirds = cand("Firebirds Wood Fired Grill", { plan_id: p.id, address: "17415 Chicago St, Omaha, NE", lat: 41.2598, lng: -96.1875, rating: 4.5, review_count: 2100, cost: money(30, 50), price_level: "$30–50", hours: dinnerHours, categories: ["Steakhouse", "American restaurant"], origin: "shortlist" });
    const charlestons = cand("Charleston's", { plan_id: p.id, address: "13851 Bel Dr, Omaha, NE", lat: 41.2352, lng: -96.1283, rating: 4.4, review_count: 1800, cost: money(20, 35), price_level: "$20–35", hours: dinnerHours, categories: ["American restaurant"], origin: "shortlist" });
    const roadhouse = cand("Texas Roadhouse", { plan_id: p.id, address: "2002 N 72nd St, Omaha, NE", lat: 41.2745, lng: -96.0231, rating: 4.3, review_count: 3900, cost: money(15, 30), price_level: "$15–30", hours: dinnerHours, categories: ["Steakhouse"], origin: "shortlist" });
    return bundle(p, ms, {
      dimensions: [
        dim("activity", "What", "LOCKED", { type: "text", text: "Dinner" }, "Dinner"),
        dim("place", "Restaurant", "UNDECIDED", null, "One of 3 options"),
        dim("date", "When", "LOCKED", { type: "dates", dates: [fri] }, "Friday"),
        dim("time", "Time", "UNDECIDED", null, "Undecided"),
      ],
      candidates: [firebirds, charlestons, roadhouse],
      availability: [
        win(eric.id, fri, "18:00", "23:00"), win(jake.id, fri, "19:00", "23:00"), win(sarah.id, fri, "17:00", "21:00", "ideal"),
        win(priya.id, fri, "18:30", "22:00"), win(you.id, fri, "18:00", "22:00"),
      ],
      constraints: [
        constraint(sarah.id, "max_budget", "hard", { amount: 40 }, "Cannot spend more than $40"),
        constraint(priya.id, "preferred_budget", "soft", { amount: 30 }, "Prefers under $30"),
        constraint(jake.id, "cuisine_preference", "soft", { cuisines: ["Steak"], mode: "prefer" }, "Prefers steak"),
        constraint(eric.id, "max_travel_minutes", "soft", { minutes: 15 }, "Prefers under 15 min away"),
      ],
      reactions: [
        { candidateId: charlestons.id, memberId: sarah.id, reaction: "love" },
        { candidateId: charlestons.id, memberId: eric.id, reaction: "works" },
        { candidateId: roadhouse.id, memberId: jake.id, reaction: "love" },
        { candidateId: firebirds.id, memberId: priya.id, reaction: "rather_not" },
      ],
    });
  }
  if (slug === "discovery") {
    const sat = nextSaturday(today, 0) === today ? addDays(today, 7) : nextSaturday(today, 0);
    const p = plan("Something fun Saturday night", "activity", "discovery", { min_duration_minutes: 90 });
    const ms = ["Eric", "Jake", "Sarah", "You"].map((n, i) => member(n, i));
    const [eric, jake, sarah, you] = ms;
    const t = (hhmm: string) => new Date(zonedInstant(sat, hhmm, TZ)).toISOString();
    const escape = cand("Escape room: The Heist", { plan_id: p.id, type: "event", starts_at: t("20:00"), ends_at: t("21:00"), cost: money(32, 32), address: "Old Market, Omaha, NE", lat: 41.2555, lng: -95.9313, categories: ["Escape room"], origin: "discovery" });
    const bowling = cand("Maplewood Lanes", { plan_id: p.id, type: "venue", cost: money(15, 25), hours: { saturday: [{ open: "12:00", close: "24:00" }] }, address: "8970 Maple St, Omaha, NE", lat: 41.2851, lng: -96.0438, rating: 4.3, review_count: 640, categories: ["Bowling alley"], origin: "discovery" });
    const comedy = cand("Comedy at the Funny Bone", { plan_id: p.id, type: "event", starts_at: t("19:30"), ends_at: t("21:15"), cost: money(25, 40), address: "17305 Davenport St, Omaha, NE", lat: 41.2619, lng: -96.1872, rating: 4.6, review_count: 900, categories: ["Comedy club"], origin: "discovery" });
    const trivia = cand("Trivia night at a brewery", { plan_id: p.id, type: "activity", cost: null, hours: null, categories: ["Bar", "Trivia"], origin: "discovery" });
    return bundle(p, ms, {
      dimensions: [
        dim("activity", "What", "UNDECIDED", null, "Something fun"),
        dim("date", "When", "LOCKED", { type: "dates", dates: [sat] }, "Saturday"),
        dim("time", "Time", "CONSTRAINED", { type: "timeWindow", start: "17:00", end: "24:00" }, "Evening"),
        dim("budget", "Budget", "CONSTRAINED", { type: "money", max: 45, currency: "USD", basis: "per_person" }, "≤ $45/person"),
      ],
      candidates: [escape, bowling, comedy, trivia],
      availability: [win(eric.id, sat, "18:00", "24:00"), win(jake.id, sat, "20:00", "24:00"), win(sarah.id, sat, "17:00", "23:30", "ideal"), win(you.id, sat, "18:00", "24:00")],
      constraints: [constraint(jake.id, "earliest_start", "hard", { time: "20:15" }, "Can't start before 8:15 PM (work)")],
      reactions: [
        { candidateId: escape.id, memberId: eric.id, reaction: "love" },
        { candidateId: escape.id, memberId: sarah.id, reaction: "love" },
        { candidateId: bowling.id, memberId: jake.id, reaction: "works" },
      ],
    });
  }
  // Vegas
  const [y, m] = today.split("-").map(Number);
  const year = m > 10 ? y + 1 : y;
  let start = `${year}-10-15`;
  while (weekdayOfDate(start) !== "friday") start = addDays(start, 1);
  const end = addDays(start, 3);
  const p = plan("Vegas in October, 3-4 nights, under $800 each", "travel", "fixed", { min_duration_minutes: 120 });
  const ms = ["Eric", "Sarah", "Jake", "You"].map((n, i) => member(n, i, { origin_label: "OMA" }));
  const [eric, sarah, jake, you] = ms;
  const trip = cand(`Las Vegas · Oct ${Number(start.slice(8))}–${Number(end.slice(8))}`, { plan_id: p.id, type: "travel_package", attributes: { destination: "Las Vegas", startDate: start, endDate: end, nights: 3 }, origin: "demo" });
  const comps: ComponentRow[] = [];
  let sort = 0;
  const flight = (memberId: string, direction: "outbound" | "return", dep: [string, string], arr: [string, string], price: number, selected: boolean, depTz: string, arrTz: string, num: string) =>
    comps.push({
      id: id("f"),
      candidate_id: trip.id,
      kind: "flight",
      member_id: memberId,
      title: `${direction === "outbound" ? "OMA → LAS" : "LAS → OMA"} · Demo Air ${num}`,
      data: { direction, airline: "Demo Air", from: direction === "outbound" ? "OMA" : "LAS", to: direction === "outbound" ? "LAS" : "OMA", departAt: zonedInstant(dep[0], dep[1], depTz), arriveAt: zonedInstant(arr[0], arr[1], arrTz), stops: 0, durationMinutes: 180, flightNumbers: [num] },
      cost: { min: price, max: price, currency: "USD", basis: "per_person", kind: "quote", sourceKind: "demo" },
      source_kind: "demo",
      provider: null,
      fetched_at: null,
      source_url: null,
      is_selected: selected,
      sort: ++sort,
    });
  for (const mm of ms) {
    flight(mm.id, "outbound", [start, "18:30"], [start, "19:40"], 164, true, "America/Chicago", "America/Los_Angeles", "412");
    flight(mm.id, "return", [end, "19:05"], [end, "22:34"], 178, true, "America/Los_Angeles", "America/Chicago", "419");
  }
  // Alternative earlier return for Sarah (used by Make This Work).
  flight(sarah.id, "return", [end, "14:25"], [end, "19:38"], 225, false, "America/Los_Angeles", "America/Chicago", "417");
  comps.push({
    id: id("h"), candidate_id: trip.id, kind: "hotel", member_id: null, title: "The Linq Hotel (demo)",
    data: { name: "The Linq Hotel", checkIn: start, checkOut: end, nights: 3, rooms: 2, guests: 4, rating: 4.1 },
    cost: { min: 109, max: 109, currency: "USD", basis: "per_night", kind: "quote", sourceKind: "demo" }, source_kind: "demo", provider: null, fetched_at: null, source_url: null, is_selected: true, sort: ++sort,
  });
  comps.push({
    id: id("l"), candidate_id: trip.id, kind: "local_estimate", member_id: null, title: "Food & getting around (~$60/day estimate)",
    data: { perDay: 60, days: 4 }, cost: { min: 240, max: 240, currency: "USD", basis: "per_person", kind: "estimate", sourceKind: "estimate" }, source_kind: "estimate", provider: null, fetched_at: null, source_url: null, is_selected: true, sort: ++sort,
  });
  const dayWins = (memberId: string, from: string, days: number) => Array.from({ length: days }, (_, i) => win(memberId, addDays(from, i), "00:00", "24:00"));
  return bundle(p, ms, {
    dimensions: [
      dim("destination", "Destination", "LOCKED", { type: "place", name: "Las Vegas" }, "Las Vegas"),
      dim("dates", "Dates", "CONSTRAINED", { type: "dateRange", start: `${year}-10-01`, end: `${year}-10-31` }, `October ${year}`),
      dim("nights", "Length", "CONSTRAINED", { type: "nights", min: 3, max: 4 }, "3–4 nights"),
      dim("budget", "Budget", "CONSTRAINED", { type: "money", max: 800, currency: "USD", basis: "per_person" }, "≤ $800/person"),
      dim("flights", "Flights", "UNDECIDED", null, "Undecided"),
      dim("lodging", "Hotel", "UNDECIDED", null, "Undecided"),
    ],
    candidates: [trip],
    components: comps,
    availability: [...dayWins(eric.id, addDays(start, -1), 6), ...dayWins(sarah.id, start, 4), ...dayWins(jake.id, addDays(start, -2), 7), ...dayWins(you.id, start, 4)],
    constraints: [
      constraint(sarah.id, "latest_arrival_home", "hard", { weekday: weekdayOfDate(end), time: "21:00" }, "Must arrive home by 9 PM Monday"),
      constraint(sarah.id, "max_budget", "hard", { amount: 800 }, "Cannot spend more than $800"),
      constraint(jake.id, "earliest_departure", "hard", { weekday: "friday", time: "17:00" }, "Cannot depart before 5 PM Friday"),
      constraint(eric.id, "nonstop_only", "soft", {}, "Prefers nonstop"),
    ],
  });
}
