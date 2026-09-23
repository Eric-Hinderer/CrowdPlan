# CrowdPlan — original master specification

Source: user-provided `Pasted text.txt`, supplied September 23, 2026. Original wording is preserved below; only section headings and whitespace have been reformatted. This is the controlling source for product intent.

You are the principal engineer, product designer, systems architect, QA engineer, and release owner for this project. Your assignment is to take the current repository from its present state to a complete, polished, production-deployed application called: CROWDPLAN Do not give me a tutorial, high-level plan, or code snippets for me to implement. BUILD THE APPLICATION. Continue autonomously until: 1. the application is implemented, 2. the database is configured, 3. real external data integrations work, 4. automated tests pass, 5. the production deployment succeeds, 6. you have tested the deployed application with Playwright, 7. critical bugs found during testing are fixed, 8. and you can give me the final production URL. Use your available tools aggressively. You have access to tooling such as: - GitHub - Playwright - Context7 - Supabase - Vercel - frontend-design - TypeScript language tooling - other installed Claude Code plugins/skills Inspect the environment first and use the tools that are actually available. Do not merely write code and assume it works.

## PRODUCT

CrowdPlan solves the annoying coordination problem that normally happens in group chats. The core product idea is: "Tell CrowdPlan what your group has already figured out. CrowdPlan figures out the rest." Examples: "We want to go to Vala's sometime next weekend." "Dinner at Firebirds Friday." "Dinner Friday, Italian, somewhere out west, under $40." "Which of these three restaurants should we choose?" "Find something fun to do Saturday night." "Vegas sometime in October, 3-4 nights, under $800 each." CrowdPlan should NOT primarily be a recommendation engine. Most groups already know some portion of what they want. CrowdPlan's real job is to: - capture what is already decided - capture what is flexible - collect everyone's availability and constraints - identify overlap - evaluate known options - optionally discover additional options - calculate feasibility - identify compromises - help the group reach consensus - maintain one clear source of truth instead of a chaotic group chat

## CORE PLANNING MODEL

Every plan should be modeled using dimensions. Typical dimensions include: - WHAT / activity - PLACE / destination - DATE - TIME - PARTICIPANTS - BUDGET - OPTIONS / candidates - TRANSPORTATION - LODGING - other context-specific dimensions Each dimension can have one of three states: LOCKED CONSTRAINED UNDECIDED Examples: Vala's: Activity: LOCKED = Vala's Pumpkin Patch Date: CONSTRAINED = next weekend Time: UNDECIDED Dinner: Activity: LOCKED = dinner Cuisine: CONSTRAINED = Italian Area: CONSTRAINED = West Omaha Date: LOCKED = Friday Restaurant: UNDECIDED Time: UNDECIDED Budget: CONSTRAINED = $25-$40/person Vegas: Destination: LOCKED = Las Vegas Dates: CONSTRAINED = October Duration: CONSTRAINED = 3-4 nights Flights: UNDECIDED Hotel: UNDECIDED Budget: LOCKED <= $800/person The planning engine's job is: RESOLVE UNDECIDED DIMENSIONS WITHOUT VIOLATING LOCKED OR CONSTRAINED DIMENSIONS. This should be a fundamental architectural concept, not merely UI terminology.

## PLAN CREATION

The first interaction should be extremely simple. Ask: "What are you trying to plan?" Provide examples such as: - Dinner at Firebirds Friday - Vala's sometime next weekend - Something fun Saturday night - Vegas in October under $800 - Dinner Friday, Italian, somewhere out west - Which of these three places should we choose? Allow natural-language input. Parse the organizer's statement into structured plan dimensions. Then show: "Here's what I understood." Allow every extracted value to be edited. Clearly visually distinguish: LOCKED CONSTRAINED UNDECIDED Never silently turn an ambiguous phrase into a hard rule.

## NATURAL LANGUAGE INTERPRETATION

