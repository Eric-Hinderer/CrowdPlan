# Resume CrowdPlan after a context reset

Read `CLAUDE.md`, `docs/crowdplan/MASTER-SPEC.md`, `PRODUCT-SPEC.md`, `PROGRESS.md`, `REQUIREMENTS.md` and `DECISIONS.md`. Inspect current Git status, recent commits and actual deployment state. Do not trust a stale summary over repository evidence, and do not overwrite uncommitted work.

Identify the first incomplete or invalidated phase. Verify the recorded evidence still applies to the current code/deployment, then execute that phase's prompt and continue under RUN-ALL.md. Reuse completed work instead of rebuilding it. Rerun tests when changes invalidate their evidence, not merely because a new session began.

Keep unresolved credentials and production gates explicit. Never report mock/demo success as live-provider success. Preserve the full product scope and existing user authorization. Continue through verified production or the smallest genuinely irreducible external blocker, updating durable records as you go.
