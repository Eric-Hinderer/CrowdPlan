In progress — commits pending push |In progress — RLS, column grants, guest isolation, realtime isolation verified |In progress — 62 unit + 20 integration tests passing |In progress — stack chosen, secrets only in env; see DECISIONS D-01 |In progress — schema/RLS verified on crowdplan-test (`auth-rls.test.ts` 20/20) |In progress — repair engine verified in unit tests (+$47, budget break, no-fix, 8:30 question) |In progress — consensus + objection diagnosis verified in unit tests |In progress — explanation objects verified in unit tests |In progress — fairness verified in unit tests |In progress — predicates verified in unit tests |In progress — candidate/component types + travel totals verified in unit tests |In progress — overlap engine verified `tests/unit/availability.test.ts` |In progress — guest join/resume/isolation verified at API level (`auth-rls.test.ts`) |In progress — password + token-hash sign-in verified at API level (`auth-rls.test.ts`); UI pending |In progress — parser + schema verified `tests/unit/interpretation.test.ts`; LLM adapter pending |Implemented/unverified in UI — domain verified: `tests/unit/engine.test.ts` (dimension states) |In progress — scope captured in domain model (phase 00 inventory) |# Requirement traceability and evidence ledger

Status starts **Not started**. This package is specification material, not implementation evidence. Each CP ID maps to PRODUCT-SPEC.md; every original section is also preserved in MASTER-SPEC.md. A requirement spanning phases is not complete until all its behavior is verified. Conditional outcomes must be documented rather than silently waived.

