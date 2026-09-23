# Phase 09 — Run complete automated, multi-user and security verification

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-31, CP-32, CP-33, CP-34.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Execute ACCEPTANCE.md against the actual integrated application using independent organizer/guest browser contexts. Run all A–I scenarios, direct authorization tests, domain/provider/cache tests and repository quality/build checks. Exercise failure states and hard constraint edge cases. Inspect console/network/server logs, fix critical bugs, and add targeted regression coverage. Prove real-provider behavior independently of fixtures. Use tagged test data and clean up only test-owned records. Update every requirement with evidence or a concrete blocker.

## Exit criteria

- [ ] Required automated tests, type checks, lint and production build pass.
- [ ] A–I pass in the integrated test environment with trace/screenshots/results recorded.
- [ ] Real provider smoke evidence exists for all adapters, or the release blocker is explicit.
- [ ] Cross-plan RLS/realtime, privileged-key exposure, SSRF/unsafe URLs, schemas and rate-limit checks pass.
- [ ] No unresolved critical app/security defects; fixes are regression-tested.
- [ ] Requirements ledger is fully assessed; remaining work is production release/verification or a named external blocker.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
