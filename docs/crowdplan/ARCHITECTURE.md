# Architecture and domain invariants

This is implementation guidance derived from the product contract. Inspect the repository, verify current APIs and record actual choices in DECISIONS.md. Do not treat the folder suggestions or policy defaults here as additional user-prescribed product features.

## Boundaries

| Boundary | Responsibility | Must not do |
| --- | --- | --- |
| Presentation | Accessible responsive components and structured results | Read provider response shapes or privileged keys |
| Application services | Authorization, transactions, orchestration, jobs and idempotency | Let client-supplied identity decide permissions |
| Domain | Dimensions, constraints, overlap, feasibility, scores, consensus, explanations | Perform network requests or ask an LLM to decide |
| Interpretation | Validated extraction, deterministic fallback and clarification | Activate ambiguous hard constraints |
| Provider adapters | SerpAPI/LLM/notification calls, validation and normalization | Leak provider credentials or masquerade fixtures as live |
| Persistence | Migrations, RLS, snapshots, cache, budgets and event history | Expose another plan's data |

A practical layout is `src/app`, `src/components/crowdplan`, `src/domain`, `src/server`, `src/providers`, `supabase/migrations`, and `tests`. Adapt to the existing repository. Keep pure domain functions easily unit-testable and server dependencies out of client bundles.

## Core types and state

- A dimension has a key, state, typed value or bounds, source and confirmation information. Separate progress indicators such as blocked/resolved from its three-state semantic model.
- A constraint identifies its subject, predicate, hard/soft strength, parameters, provenance, confirmation state and applicable dimension. Pending clarification is not an active hard constraint.
- Availability stores date/time windows and IDEAL/WORKS/NOT AVAILABLE. Keep timezone explicit, persist concrete instants where appropriate and render local intent accurately. Define overnight windows, daylight-saving changes, inclusive/exclusive boundaries, duration, and missing responses.
- A candidate is normalized and typed, with optional components, monetary bounds/currency/basis, time/location fields, attributes and provenance. Do not turn price-level symbols into precise monetary quotes.
- A fact should retain value, source kind, provider, fetchedAt and source URL as applicable. Travel may mix live airfare and estimated local costs; preserve provenance at component level, not only on the outer card.
- A feasibility result is PASS, FAIL or UNKNOWN per relevant hard predicate, plus structured reasons. UNKNOWN is not PASS. Aggregate according to the plan's participant requirements. Default to all confirmed required participants; document any attendance-policy support.
- An evaluation carries candidate/version, participant outcomes, structured positives/compromises/hardViolations, and ranking metrics. Required hard failures cannot be compensated by soft scores.
- Store reactions and confirmed constraint changes separately. A CAN'T DO THIS reaction initiates diagnosis; it does not give a free-text objection unchecked authority to rewrite the plan.

## Engine order

1. Validate and normalize dimensions, confirmed constraints and participant responses.
2. Compute viable date/time windows and flag missing/ambiguous inputs.
3. Apply locked/constrained plan dimensions and per-participant hard predicates.
4. Separate infeasible and unverified candidates from feasible candidates.
5. Score feasible candidates using documented categories/weights and deterministic tie-breaking.
6. Calculate fairness: average and minimum satisfaction, ideal counts, compromise counts, budget and convenience distribution. Choose a policy that cannot hide extreme individual dissatisfaction behind averages; record it with example rankings.
7. Calculate consensus from reactions and response completeness separately from model fit.
8. Generate explanations directly from evaluated facts and expose the input/version used.

A proposed hard-constraint change or Make This Work repair requires confirmation and full re-evaluation. Count unresolved hard compromises but do not include them in normal feasible ranking. If comparison has too little evidence, render uncertainty rather than a confident percentage.

## Authorization and guest identity

Choose and document a current, supported Supabase guest-session design. Anonymous Supabase authentication behind an invitation redemption flow or a server-mediated scoped session may fit; verify the selected method against current docs and test its complete data/realtime path. “No account required” means no user signup requirement, not absence of a secure identity.

Use high-entropy invite credentials, store verifiers rather than reusable plaintext secrets where practical, define expiry/revocation behavior, and exchange invitations for scoped membership/session access. Prevent reusable token leakage through logs, analytics and referrers. Separate public display codes from bearer authority.

RLS and application checks must verify membership/role on every protected read/write; possession of an authenticated role alone is insufficient. Guests may update their own answers and reactions, not other participants or organizer decisions. User-editable metadata/display names must not grant roles. Updates must not let a user reassign plan ownership or membership. Test direct API access, not just page navigation.

Use least privilege. Service-role access stays server-only and bypasses RLS, so privileged paths need explicit authorization. Check grants, views, functions and realtime behavior as well as base tables. Guest-to-account claiming requires proof of the current guest session, never display-name matching. Preserve responses without duplicate membership.

## Persistence and consistency

Use normalized relations for stable identities and relationships; JSON may hold typed provider attributes or snapshots without replacing relational integrity. Enforce uniqueness for membership, votes and cache identity where needed, foreign keys, timestamps and useful indexes. Keep raw provider payloads private and retain only useful data.

Version or otherwise guard plan evaluation against stale writes. Apply meaningful mutations atomically; recalculate on affected changes. Handle duplicate realtime events, reconnects, concurrent votes and optimistic rollback. Finalization checks organizer permission and current plan state transactionally. Default to blocking unresolved required hard violations; if product behavior needs an exception, surface it explicitly and never claim the exception is feasible.

## Provider cache and search budgets

Build canonical query keys from provider, engine, normalized search criteria, location, dates/timezone, party counts, currency and relevant options. Keep user-specific sensitive inputs isolated where needed. Configure TTL by data volatility: static venue facts differ from flight prices.

Use a shared cache and an atomic in-flight claim or equivalent deduplication, not only per-process memory. Reserve/check a plan's budget before outbound calls; record attempts and actual calls consistently, including retries. Bound retries and fan-out. Concurrent identical requests must not each charge or launch a search.

Narrow dates/candidates before flight/hotel expansion. For multiple origins and shared lodging, document allocation and occupancy assumptions; include all relevant fees when known, label estimates, and do not assume an airport arrival equals arrival home. Do not claim an option meets a maximum budget if a material cost is unknown.

Treat timeouts, provider errors, missing fields and rate limits as explicit states. Reuse permitted stale data with visible timestamps when appropriate. Refresh only serious contenders and stop/minimize work on locked/finalized plans. Never silently swap a configured production provider for fake data.

## Repair search

Make This Work consumes structured blockers, generates bounded candidate changes, ranks changes by documented minimality/cost, rechecks every hard constraint, and presents exact affected people and costs. A known locked venue remains locked unless the user asks to change it. New alternatives consume the same provider budgets/cache. If no repair exists, explain the blocker and ask one focused question only when its answer could help.
