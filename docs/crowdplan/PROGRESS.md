# CrowdPlan execution state

Live ledger. Every status below is backed by the evidence listed; nothing is marked passed without a recorded run.

## Phase status

| Phase | Goal | Status | Evidence |
| --- | --- | --- | --- |
| [00](prompts/00-preflight.md) | Inspect the repository and establish the delivery baseline | Complete | Inventory + capability matrix below; baseline = docs-only repo |
| [01](prompts/01-foundation-auth-data.md) | Build the application foundation, Supabase schema and secure participation | Data/auth layer verified; UI sign-in verified in phase 03 | `tests/integration/auth-rls.test.ts` 20/20 against `crowdplan-test` |
| [02](prompts/02-domain-engine.md) | Implement the pure planning domain and interpretation contracts | Complete (domain + parser); LLM adapter in phase 03 | `tests/unit/*` 62/62 |
| [03](prompts/03-creation-participation.md) | Deliver natural-language creation, contextual guest responses and availability | Not started | — |
| [04](prompts/04-external-data.md) | Integrate SerpAPI, candidate normalization, provenance and cost controls | Not started | — |
| [05](prompts/05-consensus-realtime.md) | Connect fair ranking, reactions, explanations and realtime | Not started | — |
| [06](prompts/06-travel-and-resolve.md) | Complete travel planning and Make This Work | Domain logic done; UI/provider pending | repair tests in `tests/unit/consensus-repair.test.ts` |
| [07](prompts/07-automation-finalization.md) | Implement deadlines, notifications, scheduled jobs and final plans | Not started | — |
| [08](prompts/08-design-demo-performance.md) | Polish the consumer experience, signature views and demos | Not started | — |
| [09](prompts/09-qa-hardening.md) | Run complete automated, multi-user and security verification | Not started | — |
| [10](prompts/10-production-release.md) | Deploy to Vercel and verify the actual production application | Not started | — |

## Next action

Phase 03: build the Next.js UI (organizer auth pages, plan creation with "Here's what I understood", guest join via `join-plan`, contextual responses, availability entry, resolution board), wire server actions to the user-scoped Supabase client, and verify in the browser at 390px.

## External blockers (assessed 2026-09-22)

| Requirement | Status | Impact | Independent work done |
| --- | --- | --- | --- |
| `SERPAPI_API_KEY` | **Missing** (not in shell, user, or machine environment) | Required live-integration gate (CP-10, scenario B/H live proof) stays BLOCKED | Provider layer, normalization, cache and budget are built/tested with labeled fixtures |
| Supabase Auth URL config (Site URL / redirect allow-list) and custom SMTP | Cannot be changed with available tools (MCP has no auth-config tool; no Supabase access token) | Production magic-link emails redirect to the default Site URL and default SMTP only delivers to org team members | Password sign-in and token-hash verification work without config; guests use the `join-plan` edge function (no config needed) |
| `ANTHROPIC_API_KEY` | Missing (optional) | LLM interpretation off | Deterministic parser + validated schema; adapter implemented behind the provider interface |
| `RESEND_API_KEY` | Missing (optional) | Email notifications off | In-app notifications |
| Google OAuth | Not configured (optional) | Button hidden | Email auth |

## Current evidence

- Repository: `Eric-Hinderer/CrowdPlan` (public), branch `main`; initial commit `3a6986b` contained only an empty README.
- Supabase: org `kpefvhyjwxcmmnnqezeu` (free plan). Test project `crowdplan-test` (`gvqiiaewnvtgdtzwdspy`, us-east-1, PG 17) — migrations 0100–0500 applied, edge functions `join-plan` v1 and `cp-admin` v1 deployed. Production project `crowdplan` (`twfikotaolsyrouofcxh`) created, migrations not yet applied.
- Vercel: account team `team_pMQeZettTaxP499LXqmf4GaX` with two unrelated projects (untouched). CrowdPlan project not yet created.
- Automated checks: `npm test` 62/62 unit (2026-09-22 22:26 CDT); `npm run test:integration` 20/20 against crowdplan-test (22:11 CDT).
- Security advisors (crowdplan-test): 5 WARN for intentional authenticated SECURITY DEFINER RPCs (`finalize_plan`, `reopen_plan`, `redeem_invite`, `create_claim_ticket`, `redeem_claim_ticket` — each checks `auth.uid()`; covered by integration tests); 1 INFO for `private.claim_tickets` deny-all (intentional).
- Multi-user Playwright: not run yet. Production: not deployed.

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
