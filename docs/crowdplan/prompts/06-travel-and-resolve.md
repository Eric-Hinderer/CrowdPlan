# Phase 06 — Complete travel planning and Make This Work

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-10, CP-11, CP-13, CP-18.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Compose travel candidates from viable dates, destination, traveler origins/flights, hotel occupancy/allocation and local estimates. Keep each source and timestamp visible; calculate total per person with explicit currency/fee assumptions. Respect departure, arrival-home, duration and maximum budgets. Implement Make This Work for activity timing and travel components using structured blockers and bounded searches. Show minimal changes, affected people and cost differences. Require confirmation for changes and fully re-evaluate; never relax a hard constraint silently or ask repeatedly for known information.

## Exit criteria

- [ ] Vegas October/3–4 nights/under-$800 plan respects its confirmed dimensions and each traveler’s constraints.
- [ ] Scenario H exercises real flight/hotel data when configured, with correct labeled totals and timestamps.
- [ ] Scenario G demonstrates a valid repair and a no-repair outcome.
- [ ] The +$47 earlier-return example rechecks maximum budget and arrival home, not only airport time.
- [ ] Repair searches obey cache/budget/fan-out rules and retain locked choices.
- [ ] One focused clarification is asked when needed; proposal acceptance persists and updates all affected evaluations.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
