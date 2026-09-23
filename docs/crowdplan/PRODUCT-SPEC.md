# CrowdPlan — authoritative structured product specification

Status: complete specification derived from the user-supplied master prompt; implementation unverified. The [original master specification](MASTER-SPEC.md) controls wording and scope if a discrepancy is discovered. Requirement IDs below are stable and map to [REQUIREMENTS.md](REQUIREMENTS.md). Technical defaults in ARCHITECTURE.md are implementation proposals.

## 1. Purpose and scope — CP-01, CP-36

“Tell CrowdPlan what your group has already figured out. CrowdPlan figures out the rest.”

CrowdPlan turns a fragmented group-chat decision into one source of truth. Capture what is settled and flexible, collect everyone's availability and constraints, find overlap, evaluate known candidates, optionally discover more, calculate feasibility and compromises, and reach consensus. It must not primarily behave as a recommendation engine.

Representative input: “Vala's sometime next weekend”; “Dinner at Firebirds Friday”; “Dinner Friday, Italian, somewhere out west, under $40”; “Which of these three restaurants should we choose?”; “Find something fun Saturday night”; “Vegas sometime in October, 3–4 nights, under $800 each.”

V1 excludes payment processing, automatic booking, restaurant reservations, ticket purchasing, social feeds, public profiles, chat, native mobile apps, and complex enterprise administration. External booking links are allowed. A coherent V1 may simplify implementation, but must retain every core capability specified here.

## 2. Planning dimensions — CP-02

Typical dimensions: activity, place/destination, date, time, participants, budget, candidates/options, transportation, lodging, and context-specific dimensions such as cuisine, area, or trip duration.

| State | Meaning | Engine rule |
| --- | --- | --- |
| LOCKED | A settled value or limit | Preserve unless an authorized user explicitly changes it |
| CONSTRAINED | A bounded set/range of acceptable values | Resolve only inside those limits |
| UNDECIDED | Not yet resolved | Resolve using known dimensions and group constraints |

The engine must resolve undecided dimensions without violating locked or constrained dimensions. These are architectural concepts, not labels painted over an unconstrained search.

Examples: Vala's locks the activity, constrains the date to next weekend, and leaves time undecided. Italian dinner locks Friday and dinner, constrains cuisine to Italian, area to West Omaha and budget to $25–$40/person, leaving restaurant and time undecided. Vegas locks destination and a maximum $800/person budget, constrains October and 3–4 nights, and leaves flights/hotel undecided. A locked maximum is still an inequality, not a demand to spend exactly that amount.

## 3. Creation and interpretation — CP-03, CP-04

Start with “What are you trying to plan?” and the representative examples above. Parse natural language into structured dimensions, then show “Here's what I understood.” Every extracted value is editable and states are visibly distinct.

Use an LLM abstraction when a runtime key exists; prefer Anthropic when ANTHROPIC_API_KEY is available. Limit the LLM to intent/dimension/constraint/preference extraction, ambiguity detection, and clarification generation. Validate structured output. It must never choose winning candidates or invent decision explanations. Without a key, implement a deterministic parser for common date/time/budget statements and retain the provider interface.

Hard example: “I can't leave before 5 Friday because of work, and I need to be home Sunday before 9” yields earliest departure Friday 17:00 and latest arrival home Sunday 21:00, displayed for confirmation/editing. Ambiguous example: “I can't go Sunday” must set a clarification-needed state, with choices such as home before Sunday, cannot travel Sunday, unavailable all Sunday, or something else. Do not activate an ambiguous hard rule before the user resolves it. Preserve unresolved input and do not silently promote guesses into hard constraints.

## 4. Identity and participation — CP-05, CP-06, CP-21

Organizers have accounts using Supabase Auth. Prefer configured Google OAuth; email magic link or OTP is sufficient and Google configuration must not block the build. A guest follows a plan link, enters a display name, and participates without creating an account. Use secure invitation tokens and plan-scoped authorization/RLS. A short display slug alone is not proof of authorization.

Organizers manage their plans. Participants have only appropriate rights within invited plans. Anonymous visitors have no access without a valid invitation. Optional later signup may claim the guest's profile and save preferences; a display-name match is not ownership proof.

Use normalized Supabase PostgreSQL with migrations. Candidate entities include users/profiles, plans, members, invites, dimensions, constraints, preferences, availability windows, candidate sets, candidates, components, external snapshots, votes/reactions, clarification questions, notifications, plan events, and saved friend preferences. The schema may improve on this list.

## 5. Participant questions and availability — CP-07, CP-08

Generate relevant questions rather than one generic questionnaire. Activities ask availability, preferred times, maximum travel distance/time, budget, absolute exclusions, and other context. Dinner adds dietary restrictions, cuisines and travel preferences. Travel asks origin, dates, preferred and absolute maximum budgets, destination/flight/lodging preferences, and hard schedule requirements.

Keep HARD constraints and SOFT preferences separate: shellfish allergy or “cannot spend more than $50” is hard; avoiding downtown, preferring under $35, or preferring Sunday while accepting Saturday is soft.