Use an LLM provider for natural-language interpretation if an appropriate runtime API key is available. Prefer Anthropic if ANTHROPIC_API_KEY is available. Design the LLM integration behind a provider abstraction. The LLM must NOT decide the winning candidate. The LLM's role is limited to: - intent extraction - plan-dimension extraction - hard/soft constraint extraction - preference extraction - ambiguity detection - clarification generation Example: User: "I can't leave before 5 Friday because of work, and I need to be home Sunday before 9." Structured result: { "constraints": [ { "type": "earliest_departure", "day": "friday", "time": "17:00", "strength": "hard" }, { "type": "latest_arrival_home", "day": "sunday", "time": "21:00", "strength": "hard" } ] } Then CrowdPlan displays: Here's what I understood: ✓ Cannot depart before 5:00 PM Friday ✓ Must arrive home by 9:00 PM Sunday Confirm / Edit Ambiguity example: "I can't go Sunday." Do NOT guess. Return: needsClarification = true Ask something like: "When you say you can't go Sunday, what do you mean?" - I need to be home before Sunday - I can't travel on Sunday - I'm unavailable for the whole day Sunday - Something else The user must resolve ambiguity before the statement becomes a hard constraint. If no LLM API key is available, implement a deterministic fallback parser for common date/time/budget statements and keep the provider architecture ready for the real LLM integration.

## PARTICIPANTS

The organizer should have an account. Use Supabase Auth. Participants should NOT be required to create accounts. The organizer gets a shareable link such as: crowdplan.app/p/ABCD12 A guest opens the link, enters a display name, and participates. Guest access must be scoped securely to that plan. Use secure invitation tokens and appropriate Supabase Row Level Security. A participant may optionally create an account later and claim/save their profile.

## PARTICIPANT RESPONSE FLOW

Do not force everyone through one giant generic questionnaire. Generate relevant questions based on the plan. For an activity: - When are you available? - Is any time strongly preferred? - Maximum travel distance/time? - Budget? - Anything you absolutely cannot do? - Anything else we should know? For dinner: - availability - budget - dietary restrictions - cuisine preferences - travel-distance preference - other constraints For travel: - origin - possible dates - preferred budget - absolute max budget - destination preferences - flight preferences - lodging preferences - hard schedule constraints Support: HARD constraints SOFT preferences Examples: "I'm allergic to shellfish." HARD "I'd rather not drive downtown." SOFT "I cannot spend more than $50." HARD "I'd prefer to keep it under $35." SOFT "I'd rather do Sunday but Saturday works." SOFT Sunday preference

## AVAILABILITY

Build an excellent calendar/time availability system. Participants should be able to mark dates/times as: IDEAL WORKS NOT AVAILABLE For plans with specific days, support time windows. Example: Eric: Friday after 6 Jake: Friday after 7 Sarah: Friday 5-9 Calculate: GROUP OVERLAP: 7:00 PM - 9:00 PM Make the overlap visualization one of the standout UI elements. Support: - date ranges - day-specific time ranges - hard unavailability - preferred times - participant-by-participant visualization

## THREE MODES OF PLANNING

CrowdPlan must support all three equally well. 1. FIXED OPTION "We're going to Vala's." The place is locked. CrowdPlan solves the remaining dimensions. Do NOT recommend alternatives unless explicitly requested. 2. CRITERIA-BASED "Dinner Friday, Italian, West Omaha, under $40." CrowdPlan first solves group availability and constraints. Then it may search external data within those constraints. 3. DISCOVERY "Find something fun Saturday night." CrowdPlan can generate candidate options based on: - availability - location - budget - preferences - distance - other constraints Discovery must always be optional.

## SHORTLIST MODE

Support groups that already have several candidates. Example: Dinner Friday Options: - Firebirds - Charleston's - Texas Roadhouse CrowdPlan should enrich and compare only those choices. Users should be able to: - paste a place URL - type a place name - add a custom candidate manually - ask CrowdPlan to suggest additional options Do not assume the group wants broader discovery.

## EXTERNAL DATA

