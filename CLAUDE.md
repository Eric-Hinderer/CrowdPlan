# CrowdPlan — repository execution instructions

You own engineering, product design, architecture, QA, and release. Build the application, configure its database and real integrations, test it, deploy it, and verify the deployed product. Do not substitute a tutorial, snippets, scaffolding, or an unverified completion claim.

## Read before working

1. `docs/crowdplan/MASTER-SPEC.md` — controlling original specification.
2. `docs/crowdplan/PRODUCT-SPEC.md` — organized product contract.
3. `docs/crowdplan/PROGRESS.md` and `docs/crowdplan/DECISIONS.md` — current state.
4. The active phase prompt, `ARCHITECTURE.md`, `ACCEPTANCE.md`, and `OPERATIONS.md`.

Resolve inconsistencies in favor of explicit user instructions and the original master specification. Preserve existing repository instructions and unrelated work. Inspect the repository before selecting packages or rewriting anything.

## Non-negotiable behavior

- Model LOCKED / CONSTRAINED / UNDECIDED as domain states. Resolve unknown dimensions within existing limits.
- Keep extraction separate from decisions: LLMs may interpret input, never choose winners, invent explanations, or override hard constraints.
- Handle ambiguous input explicitly before activating a hard constraint.
- Support fixed place, criteria, shortlist, and optional discovery. A fixed place does not trigger unsolicited alternatives; a shortlist does not trigger broad discovery.
- Separate hard feasibility from soft ranking and include fairness. Unknown facts are not verified facts.
- Authenticate organizers; guests join a specific plan without account signup. Enforce authorization in data access and realtime, not just the UI.
- Keep provider calls and privileged keys on the server. Normalize, validate, cache, deduplicate, and budget external searches.
- Keep demo records visibly separate from live records. Tests with mocks do not establish live integration health.
- Implement consensus, realtime, Make This Work, finalization, and mobile workflows as real features.
- Never book, purchase, reserve, charge cards, or add unrelated V1 features.

## Autonomy and tools

Make normal architecture, package, component, UX, schema, testing, and deployment decisions. Use available authenticated tools; discover actual capabilities first. Prefer the requested stack. Consult Context7 when available and current official documentation when needed. Tool authentication does not automatically supply application runtime API credentials.

Inspect configured environment-variable names and usable integrations without printing secrets. Build safe fallbacks and complete independent work before asking for a genuinely missing credential or other irreducible external requirement. Keep blocked gates explicitly blocked. Do not ask routine design questions or request repeated deployment approval already granted by the master prompt. Do not circumvent actual access controls or tool approval requirements.

## Execution and evidence

Use numbered prompts in order, reusing existing implementation where appropriate. `RUN-ALL.md` authorizes continuation across phases without an approval pause. A phase is complete only when its exit criteria are proved. Record commands, outcomes, requirement IDs, commit, environment, and artifacts in the progress ledger. Never mark unrun tests passed or skip required tests to get a green build.

Use coherent Git commits; push through authenticated GitHub tooling when available. Keep secrets and personal test data out of Git. Avoid unrelated rewrites, forced pushes, destructive resets, and production-data deletion. Use isolated test records and clean up only records belonging to the test run.

If context is running low, update PROGRESS.md with the exact next action and use the resume prompt. At completion, return the verified live production URL, tested flows, test results, and material remaining limitations. If any core release gate is blocked, say the application is not yet complete.

## Framework notes

@AGENTS.md
