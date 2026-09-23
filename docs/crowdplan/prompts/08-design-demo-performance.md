# Phase 08 — Polish the consumer experience, signature views and demos

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-19, CP-22, CP-26, CP-27, CP-30, CP-34.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Refine mobile-first creation, invitations, responses, voting, comparison, repairs and finalization. Deliver the six signature visualizations with clear planning questions, accessible non-color cues and meaningful motion. Avoid generic admin panels. Add polished labeled demos for Vala’s, the three-restaurant shortlist, Saturday discovery and Vegas October. Verify empty/loading/error/offline-or-reconnect states as appropriate. Evaluate MapLibre, PWA, light/dark themes and readily available Sentry, retaining their original conditional status. Measure meaningful performance and eliminate concrete bottlenecks.

## Exit criteria

- [ ] All six signature views are implemented with real state and reviewed at mobile/desktop widths.
- [ ] Core flows work at 390px and 1440px without overflow or blocked controls.
- [ ] Four demo plans are polished and clearly separated/labeled from live data.
- [ ] Keyboard focus, labels, errors, non-color indicators and reduced motion checked.
- [ ] Conditional feature decisions recorded, with implemented behavior verified.
- [ ] Initial navigation is independent of discovery; actual performance and API usage observations recorded.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