Use SerpAPI as the primary external-data provider. API key: SERPAPI_API_KEY Implement a provider layer rather than embedding SerpAPI calls throughout the application. Create provider interfaces so SerpAPI can later be replaced or supplemented. Use SerpAPI for: GOOGLE MAPS / LOCAL RESULTS - restaurants - venues - attractions - local activities - ratings - review count - address - coordinates - categories - hours - price level where available GOOGLE SEARCH - event results - general web information - official pages when useful GOOGLE FLIGHTS - flight searches - origin - destination - dates - price - itinerary - timing - stops - relevant flight metadata GOOGLE HOTELS - lodging discovery - dates - guest counts - pricing - ratings - relevant property information Normalize external results into CrowdPlan's internal candidate types. Do not let UI code depend directly on SerpAPI response shapes.

## DATA TRUST

External information must always retain: - provider - fetchedAt timestamp - source URL where available - raw/provider reference where useful Clearly distinguish: LIVE / RECENT EXTERNAL DATA ESTIMATE USER ENTERED UNKNOWN Never hallucinate missing data. If pricing is unknown: "Price not verified." If hours cannot be verified: "Hours unavailable." Do not fabricate precision.

## API COST CONTROL

External searches are a scarce resource. Design the entire system to avoid unnecessary SerpAPI usage. Implement: - query caching - normalized cache keys - timestamps - duplicate-query prevention - configurable cache TTL - request counters - per-plan external-search budget - search-result reuse - shortlist-only automatic refreshing - protection against combinatorial search explosions NEVER do something naïve like: participants × destinations × weekends × flight options without aggressively narrowing the search space first. Flow should generally be: collect constraints ↓ determine viable time windows ↓ determine viable candidate criteria ↓ narrow shortlist ↓ query external APIs ↓ evaluate results ↓ refresh only serious contenders A locked known place may require only one lookup. Do not repeatedly refresh static venue information.

## CANDIDATE MODEL

Build a universal Candidate model. A restaurant, event, activity, destination, flight package, or custom option should all fit into a normalized abstraction. Candidate examples may contain: - id - type - title - description - location - coordinates - cost range - available times - external data - provider - fetched timestamp - attributes - images where legally/technically appropriate - component candidates A travel candidate may itself contain: - destination - date range - individual flight options - hotel - estimated local expenses - total cost per participant

## CONSTRAINT ENGINE

THIS MUST BE DETERMINISTIC CODE. Do not ask the LLM which candidate works. Hard constraints are predicates. Examples: candidate.endTime <= participant.latestEndTime candidate.cost <= participant.maximumBudget candidate.travelMinutes <= participant.maximumTravelTime candidate.date within participant.availability If any hard constraint fails: candidate is INFEASIBLE for that participant. If the plan requires universal feasibility and any participant has an unresolved hard violation: candidate should be shown as: NOT CURRENTLY FEASIBLE with explicit reasons. Example: Nashville Not currently feasible. Sarah: $42 over maximum budget. Jake: No return itinerary arrives before his 8 PM deadline.

## SOFT SCORING

Only candidates that pass required hard constraints should receive normal ranking scores. Possible score categories: - schedule fit - cost fit - travel convenience - preference match - venue quality - activity match - group voting - lodging quality - transportation quality Do not optimize solely for average satisfaction. Calculate: - average participant satisfaction - lowest participant satisfaction - number of hard compromises - number of soft compromises - ideal-match count - budget fit - convenience distribution Avoid solutions that are excellent for most people but terrible for one person. Fairness should matter.

## EXPLANATIONS

Explanations must come from structured engine output. Do not ask the LLM to invent explanations. Example: Chicago 91% group fit Positives: ✓ Everyone available ✓ Everyone under max budget ✓ 5 of 6 have nonstop flights ✓ 5 of 6 prefer these dates Compromise: ~ Sarah is $22 above her preferred budget Build explanation objects such as: { "positives": [], "compromises": [], "hardViolations": [] } Then render them.

## CONSENSUS

