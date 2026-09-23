# CrowdPlan execution state

Live ledger. Every status below is backed by the evidence listed; nothing is marked passed without a recorded run.

## Phase status

| Phase | Goal | Status | Evidence |
| --- | --- | --- | --- |
| [00](prompts/00-preflight.md) | Inspect the repository and establish the delivery baseline | Complete | Inventory + capability matrix below |
| [01](prompts/01-foundation-auth-data.md) | Foundation, Supabase schema and secure participation | Complete | int `auth-rls.test.ts`; e2e organizer sign-in via `/login` + `/auth/confirm` |
| [02](prompts/02-domain-engine.md) | Pure planning domain and interpretation contracts | Complete | unit 80/80 |
| [03](prompts/03-creation-participation.md) | Natural-language creation, guest responses, availability | Complete | e2e A, B, C, D, mobile |
| [04](prompts/04-external-data.md) | SerpAPI, normalization, provenance, cost controls | Complete except live gate — **BLOCKED: `SERPAPI_API_KEY`** | unit `providers.test.ts`; e2e B asserts live search disabled + labeled |
| [05](prompts/05-consensus-realtime.md) | Fair ranking, reactions, explanations, realtime | Complete | e2e B, E, F; int realtime isolation |
| [06](prompts/06-travel-and-resolve.md) | Travel planning and Make This Work | Complete (fixture/estimate data; live flights/hotels blocked with CP-10) | e2e G, H; unit repair |
| [07](prompts/07-automation-finalization.md) | Deadlines, notifications, jobs, final plans | Complete (email conditional on `RESEND_API_KEY`) | int `jobs.test.ts`, `account.test.ts`; e2e I, saved preferences |
| [08](prompts/08-design-demo-performance.md) | Consumer experience, signature views, demos | Complete | four `/demo/*` plans; desktop 1440 + mobile 390 runs; zero console errors |
| [09](prompts/09-qa-hardening.md) | Automated, multi-user and security verification | Complete | `npm run verify` green; 80 unit / 30 int / 13 e2e; advisors reviewed |
| [10](prompts/10-production-release.md) | Deploy to Vercel and verify production | **In progress — BLOCKED on Vercel authorization** | Production Supabase ready and verified (below); Vercel API returns 403 for the team scope |

## Next action

1. User re-authenticates the Vercel connection (the MCP token returns `403 forbidden … You must re-authenticate to this scope` for team `eric-hinderers-projects-9db5122b` / `team_pMQeZettTaxP499LXqmf4GaX`), or installs/logs in the Vercel CLI.
2. Then: `create_git_project` for `Eric-Hinderer/CrowdPlan` (project `crowdplan`) → add production env vars from the local secrets file (names in `.env.example`; `NEXT_PUBLIC_APP_URL` = production URL) → deploy production → insert `jobs_url` = `<prod>/api/jobs/run` into production `private.app_settings` → run `E2E_BASE_URL=<prod> E2E_NO_SERVER=1 npx playwright test` with the production env → inspect Vercel runtime logs and browser console → verify a pg_cron dispatch reaches `/api/jobs/run` (job_runs row).
3. Supabase Auth URL configuration (Site URL + redirect allow-list = production URL) must be set in the dashboard; organizer email magic links otherwise land on the default Site URL. Password sign-in and guest joins do not depend on it.

## External blockers (updated 2026-09-22 23:50 CDT)

| Requirement | Status | Impact | Independent work done |
| --- | --- | --- | --- |
| Vercel authorization | **Blocked** — MCP token lost team scope (403); no Vercel CLI or token on the machine | Cannot create the project or deploy (CP-32 prod run, CP-35, CP-36) | Production Supabase fully provisioned; production build verified locally against the production backend (13/13 e2e) |
| `SERPAPI_API_KEY` | **Missing** | Live-provider gate (CP-10; live parts of B/H) stays BLOCKED | Provider layer, normalization, cache, dedupe, budget, retries tested with labeled fixtures; UI disables live search with an explicit label |
| Supabase Auth URL config + custom SMTP | Not changeable with available tools | Magic-link emails use the default Site URL; default SMTP only delivers to org members | Password sign-in, token-hash verification, and guest joins work without it |
| `ANTHROPIC_API_KEY` | Missing (optional) | LLM interpretation off | Deterministic parser + validated schema; adapter implemented |
| `RESEND_API_KEY` | Missing (optional) | Email notifications off | In-app notifications |

