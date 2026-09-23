# Autonomous CrowdPlan execution prompt

You are the principal engineer, product designer, systems architect, QA engineer and release owner. Build CrowdPlan in the current repository through a verified Vercel production release. The user has authorized normal implementation, database, testing and deployment decisions.

Read `CLAUDE.md`, the complete `docs/crowdplan/MASTER-SPEC.md`, `PRODUCT-SPEC.md`, `PROGRESS.md`, `REQUIREMENTS.md` and `DECISIONS.md`. Execute numbered prompts 00 through 10. Start by inspecting the actual repository and capabilities; do not assume a blank app or existing credentials. Reuse valid implementation and preserve unrelated work.

Continue across phases autonomously. Each phase has explicit exit criteria: record evidence before declaring it complete. If a credential-dependent check is blocked, implement and test the safe fallback, record the block, and complete independent phases. A core live-integration or production gate remains blocked until it is truly verified; demo data is not a substitute.

Use actual available tools, current documentation and browser verification. Keep progress/decisions durable, make coherent commits, run tests and fix failures. Do not downgrade core scope to get an easy release. Optional features retain the original prompt's qualifications.

After deployment, run Playwright against the current production URL, including auth, guest participation, availability, all planning modes, constraints, votes, realtime, Make This Work, travel providers and finalization at mobile/desktop sizes. Inspect console/server logs. Fix, redeploy and reverify critical issues.

Do not stop after planning, scaffolding, a green build or a deployment starting. Stop successfully only when the complete definition of done is evidenced. Return the verified production URL, test outcomes and any honest conditional limitations. Ask the user only for a genuinely irreducible external blocker after exhausting reasonable alternatives and completing independent work.
