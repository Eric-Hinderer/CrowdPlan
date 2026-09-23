import "server-only";

import { evaluatePlan } from "@/domain/evaluate";
import { allowedDates } from "@/domain/dimensions";
import { toPlanInput, type PlanBundle } from "@/lib/plan-data";
import { serverDb } from "./db";
import { notify } from "./notify";
import { loadPlanForServer } from "./plan-loader";
import { enrichCandidatesInBackground, runTravelSearch, searchAvailable } from "./search";

/**
 * Scheduled work (every ~10 minutes via pg_cron → pg_net → /api/jobs/run).
 * Every job is idempotent: notifications carry dedupe keys and refreshes are
 * claimed per plan and cadence bucket in private.job_runs.
 */

const HOUR = 3600_000;
const MAX_PLANS_PER_RUN = 40;

export interface JobReport {
  plans: number;
  reminders: number;
  deadlineNotices: number;
  consensusNotices: number;
  refreshed: number;
  skipped: number;
  errors: string[];
}

async function claim(job: string, planId: string, bucket: string): Promise<boolean> {
  const sql = serverDb();
  const rows = await sql`
    insert into private.job_runs (job, plan_id, dedupe_key, status)
    values (${job}, ${planId}, ${`${job}:${planId}:${bucket}`}, 'started')
    on conflict (dedupe_key) do nothing
    returning id`;
  return rows.length === 1;
}

async function finish(job: string, planId: string, bucket: string, status: "done" | "failed" | "skipped", detail: Record<string, unknown> = {}) {
  const sql = serverDb();
  await sql`update private.job_runs set status = ${status}, detail = ${sql.json(detail as never)}, finished_at = now() where dedupe_key = ${`${job}:${planId}:${bucket}`}`;
}

/** How soon the plan happens drives how often anything is refreshed. */
export function refreshCadenceHours(bundle: Pick<PlanBundle, "plan"> & { firstDate: string | null }, now: number): number | null {
  if (bundle.plan.status !== "collecting") return null; // finalized/archived: no automatic searches
  if (!bundle.firstDate) return 72;
  const until = Date.parse(`${bundle.firstDate}T12:00:00Z`) - now;
  if (until < 0) return null;
  if (until < 2 * 24 * HOUR) return bundle.plan.kind === "travel" ? 3 : 12;
  if (until < 14 * 24 * HOUR) return bundle.plan.kind === "travel" ? 12 : 48;
  return bundle.plan.kind === "travel" ? 48 : 168;
}

export async function runScheduledJobs(now = Date.now()): Promise<JobReport> {
  const sql = serverDb();
  const report: JobReport = { plans: 0, reminders: 0, deadlineNotices: 0, consensusNotices: 0, refreshed: 0, skipped: 0, errors: [] };
  const plans = await sql`
    select id from public.plans
    where status = 'collecting' and is_demo = false and updated_at > now() - interval '120 days'
    order by coalesce(decide_by, updated_at) asc
    limit ${MAX_PLANS_PER_RUN}`;
  for (const { id } of plans) {
    try {
      const bundle = await loadPlanForServer(id);
      if (!bundle) continue;
      report.plans++;
      const input = toPlanInput(bundle, now);
      const evaluation = evaluatePlan(input);
      const responded = new Set([...bundle.availability.map((w) => w.memberId), ...bundle.members.filter((m) => m.responded_at).map((m) => m.id)]);
      const missing = bundle.members.filter((m) => !responded.has(m.id));
      const organizer = bundle.members.find((m) => m.role === "organizer");

      // --- check_plan_deadline + send_participant_reminder -------------------------
      if (bundle.plan.decide_by) {
        const due = Date.parse(bundle.plan.decide_by);
        const left = due - now;
        const stage = left <= 0 ? "passed" : left <= 3 * HOUR ? "3h" : left <= 24 * HOUR ? "24h" : null;
        if (stage && stage !== "passed" && missing.length) {
          // Remind only the people who haven't answered — never the whole group.
          report.reminders += await notify({
            planId: id,
            userIds: missing.map((m) => m.user_id),
            kind: "reminder",
            title: `Quick answer needed: ${bundle.plan.title}`,
            body: `The group decides ${stage === "3h" ? "in a few hours" : "within a day"}. Add when you're free so you're counted.`,
            dedupeKey: (u) => `reminder:${id}:${stage}:${u}`,
            email: true,
          });
        }
        if (stage && organizer) {
          const blockers: string[] = [];
          if (missing.length) blockers.push(`${missing.length} haven't responded (${missing.map((m) => m.display_name).join(", ")})`);
          if (!evaluation.evaluations.some((e) => e.status === "FEASIBLE")) blockers.push("no option works for everyone yet");
          const openQs = bundle.clarifications.filter((c) => c.status === "open").length;
          if (openQs) blockers.push(`${openQs} answer${openQs > 1 ? "s" : ""} need clarifying`);
          if (blockers.length || stage === "passed") {
            report.deadlineNotices += await notify({
              planId: id,
              userIds: [organizer.user_id],
              kind: "deadline",
              title: stage === "passed" ? `Decision time for ${bundle.plan.title}` : `Deadline approaching: ${bundle.plan.title}`,
              body: blockers.length ? `Still open: ${blockers.join("; ")}.` : "Everyone has weighed in — you can finalize.",
              dedupeKey: (u) => `deadline:${id}:${stage}:${u}`,
              email: true,
            });
          }
        }
      }

      // --- check_consensus ----------------------------------------------------------
      if (evaluation.consensus.state === "strong" && evaluation.consensus.leadingCandidateId && organizer) {
        const title = bundle.candidates.find((c) => c.id === evaluation.consensus.leadingCandidateId)?.title ?? "an option";
        report.consensusNotices += await notify({
          planId: id,
          userIds: [organizer.user_id],
          kind: "consensus",
          title: `Everyone's on board with ${title}`,
          body: `${bundle.plan.title}: strong alignment. Ready to finalize?`,
          dedupeKey: (u) => `consensus:${id}:${evaluation.consensus.leadingCandidateId}:${u}`,
          email: true,
        });
      }

      // --- refresh_candidate_data (serious contenders only, cadence by urgency) -----
      const firstDate = allowedDates(input.dimensions, input.plan, 60)[0] ?? null;
      const cadence = refreshCadenceHours({ plan: bundle.plan, firstDate }, now);
      if (cadence && searchAvailable()) {
        const bucket = String(Math.floor(now / (cadence * HOUR)));
        if (await claim("refresh", id, bucket)) {
          const contenders = evaluation.evaluations.filter((e) => e.status !== "INFEASIBLE").slice(0, 3).map((e) => e.candidateId);
          if (bundle.plan.kind === "travel") {
            const stale = bundle.candidates.some((c) => c.type === "travel_package" && contenders.includes(c.id) && (!c.fetched_at || now - Date.parse(c.fetched_at) > cadence * HOUR));
            if (stale) {
              const r = await runTravelSearch(id);
              report.refreshed += r.added;
            }
            await finish("refresh", id, bucket, stale ? "done" : "skipped");
          } else {
            // Static venue facts: only re-enrich contenders whose data is missing or failed.
            const needs = bundle.candidates.filter((c) => contenders.includes(c.id) && (c.enrichment_status === "failed" || c.enrichment_status === "pending")).map((c) => c.id);
            if (needs.length) {
              await sql`update public.candidates set enrichment_status = 'pending' where id in ${sql(needs)}`;
              await enrichCandidatesInBackground(id, needs);
              report.refreshed += needs.length;
            }
            await finish("refresh", id, bucket, needs.length ? "done" : "skipped");
          }
        } else report.skipped++;
      }
    } catch (e) {
      report.errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  return report;
}
