# Acceptance and release gates

Every result needs an environment, commit, timestamp, actual command/test, outcome and evidence path in PROGRESS.md. These are acceptance requirements, not claims that tests already passed. Derive deterministic fixtures for dates and timezones; avoid tests that depend on whichever Friday the machine happens to run.

## Automated domain coverage

| Area | Minimum meaningful assertions |
| --- | --- |
| Dimensions | Locked choices remain fixed; bounds hold; undecided dimensions resolve; unauthorized state changes fail |
| Availability | 18:00+/19:00+/17:00–21:00 gives 19:00–21:00; no overlap, exclusions, preferred windows, ranges and missing responses |
| Temporal boundaries | Duration, overnight windows, timezone conversion, daylight-saving and arrival-home versus arrival-airport |
| Hard/soft rules | Hard failures cannot be scored away; soft preferences change rank, not feasibility; uncertainty is not pass |
| Budget | Preferred versus maximum, per-person/currency basis, missing prices, component totals and shared hotel allocation |
| Scores/fairness | Deterministic ties, low-satisfaction outlier, average/minimum metrics and compromise counts |
| Parsing | Schema rejection, editable extraction, no-key fallback, ambiguous Sunday stays inactive until clarified |
| Normalization | Local/search/flight/hotel fixtures; missing fields, provenance, estimates, timestamps and malformed responses |
| Cache/budget | Key equivalence, key distinctions, TTL, reuse, concurrent deduplication, exhaustion and bounded retries/fan-out |
| Consensus | Every reaction, incomplete responses, objection reasons, confirmation and recalculation |
| Repairs | Fix exists, no fix, fix breaks another constraint, added cost exceeds max and locked dimension preservation |
| Finalization | Organizer only, guests see result, concurrent/stale mutations and unresolved blockers |

Use Vitest or an appropriate TypeScript framework. Supplement pure tests with actual database/API permission tests. Mocks establish repeatable logic, not real provider connectivity.

## Required multi-user Playwright scenarios A–I

Use isolated browser contexts for organizer and participants. Assertions must inspect visible behavior and persisted state where relevant. Do not rely on fixed sleeps; wait for the expected state. Seed only what is outside the flow under test. Auth acceptance must exercise the real configured login path at least once rather than only injecting a session.

| ID | Setup and actions | Required proof |
| --- | --- | --- |
| A | Organizer creates “Vala's next weekend”; invite four guests with different availability | Fixed place retained, strongest overlap correct, individual and group views agree |
| B | Create “Dinner Friday, Italian, West Omaha, under $40”; enter differing budgets/preferences | Viable windows precede discovery, required filters hold, ranking/fairness visible; real SerpAPI when configured |
| C | Supply three named restaurants | Only those choices enriched; no broad discovery call without explicit request; custom candidate/URL entry works |
| D | Enter “I can't go Sunday” | Clarification shown; no guessed hard rule; chosen clarification applied and editable |
| E | Guest votes while organizer watches | Supabase Realtime updates response count/consensus/rank as applicable without page refresh |
| F | Candidate violates one required participant's hard constraint | Marked not currently feasible, person and exact reason shown; excluded from normal feasible ranking |
| G | Run Make This Work against a known blocker | Specific change and impact shown; feasible repair passes every predicate; no-fix case is honest |
| H | Vegas travel plan with flights and hotels | Live provider requests proven, per-traveler totals/components and estimates correct, timestamps and source labels visible |
| I | Organizer finalizes | All invited guests see consistent finalized result; guest finalization denied; no booking/payment performed |

## Security and resilience

Test outsider, organizer, invited guest, guest from another plan, and revoked/invalid invite. Attempt direct reads and writes, member/owner reassignment, cross-plan candidate/vote access, and realtime subscription leakage. Verify signup/account claim cannot seize another guest's profile.

Check client bundles and responses for privileged/provider secrets. Test validation failures, URL schemes and SSRF defenses including internal/private targets and redirects; never trust external HTML. Provider endpoints must enforce server-side authorization, rate limits and budgets. Validate LLM and provider schemas. Confirm migrations and exposed tables have correct grants/RLS.

Exercise provider timeout/rate limit/malformed response, budget exhaustion, stale data, disconnected realtime, duplicate events, retrying jobs, expired session, empty candidate set, no overlap and no feasible result. Production tests use their own tagged records; never mutate unrelated user data.

## UX and performance

At representative 390px mobile and 1440px desktop widths, complete creation → guest response → comparison/voting → resolution → finalization. Check overflow, tap targets, keyboard flow, visible focus, label/error association, contrast and non-color state cues. Motion respects reduced-motion settings. Verify the six signature views answer real questions and remain usable with sparse data.

Measure actual initial load and expensive query behavior; document budgets based on the deployed environment rather than inventing unmeasured claims. Initial navigation must not wait on discovery searches. Confirm loading, error and empty states. If PWA/themes/maps are implemented, verify their actual behavior; if not practical, record why.

## Production exit checklist

- [ ] All required domain/integration tests pass; type checking, lint and production build pass using repository scripts.
- [ ] Migrations are applied to the intended Supabase environment; organizer/guest authorization tests pass.
- [ ] Required SerpAPI local/search/flight/hotel adapters have successful real requests and normalized results; no fixture substitution.
- [ ] Production organizer signup/login and invite redemption work with configured auth redirects.
- [ ] Scenarios A–I are verified against the production deployment; distinguish any fixture-based repair edge case from live-provider smoke evidence.
- [ ] Mobile and desktop core flows pass; realtime works across independent sessions.
- [ ] Browser console, network failures and server/deployment logs reviewed; no unresolved critical runtime/security bugs.
- [ ] Fixes redeployed and affected tests rerun against the current deployment, not a superseded preview.
- [ ] Test-owned records cleaned up or clearly identified; deployment commit, URL and evidence recorded.
- [ ] Final report includes verified production URL, test outcomes, conditional-feature decisions and honest limitations.

A missing real-integration credential or inaccessible production test remains a failed/blocked release gate. Continue independent work, then request the exact missing requirement; never relabel it as passed.
