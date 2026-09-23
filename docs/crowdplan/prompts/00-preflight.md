# Phase 00 — Inspect the repository and establish the delivery baseline

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-01, CP-29, CP-35, CP-36.

Entry: None; begin with repository inspection.

## Work

Inspect repository instructions, Git status/remotes, existing app, migrations, tests, package manager and deploy configuration. Preserve existing work. Discover available GitHub, Supabase, Vercel, Playwright, Context7, design and TypeScript tools. Check runtime credential availability without revealing values. Compare existing features with every CP requirement. Read the full original specification. Choose the smallest coherent implementation path and current supported versions; do not spend this phase redesigning the product. Create/update a secret-free environment template and executable verification scripts when the repository permits.

## Exit criteria

- [ ] Repository inventory and capability/credential matrix recorded without secrets.
- [ ] Every CP requirement has an owner phase and existing/missing assessment.
- [ ] Actual build/test commands and baseline results recorded; existing failures distinguished.
- [ ] Normal technical choices documented; no core feature silently deferred.
- [ ] Independent work is identified for any missing external credential, and phase 01 can proceed.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
