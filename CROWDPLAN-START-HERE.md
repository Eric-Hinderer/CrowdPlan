# CrowdPlan repository pack

This package specifies the application; it does not claim the application has been built, tested, or deployed.

## Install

Extract the ZIP into a temporary directory, then copy its contents into your repository root. The archive has no enclosing directory. It contains only Markdown. Keep your existing application README. If `CLAUDE.md` already exists, merge the CrowdPlan instructions into it instead of overwriting unrelated repository guidance.

## Start Claude Code

Open Claude Code in the repository and send:

```text
Read CLAUDE.md and docs/crowdplan/prompts/RUN-ALL.md. Execute the CrowdPlan build through production verification. Start by inspecting the actual repository and available tools. Follow every phase's exit criteria, preserve existing work, and keep docs/crowdplan/PROGRESS.md current. Do not stop after planning or scaffolding. Ask only for a genuinely irreducible blocker after completing independent work.
```

For one phase at a time, send:

```text
Read CLAUDE.md, docs/crowdplan/PROGRESS.md, and the next incomplete numbered prompt under docs/crowdplan/prompts/. Execute that phase, prove its exit criteria, and update the progress and requirement records.
```

After a context reset, use [RESUME.md](docs/crowdplan/prompts/RESUME.md).

## Documents

| File | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Repository instructions and autonomous execution contract |
| [MASTER-SPEC.md](docs/crowdplan/MASTER-SPEC.md) | Complete original prompt, retained as the controlling source |
| [PRODUCT-SPEC.md](docs/crowdplan/PRODUCT-SPEC.md) | Authoritative structured requirements, IDs, and V1 boundaries |
| [ARCHITECTURE.md](docs/crowdplan/ARCHITECTURE.md) | Proposed implementation boundaries and domain invariants |
| [ACCEPTANCE.md](docs/crowdplan/ACCEPTANCE.md) | Automated, multi-user, security, and release checks |
| [OPERATIONS.md](docs/crowdplan/OPERATIONS.md) | Credentials, jobs, deployment, evidence, and recovery |
| [REQUIREMENTS.md](docs/crowdplan/REQUIREMENTS.md) | Requirement-to-phase and evidence ledger |
| [PROGRESS.md](docs/crowdplan/PROGRESS.md) | Durable phase status and handoff |
| [DECISIONS.md](docs/crowdplan/DECISIONS.md) | Implementation choices and conditional-feature decisions |
| [RUN-ALL.md](docs/crowdplan/prompts/RUN-ALL.md) | Full autonomous orchestration prompt |

## Source and authority

The attached master prompt is fully available and preserved in MASTER-SPEC.md. PRODUCT-SPEC.md organizes that source; the original wins if a discrepancy is found. Architecture, phase sequencing, evidence formats, and additional edge-case checks are implementation guidance, not claims that the user dictated those exact designs. Record ordinary technical decisions without asking for permission. Do not silently change product scope.

Core features cannot be replaced by a landing page or demo. Conditional features retain their original qualifiers: an LLM has a deterministic fallback; Google OAuth and email notifications depend on configuration; MapLibre, PWA, dark/light modes, Sentry, and saved preferences retain their practical/optional status. Real SerpAPI integration and production verification remain release requirements.
