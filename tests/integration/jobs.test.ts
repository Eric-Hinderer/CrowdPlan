import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScheduledJobs } from "@/server/jobs";
import { serverDb } from "@/server/db";
import { cleanupRun, createOrganizer, createPlan, joinAsGuest, newRunId } from "./helpers";

/**
 * Scheduled jobs against the real test database: deadline reminders go only to
 * people who haven't responded, the organizer hears about blockers, and reruns
 * never duplicate notifications.
 */
const runId = newRunId("jobs");
let org: Awaited<ReturnType<typeof createOrganizer>>;
let plan: Awaited<ReturnType<typeof createPlan>>;
let quiet: Awaited<ReturnType<typeof joinAsGuest>>;
let responder: Awaited<ReturnType<typeof joinAsGuest>>;

beforeAll(async () => {
  org = await createOrganizer(runId, "Org");
  plan = await createPlan(org.client, runId, { decide_by: new Date(Date.now() + 2 * 3600_000).toISOString() });
  quiet = await joinAsGuest(plan.code, plan.token, "Quiet");
  responder = await joinAsGuest(plan.code, plan.token, "Responder");
  const { data: me } = await responder.client.from("plan_members").select("id").eq("user_id", responder.userId).single();
  await responder.client.from("availability_windows").insert({
    plan_id: plan.planId,
    member_id: me!.id,
    starts_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    ends_at: new Date(Date.now() + 27 * 3600_000).toISOString(),
    level: "works",
  });
});

afterAll(async () => {
  await cleanupRun(runId);
  await serverDb().end();
});

async function kinds(client: typeof org.client) {
  const { data } = await client.from("notifications").select("kind, body").eq("plan_id", plan.planId);
  return data ?? [];
}

describe("scheduled jobs", () => {
  it("reminds only missing participants and tells the organizer what's blocking", async () => {
    const report = await runScheduledJobs();
    expect(report.errors).toEqual([]);
    const q = await kinds(quiet.client);
    const r = await kinds(responder.client);
    const o = await kinds(org.client);
    expect(q.map((n) => n.kind)).toContain("reminder");
    expect(r.map((n) => n.kind)).not.toContain("reminder");
    const deadline = o.find((n) => n.kind === "deadline");
    expect(deadline?.body).toMatch(/haven't responded \(.*Quiet/);
  });

  it("is idempotent: a second run sends nothing new", async () => {
    const before = (await kinds(quiet.client)).length + (await kinds(org.client)).length;
    await runScheduledJobs();
    const after = (await kinds(quiet.client)).length + (await kinds(org.client)).length;
    expect(after).toBe(before);
  });

  it("finalized plans are skipped entirely", async () => {
    const { data: cand } = await org.client
      .from("candidates")
      .insert({ plan_id: plan.planId, type: "venue", title: "Somewhere", origin: "custom", source_kind: "user", added_by: (await org.client.from("plan_members").select("id").eq("plan_id", plan.planId).eq("user_id", org.userId).single()).data!.id })
      .select("id")
      .single();
    const { data: p } = await org.client.from("plans").select("version").eq("id", plan.planId).single();
    const { error } = await org.client.rpc("finalize_plan", { p_plan: plan.planId, p_candidate: cand!.id, p_expected_version: p!.version, p_snapshot: { headline: "x" }, p_notes: null });
    expect(error).toBeNull();
    const sql = serverDb();
    const before = await sql`select count(*)::int as n from private.job_runs where plan_id = ${plan.planId}`;
    await runScheduledJobs();
    const after = await sql`select count(*)::int as n from private.job_runs where plan_id = ${plan.planId}`;
    expect(after[0].n).toBe(before[0].n);
  });
});