Availability supports IDEAL, WORKS and NOT AVAILABLE, date ranges, day-specific time windows, hard unavailability, and preferences. Show individual availability and group overlap. Eric after 18:00 Friday, Jake after 19:00 Friday and Sarah 17:00–21:00 Friday intersect at 19:00–21:00. Unknown responses must not look like confirmed availability. Timezone and relative-date interpretations must be visible/editable.

## 6. Planning modes and shortlist — CP-09

| Mode | Expected behavior |
| --- | --- |
| Fixed option | Lock the named place/activity; solve remaining dimensions. No alternatives unless explicitly requested. |
| Criteria-based | Solve group availability/constraints first, then search inside viable criteria. |
| Discovery | Optionally generate candidates using availability, location, budget, preferences, distance and other constraints. |
| Shortlist | Enrich and compare supplied choices only; broader suggestions require explicit request. |

Shortlists accept a place URL, a typed place name, and a manually entered custom candidate. Firebirds, Charleston's, and Texas Roadhouse are the master prompt's example. Fixed, criteria-based and discovery planning must work equally well; shortlist is a first-class workflow too.

## 7. External data, candidates and cost control — CP-10, CP-11, CP-12, CP-13

Use SerpAPI as the primary provider with SERPAPI_API_KEY, behind replaceable server-side provider interfaces. Support Google Maps/local restaurants, venues, attractions and activities; Google Search events/general information/official pages; Google Flights itineraries; and Google Hotels lodging. Normalize and validate responses; UI must never depend on SerpAPI response shapes.

Local data includes ratings, review count, address, coordinates, categories, hours and price level where available. Flights include origin/destination, dates, price, itinerary, timing, stops and metadata. Hotels include stay dates, guest counts, pricing, ratings and property details.

A universal candidate supports restaurant, event, activity, destination, flight package and custom types; ID, title, description, location, coordinates, cost range, available times, provider data, timestamps, attributes, suitable images, and components as applicable. Travel composes destination, dates, individual flight options, hotel, estimated local expenses and total per participant.

Retain provider, fetchedAt, source URL where available and useful raw/provider references. Distinguish LIVE/RECENT EXTERNAL DATA, ESTIMATE, USER ENTERED and UNKNOWN. Demo is an additional clear label. Unknown pricing says “Price not verified”; unverified hours say “Hours unavailable.” Never fabricate precision or label fixtures live.

Searches are scarce. Implement normalized cache keys, configurable TTL/timestamps, duplicate-query prevention, request counters, per-plan search budgets, result reuse, shortlist-only automatic refreshing, and bounded fan-out. Collect constraints → find viable windows → derive viable criteria → narrow shortlist → query APIs → evaluate → refresh serious contenders. One known locked venue may need one lookup. Do not repeatedly refresh static details or multiply every participant, destination, weekend and flight option.

## 8. Feasibility, ranking and explanations — CP-14, CP-15, CP-16

The constraint engine is deterministic code. Hard predicates cover schedule, cost, distance/time and availability. A hard failure makes that candidate infeasible for that participant. If universal feasibility is required, any unresolved hard violation makes the candidate “Not currently feasible,” with person-specific reasons such as $42 over maximum or no arrival before 20:00.

Only candidates passing required hard constraints receive normal ranking scores. Missing data cannot prove a hard constraint passes. Candidate scoring may consider schedule, cost, travel convenience, preferences, venue/activity quality, voting, lodging and transportation. Calculate average satisfaction, minimum participant satisfaction, hard/soft compromise counts, ideal-match count, budget fit and convenience distribution. Fairness must prevent a strong average from hiding one person's poor outcome. Exact weights are an implementation decision, documented and tested.

Explanations come from structured engine output with positives, compromises and hardViolations. Show strengths and tradeoffs, including above-preferred-but-below-maximum budgets. A “group fit” score is a model output, not a scientific probability or a factual claim of consensus. Hard violations cannot be hidden by a soft score.

## 9. Consensus, realtime and resolution board — CP-17, CP-19, CP-20

Participants react LOVE IT, WORKS FOR ME, ACCEPTABLE, RATHER NOT or CAN'T DO THIS. The last response requires a reason: price, schedule, place, distance, transportation, accessibility or other. Determine whether it identifies a missing hard constraint and activate that constraint only after confirmation. Calculate an honest group alignment state using structured responses; incomplete responses are not unanimity.

Use Supabase Realtime: response counts, votes, consensus and rankings update without refresh. Isolate subscriptions by authorization as well as plan identity.

The central resolution board immediately distinguishes settled and unresolved work, using LOCKED, CONSTRAINED, UNDECIDED, RESOLVED and BLOCKED visual states. It shows what/when/who, response counts, budget relevance and consensus. Domain dimension states remain the three states in section 2; resolved/blocked also communicate progress rather than silently replacing those domain states.

## 10. Make This Work / Resolve It — CP-18