## Current evidence

- Repository `Eric-Hinderer/CrowdPlan` (public), `main`: commits d13dee1, efaee99, 9cfc35c, d8779d1 (+ this ledger commit).
- Supabase test `crowdplan-test` (`gvqiiaewnvtgdtzwdspy`): migrations 0100–0900; edge functions `join-plan` v2, `cp-admin` v3.
- Supabase production `crowdplan` (`twfikotaolsyrouofcxh`): migrations 0100–0900; `join-plan` v1 (same build hash as test), `cp-admin` v1; `crowdplan_server` LOGIN via SCRAM verifier; `e2e_admin_secret_sha256` + `jobs_secret` app settings set; `jobs_url` pending the Vercel URL. Catalog fingerprint identical to test (D-15).
- Automated checks (2026-09-22 23:29–23:47 CDT): `npm run verify` green (typecheck, lint, 80 unit, build); integration 30/30 against test **and** 30/30 against production Supabase; Playwright 13/13 (desktop + mobile) against local dev + test project **and** 13/13 against a local production build (`next start`) + production Supabase.
- Browser console on the production build: 0 errors (3 third-party OpenFreeMap style warnings); service worker registers; map renders.
- Advisors (production): security — 5 intentional authenticated SECURITY DEFINER RPCs (each checks `auth.uid()`, covered by int tests) + INFO deny-all `private.claim_tickets`; performance — 4 unindexed FKs fixed by migration 0900, 1 unused index on an empty cache table.
- Cleanup: every run deletes its own accounts/plans via `cp-admin cleanup`; production after runs: 0 users, 0 plans, 0 jobs, 0 notifications.

## Phase 00 record — 2026-09-22 21:40–21:55 CDT

