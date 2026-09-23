# Decision log

The master prompt remains controlling. Each entry: date, decision, alternatives, rationale, CP IDs, evidence.

| Decision | Status | Summary |
| --- | --- | --- |
| Existing repository and preferred stack | Decided 2026-09-22 | Next.js 16.3.6 App Router + TS + Tailwind 4, Supabase (Postgres 17, Auth, Realtime, RLS), Zod 4.6, Vitest 5, Playwright 1.63, Motion 13, MapLibre 6, Anthropic SDK 0.128 |
| Guest sessions, invite redemption, account claim | Decided 2026-09-22 | Server-minted guest identity via `join-plan` edge function; claim tickets |
| Dimension transitions and temporal model | Decided 2026-09-22 | See D-03 |
| Required-participant policy | Decided 2026-09-22 | All members are required (D-04) |
| Scoring/fairness policy | Decided 2026-09-22 | D-05 |
| Unknown/stale evidence policy | Decided 2026-09-22 | D-06 |
| Provider queries, TTL and budgets | Pending phase 04 | |
| Travel totals and Make This Work | Decided 2026-09-22 (domain) | D-07, D-08 |
| Jobs/notification cadence | Decided 2026-09-22 (design) | pg_cron → pg_net → authenticated `/api/jobs/run` (D-09) |
| Finalization/concurrent changes | Decided 2026-09-22 | `finalize_plan` RPC with expected version (D-10) |
| MapLibre, themes and PWA | Pending phase 08 | |
| Saved stable preferences | Pending phase 07 | Claim path built (D-02) |
| Anthropic, Google OAuth, Resend, Sentry | Assessed 2026-09-22 | Keys absent → deterministic parser, email auth, in-app notifications, console logging |
| Release/recovery | Pending phase 10 | |

## D-01 Stack and environments (CP-29, CP-35) — 2026-09-22

- Kept the empty repo's history; scaffolded Next.js via `create-next-app` in the scratchpad and copied in (docs untouched). Exact versions pinned (`--save-exact`).
- Two Supabase projects in the user's free org: `crowdplan-test` (safe test environment; resettable) and `crowdplan` (production). This uses the org's two free active-project slots; the test project can be paused after release.
- No Docker locally, so the test project replaces a local stack.

## D-02 Identity, guests and claiming (CP-05, CP-06, CP-21, CP-33) — 2026-09-22

- **Organizers** use Supabase Auth email (magic link / password). Google OAuth only when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` after provider setup.
- **Guests**: alternatives were Supabase anonymous sign-ins (requires a dashboard/Management-API toggle not available to the tools, and creates an identity before the invite is checked) or a server-mediated scoped session. Chosen: the `join-plan` edge function verifies `share_code` + bearer token hash first, then mints a confirmed guest user flagged in **app_metadata** (not user-editable), adds membership through `redeem_invite_as` (service_role only), and returns a single-use magic-link token hash. The browser exchanges it with `verifyOtp` for a normal session, so RLS and Realtime authorize guests exactly like accounts. Evidence: `auth-rls.test.ts` "guest participation without signup".
- **Invites**: 32-byte base64url token; only SHA-256 stored. Share link is `/p/<CODE>#<token>` so the bearer token is in the URL fragment (never sent to servers, logs or referrers). Public code alone grants nothing. Revocation stops new joins, existing members keep access. Default expiry: none; organizer can revoke/regenerate.
- **Claim**: a guest session calls `create_claim_ticket()` (guest JWT required) → 30-minute single-use ticket; after signing into an account, `redeem_claim_ticket()` rebinds that guest's memberships. Display names are never used as proof. If the account is already in the same plan the guest row is skipped, not merged.
- Organizer-only mutations (dimensions, invites, finalization, proposal decisions) are enforced by RLS/column grants and definer RPCs that check `auth.uid()`; tested directly against the Data API.

## D-03 Temporal model (CP-02, CP-08) — 2026-09-22

- All instants stored as `timestamptz`; plan carries an IANA timezone (default America/Chicago). Local wall-clock → instant via `date-fns-tz` (`fromZonedTime`), DST-safe (tested on 2026-11-01).
- Availability windows are half-open `[start, end)`. Per member precedence: explicit NOT AVAILABLE > IDEAL > WORKS; adjacent windows jointly cover a slot. A member who shared availability but left a period unmarked is *unmarked* (not available); a member who shared nothing is *unknown* and is never counted as available.
- Relative dates are shown for confirmation (`needsConfirmation`). "next weekend" = the weekend after the upcoming one; weekday names = next occurrence, asking when it could mean today. Times 1–11 without am/pm are read as PM and flagged as assumed.
- Arrival-home model for travel: return arrival + member `home_buffer_minutes` (default 45) must be ≤ deadline.

## D-04 Required participants (CP-14) — 2026-09-22

Universal feasibility: every plan member is required. A candidate with any participant FAIL is "Not currently feasible" and never ranked. No attendance-policy exceptions in V1.

## D-05 Scoring and fairness (CP-15) — 2026-09-22

- Category weights: schedule 0.25, cost 0.20, travel 0.15, preference 0.20, quality 0.10, vote 0.10. Categories without data are excluded (not zeroed); with no data a member is "neutral 60, low confidence".
- Group fit = round(0.55 × average + 0.45 × minimum satisfaction). Example (tested): an option loved by two and poor for Sarah (min ≤ 40) ranks below a balanced option.
- Deterministic tie-breaks: group fit → minimum satisfaction → ideal matches → fewer soft compromises → lower max per-person cost → title → id.
- Only FEASIBLE candidates get a rank. UNVERIFIED follow unranked; INFEASIBLE last (fewest failures first).

## D-06 Unknown and estimated evidence (CP-11, CP-14) — 2026-09-22

- Predicates return PASS / FAIL / UNKNOWN; UNKNOWN never counts as PASS. A candidate with no FAIL but a non-advisory UNKNOWN is UNVERIFIED ("needs checking").
- Opening hours unknown are *advisory* ("Hours unavailable" is shown but doesn't block), because they are not a participant's hard requirement; known-closed is a FAIL.
- Price-level symbols map to labeled ESTIMATE ranges ($ 8–18, $$ 15–35, $$$ 30–60, $$$$ 55–120 per person). Estimated passes are marked "(estimate)". A hard max FAILs only when the lowest possible price exceeds it; ranges straddling the max are UNKNOWN.
- Dietary: known conflicting categories FAIL (e.g. seafood for shellfish); otherwise UNKNOWN until a member marks the candidate checked (`attributes.dietaryVerified`).
- Drive times are straight-line estimates (×1.3 road factor, 45 km/h, +5 min), always labeled estimates.

## D-07 Travel totals (CP-13, CP-18) — 2026-09-22

Per traveler: own selected outbound + return flights + equal share of the hotel stay (rooms = ceil(travelers / 2) unless specified; nightly × nights × rooms) + per-person local-expense estimate component. Any unknown required part leaves the total's upper bound unknown, so a maximum budget cannot PASS.

## D-08 Make This Work (CP-18) — 2026-09-22

- Consumes FAIL checks. Travel: tries cached alternative flights for each blocked traveler, re-running all predicates (including maximum budget and arrival home) per trial; picks the minimal cost delta. Activities: tries start times on :00/:30 within allowed dates and time bounds, feasible first then smallest shift. Bounded to 400 evaluations.
- A change that touches a LOCKED time is returned as a *question* ("Would everyone be okay starting at 8:30 PM?") needing confirmation. Locked places are never changed; unfixable blockers (place excluded, dietary conflict, plan budget) produce an honest "no fix" plus at most one focused question to the specific person (e.g. a small budget stretch).
- When no alternatives are cached, the result lists bounded `searchesNeeded` for the server to run within the plan budget.

## D-09 Scheduling (CP-24) — 2026-09-22 (design)

Vercel Hobby cron runs only daily, so scheduling uses Supabase `pg_cron` → `pg_net` → `POST /api/jobs/run` with a shared secret (`CROWDPLAN_JOB_SECRET`, stored in Vault/app settings). Implementation in phase 07.

## D-10 Finalization (CP-25) — 2026-09-22

`finalize_plan(plan, candidate, expected_version, snapshot, notes)` locks the plan row, requires owner, `collecting` status and matching version (stale → HTTP 409 via `PT409`), stores the snapshot and fans out deduplicated notifications. Guests are denied; finalized plans reject further guest writes (RLS `plan_is_open`).

## D-11 Least-privilege server database role (CP-12, CP-33) — 2026-09-22

The Supabase secret/service-role key is not obtainable through available tools, and using it for app logic would bypass RLS anyway. The Next.js server uses `crowdplan_server` (explicit grants + table-scoped RLS policies, not BYPASSRLS) only for server-owned state: provider cache, search ledger/budgets, live candidate enrichment, notifications and jobs. All user-facing reads/writes use the user's JWT.
