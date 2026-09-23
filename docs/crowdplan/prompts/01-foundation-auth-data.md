# Phase 01 — Build the application foundation, Supabase schema and secure participation

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-05, CP-06, CP-21, CP-29, CP-33.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Build or adapt the preferred Next.js/TypeScript foundation and normalized Supabase migrations. Implement organizer email auth and configured Google OAuth if available. Build secure invitation creation/redemption and a guest session tied to one plan, without a signup requirement. Add appropriate constraints/indexes and RLS for all exposed data. Establish tested server-side authorization and realtime access design. Implement session restoration and intended auth redirects. Verify current Supabase docs before coding. Protect privileged credentials and avoid using service-role queries as a substitute for authorization.

## Exit criteria

- [ ] App boots; migrations apply reproducibly in the test environment.
- [ ] Organizer can sign in/out using the configured real auth path.
- [ ] Guest enters a display name through a valid invitation and resumes access to that plan without signup.
- [ ] Direct data tests deny outsider/cross-plan access and guest organizer-only mutations.
- [ ] Invite expiry/revocation policy and authorization for realtime are documented/tested.
- [ ] No privileged keys in client output; schema/auth evidence recorded.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