Analyze near-feasible candidates and identify concrete obstacles. Search bounded nearby alternatives when appropriate, propose the smallest meaningful changes, show per-person impacts, and rerun all hard predicates before claiming success.

Travel example: Sarah must be home before 21:00; a 22:34 return fails. An alternative arriving 19:38 for +$47 can make Austin work only after considering arrival home and remaining constraints including maximum budget. Simpler example: ask whether an escape room may start at 20:30 when Jake arrives at 20:15. Generate the smallest useful follow-up question; do not repeatedly ask facts already known. A proposal is not a silent change to a locked choice or confirmed hard requirement. No available fix must be reported honestly.

## 11. Notifications, automation and deadlines — CP-23, CP-24

Implement in-app notifications and, with RESEND_API_KEY, email notifications. Events may include invitations, reminders, everyone responded, significant candidate changes, consensus and finalization. Avoid excessive or duplicate notifications.

Use simple available scheduling: Supabase scheduled functionality, Vercel cron or an existing equivalent. Jobs include refresh_candidate_data, recalculate_plan, send_participant_reminder, check_plan_deadline, check_consensus and send_plan_update. Cadence reflects urgency: tonight's dinner versus a trip in three months; locked/finalized plans get minimal or no refreshing.

An organizer may set “Decide by Thursday 8 PM.” Track responses, remind only missing participants, notify the organizer when all respond, and surface blockers near the deadline without spamming the group.

## 12. Final plan and saved preferences — CP-25, CP-28

Organizer finalization moves the UI to a clean shared result. Dinner/activity includes place, date, time, map, participants, notes and relevant external details. Travel includes destination, dates, flights per traveler, hotel, estimated per-person costs, links and itinerary. All authorized guests see it. Finalization does not purchase tickets, reserve a restaurant, book a hotel or charge a card.

Optionally allow an upgraded guest account to save home area, usual dinner budget, favorite cuisines, dietary restrictions, activity and travel preferences. Future plans may prefill stable preferences with editing. Sensitive or uncertain information must not be automatically applied without confirmation.

## 13. Design, maps and performance — CP-22, CP-26, CP-27, CP-34

Premium consumer design: confident typography, strong hierarchy, spacing, polished mobile layouts, subtle surfaces, clear interactions, useful empty states, expressive participant avatars, tactile voting and meaningful transitions. Avoid an enterprise admin panel, generic AI dashboard or endless template cards. A phone opened from a group-chat link is the primary experience; desktop becomes a powerful planning workspace.

Build six purposeful signature visualizations: availability heatmap, overlapping-time view, participant constraint matrix, candidate comparison, consensus visualization and resolution board. Do not add charts without a planning question to answer.

Use Tailwind, shadcn/ui where useful, Motion/Framer Motion for meaningful transitions, and chart libraries only when needed. Use MapLibre if practical for places, activities, destinations and appropriate participant-origin context. Make PWA installation and dark/light modes excellent if practical. Record conditional-feature outcomes rather than silently omitting them.

Avoid external searches on the initial critical render path, excessive API calls and massive unnecessary component trees. Cache expensive work, provide meaningful loading/progress and use optimistic UI when safe.

## 14. Runtime, secrets and demo mode — CP-29, CP-30

Prefer Next.js App Router, TypeScript, Supabase PostgreSQL/Auth/Realtime/RLS, SerpAPI, Anthropic when configured, Tailwind, shadcn/ui, Motion, MapLibre, Zod, Vitest, Playwright, Vercel and Sentry if readily available. Inspect the environment and use current documentation through Context7 when available. Secrets belong in environment variables, never source or browser bundles.

Include polished, unmistakably labeled demo plans: Vala's next weekend; a three-restaurant Friday shortlist; Saturday-night discovery; Vegas in October under $800. Demo pricing must never be confused with external/live prices. Missing optional LLM/Google/Resend credentials do not prevent core work. Missing SerpAPI credentials still block verification of the required real integration.

## 15. Verification, security and delivery — CP-31, CP-32, CP-33, CP-35, CP-36

Automate dimension handling, availability intersection, hard/soft constraints, feasibility, scoring/fairness, budgets, parser schema validation, normalization, caching, budgets, consensus and finalization permissions. Execute Playwright A–I in ACCEPTANCE.md, including realistic multiple users and actual app flows, not just the landing page.

Protect secrets, RLS, guest plan isolation, provider routes, URLs/HTML, rate limits, LLM schemas and external response schemas; guard against user-URL SSRF. Inspect browser and server/deployment errors and fix critical issues.

Use coherent Git commits, create/use a repository and push when authenticated GitHub tooling exists. Deploy to Vercel, configure Supabase and production variables, apply migrations and run Playwright against the actual production URL at mobile and desktop sizes. Fix, redeploy and reverify as needed.

Done means all core behavior works, automated tests pass, production is deployed and browser-tested, major mobile flows work, no critical console/runtime errors remain, and the user receives the verified live URL. Code, a build, schema, attractive landing page, one successful API request or a deployment merely starting is not completion.