| ID | Requirement | Phases | Acceptance summary | Status / evidence |
| --- | --- | --- | --- | --- |
| CP-01 | Product purpose and scope | 00 | Capture settled/flexible dimensions, collect constraints, evaluate feasibility and compromises, and reach consensus; recommendations are optional. | In progress — scope captured in domain model (phase 00 inventory) |
| CP-02 | Dimension model | 02 | LOCKED, CONSTRAINED, and UNDECIDED are enforced by the engine; context-specific dimensions are supported. | In progress — domain verified `tests/unit/engine.test.ts` (dimension states); UI pending |
| CP-03 | Natural-language creation | 03 | Simple prompt, editable interpretation, visible states, and confirmation of extracted values. | Not started |
| CP-04 | Interpretation and ambiguity | 02,03 | Provider abstraction, Anthropic preference, validated output, deterministic fallback, and clarification before hard constraints. | In progress — parser + schema verified `tests/unit/interpretation.test.ts`; LLM adapter pending |
| CP-05 | Organizer authentication | 01 | Supabase Auth; email link/OTP sufficient; Google OAuth when configured. | In progress — password + token-hash sign-in verified at API level (`auth-rls.test.ts`); UI pending |
| CP-06 | Guest participation and access | 01,03 | Secure plan invitation, display name, no account requirement, plan-scoped RLS and optional account claim. | In progress — guest join/resume/isolation verified at API level (`auth-rls.test.ts`) |
| CP-07 | Contextual response flow | 03 | Activity, dinner, and travel questions; separate hard requirements from soft preferences. | Not started |
| CP-08 | Availability | 02,03 | IDEAL/WORKS/NOT AVAILABLE, date and time ranges, hard exclusions, overlap and participant views. | In progress — overlap engine verified `tests/unit/availability.test.ts` |
| CP-09 | Planning modes | 03,04 | Fixed option, criteria-based, optional discovery, and shortlist; explicit opt-in for expanding candidates. | Not started |
| CP-10 | SerpAPI providers | 04,06 | Local/maps, search, flights, hotels; server-only normalized provider interfaces. | Not started |
| CP-11 | Data trust | 04,06 | Provider/time/source attribution; recent/live, estimate, user-entered, unknown and visible demo labels. | Not started |
| CP-12 | API cost controls | 04 | Normalized cache keys, TTL, deduplication, counters, per-plan budget, reuse, shortlist refresh, bounded search. | Not started |
| CP-13 | Universal candidates | 02,04,06 | Normalized places/events/custom/travel candidates and component candidates with provenance. | In progress — candidate/component types + travel totals verified in unit tests |
| CP-14 | Hard feasibility | 02,05 | Deterministic participant predicates and explicit violations; universal failure cannot rank as feasible. | In progress — predicates verified in unit tests |
| CP-15 | Soft scores and fairness | 02,05 | Average/minimum satisfaction, hard/soft compromises, ideal count, budget and convenience distribution. | In progress — fairness verified in unit tests |
| CP-16 | Structured explanations | 02,05 | Positives, compromises and hardViolations are generated from engine facts, never invented by an LLM. | In progress — explanation objects verified in unit tests |
| CP-17 | Consensus and objections | 05 | Five reactions; reason for CANNOT do; confirm new hard constraints; honest alignment state. | In progress — consensus + objection diagnosis verified in unit tests |
| CP-18 | Make This Work | 06 | Identify blockers, seek bounded minimal changes, show individual impacts, re-evaluate and ask focused questions. | In progress — repair engine verified in unit tests (+$47, budget break, no-fix, 8:30 question) |
| CP-19 | Resolution board | 03,05,08 | Settled/unresolved dimensions, participants, budget and consensus; LOCKED/CONSTRAINED/UNDECIDED/RESOLVED/BLOCKED. | Not started |
| CP-20 | Realtime | 05 | Votes, response counts, rankings and consensus update without refresh through Supabase Realtime. | Not started |
| CP-21 | Database | 01 | Normalized Supabase PostgreSQL, migrations, organizer/guest permissions and RLS. | In progress — schema/RLS verified on crowdplan-test (`auth-rls.test.ts` 20/20) |
| CP-22 | Maps | 04,08 | Use MapLibre when practical and location answers a planning question; no decorative maps. | Not started |
| CP-23 | Notifications | 07 | In-app notifications; email through Resend when configured; avoid duplicate/excessive messages. | Not started |
| CP-24 | Automation and deadlines | 07 | Adaptive scheduled refresh/recalculation/reminders/deadline/consensus updates; minimal finalized-plan refresh. | Not started |
| CP-25 | Finalization | 07 | Organizer finalizes, all guests see final activity/travel details; booking links only. | Not started |
| CP-26 | Consumer design and visualizations | 08 | Premium responsive mobile/desktop UX, six useful signature views, thoughtful states and meaningful motion. | Not started |
| CP-27 | PWA and themes | 08 | Installable PWA and excellent light/dark modes if practical; record the outcome. | Not started |
| CP-28 | Saved preferences | 07 | Optional profile claim and stable preference prefill, editable and confirmed when sensitive or uncertain. | Not started |
| CP-29 | Preferred stack and secrets | 00,01 | Inspect environment, prefer requested stack, use current docs, never hardcode or leak secrets. | In progress — stack chosen, secrets only in env (DECISIONS D-01) |
| CP-30 | Demo plans | 08 | Clearly labeled Vala’s, three-restaurant shortlist, Saturday discovery, and Vegas October plans. | Not started |
| CP-31 | Automated tests | 02,09 | All specified domain areas tested; meaningful failing-case assertions and release checks pass. | In progress — 62 unit + 20 integration tests passing |
| CP-32 | Playwright A–I | 09,10 | Realistic multi-user browser scenarios, production authentication, integrations, mobile and desktop. | Not started |
| CP-33 | Production security | 01,04,09 | Keys, RLS, guest isolation, unsafe URLs/HTML, rate limits, schema validation and SSRF protection. | In progress — RLS, column grants, guest + realtime isolation verified |
| CP-34 | Performance | 04,08,09 | Fast initial load, cached expensive data, bounded rendering, useful progress and appropriate optimism. | Not started |
| CP-35 | Git and deployment | 00,10 | Coherent commits, authenticated GitHub push when available, Vercel production, migrations and env. | In progress — commit d13dee1 pushed to origin/main |
| CP-36 | Autonomy and completion | 00,10 | Continue through verified production, fix critical bugs, provide live URL; no silent core scope cuts. | Not started |

## Evidence rules

Replace status with In progress, Blocked, Implemented/unverified, or Verified. Attach repository-relative test/report paths and the verified commit/environment. Distinguish automated logic tests, fixture-based browser tests, live provider checks and production checks. Mark conditional optional features with a documented decision and reason, never use that status for a core requirement.
