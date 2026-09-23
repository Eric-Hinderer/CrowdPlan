# Phase 02 — Implement the pure planning domain and interpretation contracts

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-02, CP-04, CP-08, CP-13, CP-14, CP-15, CP-16, CP-31.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Implement typed dimensions, confirmed constraints/preferences, availability, normalized candidates, feasibility, ranking metrics and structured explanations. Keep this layer deterministic and network-free. Add validated LLM extraction contracts, Anthropic adapter when configured, and a useful deterministic no-key parser. Preserve ambiguity until confirmation. Define temporal semantics, unknown-data behavior, per-person budget rules, fairness weights and deterministic tie breaks. Write meaningful unit tests, including the master prompt's overlap and hard/soft examples.

## Exit criteria

- [ ] Locked/constrained dimensions cannot be violated by automatic resolution.
- [ ] Overlap fixture yields Friday 19:00–21:00; exclusions and no-overlap cases pass.
- [ ] Hard failures and unknown checks stay out of normal feasible rankings.
- [ ] Fairness tests demonstrate that averages cannot hide a poor individual outcome.
- [ ] Parser handles common date/time/budget examples without a key; ambiguous Sunday requests clarification.
- [ ] Structured explanations match engine facts; domain and schema-validation tests pass.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