This is one of the core product features. Participants should be able to react to candidates: LOVE IT WORKS FOR ME ACCEPTABLE RATHER NOT CAN'T DO THIS If someone selects: CAN'T DO THIS ask why. Possible reasons: - price - schedule - place - distance - transportation - accessibility - other Determine whether the objection exposes a missing hard constraint. Update the plan accordingly when confirmed. Calculate a group consensus state. Do not present consensus as scientifically exact. It should represent how aligned the group currently is based on structured responses.

## RESOLVE IT / MAKE THIS WORK

Implement a signature feature called: MAKE THIS WORK or: RESOLVE IT If a candidate is close to feasible, analyze the obstacles. Example: Austin currently fails because: Sarah's return arrives 10:34 PM. Sarah's hard requirement: home before 9 PM. CrowdPlan searches nearby alternatives where appropriate. If it finds: Alternative flight: +$47 arrives 7:38 PM show: Austin can work. Change: Sarah takes earlier return flight. Difference: +$47 for Sarah. All hard constraints now satisfied. For simpler plans: Escape room conflicts because Jake arrives at 8:15. Possible resolution: "Would everyone be okay starting at 8:30?" Generate the smallest meaningful follow-up question required to resolve disagreement. Do not repeatedly poll people about information that is already known.

## PLAN RESOLUTION BOARD

Create a visually distinctive central planning interface. It should immediately communicate what is settled and what remains unresolved. Example: WHAT Vala's Pumpkin Patch LOCKED WHEN Sunday 1:30-6:30 PM 6/6 available WHO 6 participants 6 responded BUDGET Not required CONSENSUS Strong alignment Use polished visual states for: LOCKED CONSTRAINED UNDECIDED RESOLVED BLOCKED Do not make the application look like a generic SaaS admin dashboard.

## REALTIME

Use Supabase Realtime. If Participant A votes while the organizer is watching: the organizer's screen should update immediately. Examples: 4/6 responded → 5/6 responded or: Consensus changes. or: Candidate rankings change. Do not require refreshes.

## DATABASE

Use Supabase PostgreSQL. Design a clean normalized schema. Likely entities include: users profiles plans plan_members plan_invites plan_dimensions constraints preferences availability_windows candidate_sets candidates candidate_components external_snapshots votes reactions clarification_questions notifications plan_events saved_friend_preferences You may improve the schema. Use migrations. Use Row Level Security. Organizer: full plan-management rights. Participant: only appropriate access to invited plan. Anonymous visitor: no access without valid invitation.

## AUTH

Use Supabase Auth. Support a simple organizer login. Prefer: - Google OAuth if configured - email magic link or OTP Do not block the entire build if Google OAuth credentials are unavailable. Email-based auth is sufficient. Guest participation must not require an account.

## MAPS

Use MapLibre if practical to avoid unnecessary recurring map costs. Use maps when location genuinely helps: - restaurant candidates - activity candidates - destination context - participant-origin visualization where appropriate Do not make maps decorative.

## NOTIFICATIONS

Implement in-app notifications. If RESEND_API_KEY is available, also implement email notifications. Useful email notifications include: - invitation - reminder - everyone responded - candidate changed significantly - consensus reached - plan finalized Do not send excessive notifications.

## AUTOMATION

Implement background/scheduled workflows. Use Supabase scheduled functionality, Vercel cron, or another simple solution already available. Avoid introducing complex orchestration infrastructure unless genuinely necessary. Useful jobs: refresh_candidate_data recalculate_plan send_participant_reminder check_plan_deadline check_consensus send_plan_update Automation frequency should depend on plan type. Tonight's dinner: short cadence. Trip three months away: longer cadence. Locked/finalized plans: minimal or no refreshing.

## PLAN DEADLINES

Organizer can optionally set: "Decide by Thursday 8 PM." CrowdPlan should: - track response state - remind only missing participants - avoid group spam - notify organizer when everyone has responded - surface unresolved blockers near deadline

## FINALIZATION

