# Phase 05 — Connect fair ranking, reactions, explanations and realtime

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-14, CP-15, CP-16, CP-17, CP-19, CP-20.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Build candidate comparison, constraint matrix and consensus UI on structured domain evaluations. Expose positive matches, soft compromises and hard violations by participant. Implement all five reactions and reason capture for CAN'T DO THIS; confirm new hard constraints before applying them. Connect mutations to persisted, version-aware recalculation and Supabase Realtime. Handle reconnects, duplicate events, optimistic rollback and stale results. Show response completeness separately from consensus and model fit.

## Exit criteria

- [ ] Scenario F shows the participant-specific violation and keeps infeasible candidates out of normal ranking.
- [ ] All five reactions persist; confirmed objections update constraints and recalculate results.
- [ ] Fairness metrics and structured explanations agree with tested domain output.
- [ ] Scenario E updates organizer UI from a separate guest context without refresh.
- [ ] Realtime subscriptions and mutations cannot expose another plan; reconnection converges to correct state.
- [ ] Resolution board and consensus distinguish unanswered, blocked, feasible and aligned states.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