- Inventory: repo contained only the CrowdPlan documentation pack (CLAUDE.md, CROWDPLAN-START-HERE.md, docs/) and an empty README. No app, migrations, tests or deploy config. Git remote `origin` → GitHub, authenticated `gh` (Eric-Hinderer).
- Toolchain: Node 24.19.0, npm 11.17.0, gh 2.101.0, Playwright 1.63 browsers present (chromium-1243). No Docker (no local Supabase stack), no global Vercel/Supabase CLIs.
- MCP capabilities verified: Supabase (org/project management, SQL, migrations, edge functions, advisors, logs — no auth-config or secret-key access), Vercel (projects, env, git-linked deployments, logs), GitHub, Playwright, Context7.
- Credential matrix (names only): only `GITHUB_PERSONAL_ACCESS_TOKEN` exists in user env. No SERPAPI/ANTHROPIC/RESEND/SENTRY/Supabase keys.
- Baseline build/test: none existed. Scaffolded Next.js 16.3.6 (App Router, TS, Tailwind 4) into the repo without touching docs; package scripts `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `verify`.
- Every CP requirement assigned an owner phase (REQUIREMENTS.md). No core feature deferred.

## Phase 01 record — 2026-09-22 21:55–22:12 CDT (data/auth layer)

- Migrations: `supabase/migrations/20260923000100…000500`. 17 RLS-protected public tables + private schema (provider cache, search ledger, rate limits, job runs, claim tickets, settings). Column-level grants restrict writable fields; anon has no table access.
- Guest sessions: `join-plan` edge function verifies the invite (hashed token) BEFORE creating an identity, rate-limits by IP, mints a guest-flagged user (`app_metadata.cp_guest`), adds membership via service-role-only RPC, returns a single-use token hash exchanged with `verifyOtp` → real Supabase session. No signup.
- Server role: `crowdplan_server` NOLOGIN in migrations; LOGIN + password set out-of-band per environment; connects via Supavisor pooler (verified `aws-0-us-east-1`).
- Commands: `npx vitest run --project integration` → 20/20 passed (13 s). First run had 1 failure: stale finalization raised SQLSTATE 40001, which PostgREST reports as retryable 503 → changed to `PT409` (migration 0500), rerun green.
- Remaining for phase 01 exit: organizer sign-in/out through the app UI (phase 03 browser check).

## Phase 02 record — 2026-09-22 22:12–22:27 CDT

- `src/domain/*`: types, time (tz-explicit, DST-safe), dimensions (LOCKED/CONSTRAINED/UNDECIDED search windows + invariant), availability (sweep-line overlap, heatmap), constraints (zod params), money (estimates labeled, unknown ≠ 0), feasibility (PASS/FAIL/UNKNOWN predicates), scoring (weights + fairness), consensus (+ objection diagnosis), evaluate (orchestrator + explanations + board statuses), travel (per-traveler totals), repair (Make This Work).
- `src/domain/interpretation/*`: shared Zod extraction schema + deterministic parser.
- Commands: `npx vitest run --project unit` → 62/62. Defects found and fixed during the run: closed-venue slot fallback; greedy place capture; case-sensitive area; "night" misread as travel; title-casing after apostrophes; multi-day availability coverage across adjacent windows; repair proposals now on :00/:30.

## Phases 03–09 record — 2026-09-22 22:30–23:40 CDT

- Built: prompt-based creation with "Here's what I understood" and editable dimensions; guest join through `join-plan`; contextual questions (activity/dinner/travel); availability painter, heatmap and timeline; resolution board; options with fairness and explanations; reactions with CAN'T-DO reasons and objection confirmation; Make This Work; travel components per traveler; finalization and reopen; notifications bell; `/me` claim + preferences with first-answer prefill; four labeled demo plans; PWA manifest/icons/service worker/offline page; light/dark themes; MapLibre maps; scheduled jobs; shared rate limits; CSP and security headers.
- Defects found by the suites and fixed: parser greediness/case/"night"/weekday-after-clock; closed-venue slot fallback; multi-day coverage; repair steps on :30; per-traveler travel budget; duplicate availability editors from a closed sheet; join rate-limit bucket shared with preview; welcome invite sheet blocking flows; locked time narrowing the grid; no-booking note only shown with links; budget copy; MapLibre worker URL; stale dev chunks served by a leftover service worker; claimed guest identities escaping test cleanup.
- Commands and results: see "Current evidence". Live-provider assertions in B/H are annotated `BLOCKED` in the Playwright report rather than skipped silently.

## Phase 10 record — 2026-09-22 23:40–23:55 CDT (partial; Vercel blocked)

- Production Supabase: migrations 0100–0900 applied via MCP (first parallel attempt collided on migration versions; the failed ones rolled back and were reapplied sequentially); catalog compared with test (D-15); `join-plan` + `cp-admin` deployed; server role verified through the pooler (connects, reads, denied `delete` on plans and `auth.users`).
- Verified against production Supabase from this machine: integration 30/30; Playwright 13/13 on a production build (`next build` + `next start`, CSP/HSTS headers present). Test data removed afterwards (counts all 0).
- Blocked: Vercel project creation/deploy (403 re-authentication required). Nothing is deployed to Vercel yet; there is no production URL.

## Handoff record template

- Date/time and phase:
- CP requirements changed:
- Code and migration changes:
- Actual commands, environment and exit results:
- Browser scenarios and evidence paths:
- Live versus demo/fixture data:
- Commit and deployed version if relevant:
- Defects fixed and remaining blockers:
- Test-owned resources and cleanup:
- Exact next executable action:
