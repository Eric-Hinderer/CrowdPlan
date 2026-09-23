# Phase 04 — Integrate SerpAPI, candidate normalization, provenance and cost controls

Copy this file’s contents into Claude Code, or instruct it to read and execute this file.

## Execution prompt

You are implementing CrowdPlan in this repository. Read `CLAUDE.md`, `docs/crowdplan/PRODUCT-SPEC.md`, the corresponding original sections in `MASTER-SPEC.md`, and `PROGRESS.md`. Use `ARCHITECTURE.md`, `ACCEPTANCE.md` and `OPERATIONS.md` as implementation/evidence guidance. Inspect actual code and current tooling before changing anything. Build and verify the work; do not return a tutorial or plan instead.

Requirements: CP-09, CP-10, CP-11, CP-12, CP-13, CP-22, CP-33, CP-34.

Entry: Prior phases completed or their external blockers explicitly recorded; finish all independent work without claiming blocked prerequisites passed.

## Work

Implement server-side provider interfaces and SerpAPI adapters for local/maps, web search, flights and hotels using current provider documentation. Normalize all four response families. Build query cache, canonical keys, TTL/freshness display, concurrent deduplication, counters and atomic per-plan budgets. Gate outbound searches on narrowed windows/criteria; refresh only contenders. Deliver local criteria and shortlist enrichment UI with safe URLs and useful map context if practical. Handle errors, unknown prices/hours and labeled fixtures honestly. Travel orchestration is completed in phase 06; flight/hotel adapter contracts belong here.

## Exit criteria

- [ ] All four adapters normalize validated fixtures and preserve source/provider/fetchedAt.
- [ ] With credentials, live smoke requests for each adapter succeed; absent credentials are explicitly blocked evidence.
- [ ] Criteria filtering works; fixed place uses bounded lookup and shortlist causes no broad discovery (B/C).
- [ ] Concurrent duplicates, cache expiry, budget exhaustion and bounded retries/fan-out are tested.
- [ ] Provider secrets remain server-side; authorization, input/URL validation and rate limiting tested.
- [ ] UI distinguishes live/recent, estimated, user-entered, unknown and demo data; initial render does not wait for discovery.

## Required handoff

Update `docs/crowdplan/PROGRESS.md`, `REQUIREMENTS.md` and relevant `DECISIONS.md` entries with actual code changes, commands/results, evidence, commit, known issues and the exact next action. Commit coherently when appropriate. Do not mark this phase complete while any exit criterion lacks evidence. If an external requirement is genuinely missing, complete independent work and record the specific blocker. Under RUN-ALL.md continue automatically to the next executable phase; do not ask for routine approval.