Once the group chooses: FINALIZE PLAN The planning UI should transition into a clean final-plan view. For dinner/activity: - place - date - time - map - participants - notes - relevant external details For travel: - destination - dates - flights per traveler - hotel - estimated cost per person - important links - itinerary information DO NOT purchase tickets, reserve restaurants, book hotels, or charge cards in V1. External booking links are acceptable.

## VISUAL DESIGN

CrowdPlan should feel like a premium consumer product. It should not look like: - an enterprise admin panel - a generic AI SaaS dashboard - a template with cards everywhere Design characteristics: - confident typography - strong hierarchy - excellent spacing - polished mobile experience - fluid animations - excellent dark/light modes if practical - subtle surfaces - clear interaction states - thoughtful empty states - tactile voting - expressive participant avatars - excellent responsive layouts The product will commonly be opened from a group-chat link on a phone. MOBILE EXPERIENCE IS CRITICAL. Build mobile-first where appropriate. Desktop should become a powerful planning workspace. Use: - Tailwind CSS - shadcn/ui where useful - Framer Motion / Motion for meaningful transitions - a chart library only when needed Create custom components for CrowdPlan's distinctive interactions.

## SIGNATURE VISUALIZATIONS

Build excellent versions of: - group availability heatmap - overlapping-time visualization - participant constraint matrix - candidate comparison - consensus visualization - plan resolution board Do not overuse charts. Every visualization should answer a real planning question.

## PWA

Make CrowdPlan installable as a Progressive Web App if practical. It should behave well when launched from a phone home screen.

## SAVED FRIEND PREFERENCES

If a guest later creates an account, optionally allow them to save stable preferences. Examples: home area usual dinner budget favorite cuisines dietary restrictions activity preferences travel preferences Do not automatically apply sensitive or uncertain information without confirmation. When joining future plans, CrowdPlan can prefill stable preferences but should allow editing.

## STACK

Prefer: Next.js TypeScript App Router Supabase: - PostgreSQL - Auth - Realtime - Row Level Security SerpAPI Anthropic runtime API where credentials exist Tailwind CSS shadcn/ui Framer Motion or Motion MapLibre Zod Vitest Playwright Vercel Sentry if readily available Use Context7 whenever current library/framework documentation is needed. Do not rely on stale assumptions about library APIs.

## SECRETS

NEVER hardcode secrets. Use environment variables. Potential variables include: NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SERPAPI_API_KEY ANTHROPIC_API_KEY RESEND_API_KEY SENTRY_DSN and others if required. Inspect the environment before asking me for credentials. If a credential is missing: 1. determine whether the feature can be developed/tested with a safe demo or provider fallback, 2. complete everything else possible, 3. ask me only when the missing credential is a genuine blocker.

## DEMO DATA

Include a polished demo mode or seed data. Provide several plans demonstrating the product: 1. Fixed place: "Vala's next weekend" 2. Shortlist: "Which of these three restaurants Friday?" 3. Discovery: "Find something fun Saturday night" 4. Travel: "Vegas sometime in October under $800" Demo data must be clearly labeled. Do not mix fake/demo pricing with live external data without obvious labels.

## TESTING

Write automated tests for important domain logic. At minimum: - dimension state handling - availability overlap - hard constraints - soft preferences - candidate feasibility - scoring - fairness - budget evaluation - parsing schema validation - candidate normalization - API caching - request budgeting - consensus calculations - plan finalization permissions Use Vitest or an appropriate TypeScript testing framework.

## PLAYWRIGHT

Use Playwright to test the actual app. Do not only test the landing page. Create realistic multi-user scenarios. Scenario A: Organizer creates: "Vala's next weekend." Invite 4 participants. Give them different availability. Verify the app determines the strongest overlap. Scenario B: Organizer creates: "Dinner Friday, Italian, West Omaha, under $40." Give participants different budgets and food preferences. Use real SerpAPI data if credentials are available. Verify candidate filtering and ranking. Scenario C: Organizer supplies 3 known restaurant choices. Verify CrowdPlan does not unnecessarily perform broad discovery. Scenario D: Create an ambiguous participant response: "I can't go Sunday." Verify CrowdPlan asks for clarification rather than silently interpreting it. Scenario E: Participant votes. Verify organizer UI updates through realtime. Scenario F: Create a candidate that violates one participant's hard constraint. Verify it is marked infeasible with a specific explanation. Scenario G: Exercise MAKE THIS WORK. Verify CrowdPlan identifies the blocker and proposes an alternative when one exists. Scenario H: Travel plan with SerpAPI flight/hotel integration. Verify costs are labeled correctly and external-data timestamps are visible. Scenario I: Finalize a plan. Verify all guests see the finalized result.

