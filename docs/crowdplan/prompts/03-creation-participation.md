# Phase 03 — Deliver natural-language creation, contextual guest responses and availability

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-03, CP-04, CP-06, CP-07, CP-08, CP-09, CP-19.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Implement the simple creation prompt and editable “Here's what I understood” confirmation. Persist all dimension states. Build fixed-place, criteria, shortlist and opt-in discovery setup, including URL/name/custom candidates. Create contextual activity/dinner/travel guest flows with hard/soft editing and ambiguity resolution. Build calendar/time-window entry, individual availability and group overlap, and the first real resolution board. Connect UI to persisted domain results. Do not show missing responses as availability.

## Exit criteria

- [ ] Organizer creates and reopens plans in each planning mode with correct dimension states.
- [ ] Guests submit/edit relevant answers and availability without account signup.
- [ ] Extraction values are editable; ambiguous Sunday has no active hard rule until clarified.
- [ ] Four-guest Vala’s scenario A works with correct overlap and fixed venue.
- [ ] Shortlist inputs work and discovery never starts without the appropriate explicit mode/request.
- [ ] Mobile creation/response flow and persisted reload behavior verified in the browser.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
