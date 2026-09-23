# Phase 10 — Deploy to Vercel and verify the actual production application

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-32, CP-35, CP-36.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Use available authenticated GitHub/Vercel/Supabase tools to release coherent commits, configure available production variables/auth redirects, apply reviewed migrations, and deploy the tested app to Vercel. Confirm the deployment is ready. Run production Playwright A–I and the production checklist in ACCEPTANCE.md, including actual organizer signup/login, guests, providers, realtime and mobile/desktop. Inspect browser and server/deployment logs. Fix, redeploy and rerun affected checks until healthy. Record the verified commit/URL and cleanup. Do not stop at a successful deployment command.

## Exit criteria

- [ ] Production deployment is ready and corresponds to the recorded tested commit.
- [ ] Production migrations, auth and available runtime configuration are verified.
- [ ] All core workflows and A–I pass on the current production URL, with live integration evidence.
- [ ] Major mobile/desktop flows pass; no critical console/runtime/security failures remain.
- [ ] Automated checks remain green after production fixes; requirement ledger has no unverified core row.
- [ ] Release evidence, conditional limitations and cleanup are recorded; final answer provides the verified live production URL.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
