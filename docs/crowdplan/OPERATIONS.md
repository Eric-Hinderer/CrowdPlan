# Operations and release guidance

Inspect existing accounts/projects/environment before making changes. Reuse authorized resources where appropriate. This file does not contain secrets or claim any environment has been configured.

## Runtime configuration

| Variable/capability | Scope | Missing behavior |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Public app configuration | Discover/provision the intended Supabase project |
| NEXT_PUBLIC_SUPABASE_ANON_KEY or current supported public-key equivalent | Browser-safe key; verify SDK conventions | Configure public client; never substitute a privileged key |
| SUPABASE_SERVICE_ROLE_KEY | Server only, only where actually needed | Prefer least-privileged paths; obtain only if required |
| SERPAPI_API_KEY | Server only | Develop with labeled fixtures; real integration and release remain blocked |
| ANTHROPIC_API_KEY | Server only | Deterministic parser remains functional |
| Google OAuth configuration | Supabase/provider configuration | Use email magic link/OTP |
| RESEND_API_KEY | Server only | Keep in-app notifications; email conditional |
| SENTRY_DSN and associated configuration | Verify SDK-specific exposure rules | Use available logging; Sentry conditional |
| App origin, job authentication and other required configuration | Define actual names during implementation | Record name/purpose, never value |

Tool/MCP OAuth is separate from runtime provider credentials. Verify what the running app can use. Keep local secrets ignored and production values in the hosting environment. Create a secret-free `.env.example` during implementation. Never print secret values in progress logs, screenshots, prompts or Git.

## Scheduled work

Choose the simplest existing Supabase/Vercel scheduling capability. Configure authenticated job entry points, bounded batches, idempotent event keys, duplicate suppression and retry limits. Keep cadence configurable by plan urgency. Remind only missing participants, suppress redundant updates, and reduce/stop automatic searches for locked/finalized plans. Record provider budget consumption and job outcomes without sensitive payloads.

## Deployment procedure

1. Identify intended Git repository, Vercel project and Supabase project; preserve unrelated work/data.
2. Verify current framework/provider docs and actual CLI/tool capabilities. Record configured callback URLs and environments without secrets.
3. Run required checks and migrations in a safe test environment first. Establish production migration recovery/forward-fix strategy; do not reset production.
4. Configure available production environment values and auth redirects. Apply reviewed migrations to the intended database and verify access policies.
5. Deploy the tested commit to Vercel. Wait for a ready production deployment and capture its URL and commit.
6. Exercise real organizer auth, guest invitation, the A–I flows, providers, realtime and mobile/desktop using Playwright on that URL.
7. Inspect console/network/server logs; fix critical failures, redeploy and rerun affected checks on the current production version.
8. Clean up only test-run-owned data. Record release evidence and provide the live URL.

Prefer backward-compatible migrations and keep a known-good deployment available. A frontend rollback may not reverse a database migration; record the actual recovery procedure and avoid claiming a rollback was rehearsed if it was not.

## Evidence format

Each phase/release record should contain: date/time; phase and CP IDs; commit or working-tree state; environment/project and deployment URL if relevant; actual commands and exit status; scenario results; log/screenshot/trace/report paths; live versus fixture data; defects and fixes; blockers; next action. Redact guest tokens, personal information and secrets.

Use a unique run identifier for generated test accounts/plans/candidates/jobs. Cleanup must target that identifier, not truncate shared tables or delete all demo records. If cleanup cannot safely run, record the remaining test-owned resources.

## Blocker handling

Develop/test all independent work and safe fallbacks first. If a required runtime credential, provider permission, auth interaction or deployment access still prevents completion, name the exact missing capability, explain what was tried and give the smallest user action. Do not fabricate success or spend time repeatedly retrying a known access failure. Optional credentials alone are not release blockers when the specified fallback works.
