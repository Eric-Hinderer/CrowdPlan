# Phase 07 — Implement deadlines, notifications, scheduled jobs and final plans

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-23, CP-24, CP-25, CP-28.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Implement in-app notifications, optional Resend email, decision deadlines and simple scheduled workflows. Refresh/recalculate/remind/check consensus with urgency-aware cadence, idempotency and budget controls. Remind only missing participants. Implement organizer finalization with a consistent result for every invited guest, including travel components and external links. Implement or explicitly decide the optional saved-profile flow, proving guest claim ownership and editable/confirmed sensitive preferences. Keep all V1 actions free of booking or payments.

## Exit criteria

- [ ] Deadline state, missing-participant reminders, everyone-responded and finalization notifications work without duplicates.
- [ ] Scheduled retries are safe; locked/finalized plans minimize or stop automatic searches.
- [ ] Scenario I passes: organizer finalizes, guests cannot finalize and all see the same result.
- [ ] Final activity/travel views show the required facts, sources, estimates and links.
- [ ] In-app notifications work; Resend is tested if configured, otherwise recorded as conditional.
- [ ] Optional profile/preference decision is recorded; any implemented claim/prefill behavior is permission-tested.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