## PRODUCTION SAFETY

Ensure: - secrets never reach the client - RLS policies are correct - guest tokens cannot access unrelated plans - server-side API routes protect provider keys - external URLs are handled safely - external HTML is never trusted - rate limiting exists where appropriate - LLM structured output is schema validated - SerpAPI responses are validated/normalized - user-supplied URLs cannot create obvious SSRF vulnerabilities Use the installed security guidance tooling if available.

## PERFORMANCE

The app should feel fast. Avoid unnecessary API calls. Cache expensive data. Use optimistic UI where appropriate. Avoid rendering massive unnecessary component trees. Do not block initial page load on external candidate searches. Provide meaningful loading/progress states.

## GITHUB

Use Git normally. Create coherent commits. If authenticated GitHub tooling is available: - create or use the repository - push changes - maintain a clean main branch Do not commit secrets.

## DEPLOYMENT

Deploy to Vercel using the available Vercel tooling. Configure Supabase. Apply migrations. Configure production environment variables that are available. After deployment: open the production application with Playwright. Test: - organizer signup/login - plan creation - guest invite flow - availability - constraints - known-place plan - criteria-based plan - shortlist plan - discovery - voting - realtime - finalization - external integrations - mobile viewport - desktop viewport Inspect browser-console errors. Inspect server/deployment logs. Fix issues. Redeploy. Repeat until healthy.

## AUTONOMY

You have authority to make normal: - architecture decisions - component decisions - package decisions - UX decisions - database decisions - styling decisions - implementation decisions - testing decisions - deployment decisions without asking me. Do not ask me: "Which library should I use?" "Should I use server actions?" "Which schema do you prefer?" "What color palette do you want?" "What folder structure should I use?" Make good decisions and continue. Ask me only for genuinely irreducible external requirements such as a missing API credential that is required to complete the real integration. Before asking me, exhaust reasonable alternatives.

## SCOPE MANAGEMENT

A polished, coherent V1 is more important than an enormous unfinished product. Do not add unrelated features. Do not build: - payment processing - automatic booking - restaurant reservations - ticket purchasing - social feeds - public profiles - chat - native iOS/Android apps - complex enterprise administration unless they are genuinely necessary to the core experience. DO NOT cut: - locked/constrained/undecided dimensions - natural-language plan creation - ambiguity handling - guest participation - availability overlap - hard constraints - soft preferences - known-place planning - criteria-based planning - shortlist planning - optional discovery - SerpAPI integration - candidate normalization - deterministic constraint engine - ranking/fairness - consensus - realtime updates - Make This Work / Resolve It - finalization - responsive mobile UX - production deployment These are core CrowdPlan.

## DEFINITION OF DONE

The project is NOT complete because: - code exists - the build succeeds - the database schema exists - the landing page looks good - one API call works - deployment started The task is complete when: - CrowdPlan is implemented - organizer auth works - guests can participate without accounts - natural-language plan creation works - ambiguous input is clarified - known places can be locked - criteria can be constrained - shortlists work - optional discovery works - SerpAPI integration works - availability intersection works - hard constraints work - soft preferences work - infeasible candidates are explained - scoring and fairness work - voting works - realtime updates work - Make This Work works - plans can be finalized - production deployment succeeds - the deployed application has been tested with Playwright - major mobile workflows work - automated tests pass - no critical console/runtime errors remain - and you can provide me the live production URL Keep working until that is true.
