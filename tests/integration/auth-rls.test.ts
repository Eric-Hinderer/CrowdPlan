import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  callJoin,
  cleanupRun,
  createOrganizer,
  createPlan,
  joinAsGuest,
  magicLinkTokenHash,
  newRunId,
} from "./helpers";

/**
 * Direct Data API authorization tests against the real Supabase test project.
 * Actors: organizer, invited guest, outsider account, guest of another plan,
 * anonymous visitor, and a revoked invitation.
 */
const runId = newRunId("rls");
let org: Awaited<ReturnType<typeof createOrganizer>>;
let outsider: Awaited<ReturnType<typeof createOrganizer>>;
let planA: Awaited<ReturnType<typeof createPlan>>;
let planB: Awaited<ReturnType<typeof createPlan>>;
let guest: { client: SupabaseClient; userId: string; planId: string };
let otherGuest: { client: SupabaseClient; userId: string; planId: string };
let guestMemberId: string;

beforeAll(async () => {
  org = await createOrganizer(runId, "Org");
  outsider = await createOrganizer(runId, "Outsider");
  planA = await createPlan(org.client, runId);
  planB = await createPlan(outsider.client, runId);
  guest = await joinAsGuest(planA.code, planA.token, "Sarah");
  otherGuest = await joinAsGuest(planB.code, planB.token, "Mallory");
  const { data } = await guest.client.from("plan_members").select("id").eq("user_id", guest.userId).single();
  guestMemberId = data!.id;
});

afterAll(async () => {
  await cleanupRun(runId);
});

describe("organizer auth", () => {
  it("signs in with the real magic-link verification path and signs out", async () => {
    const tokenHash = await magicLinkTokenHash(org.email);
    const client = anonClient();
    const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    expect(error).toBeNull();
    expect(data.session?.user.email).toBe(org.email);
    const { error: outError } = await client.auth.signOut();
    expect(outError).toBeNull();
    const { data: after } = await client.auth.getSession();
    expect(after.session).toBeNull();
  });

  it("creates a plan with organizer membership and dimensions", async () => {
    const { data: members } = await org.client.from("plan_members").select("role, user_id").eq("plan_id", planA.planId);
    expect(members?.find((m) => m.user_id === org.userId)?.role).toBe("organizer");
    const { data: dims } = await org.client.from("plan_dimensions").select("key, state").eq("plan_id", planA.planId);
    expect(dims).toEqual([{ key: "activity", state: "LOCKED" }]);
  });
});

describe("guest participation without signup", () => {
  it("previews an invitation without creating an identity", async () => {
    const { status, json } = await callJoin({ action: "preview", code: planA.code, token: planA.token });
    expect(status).toBe(200);
    expect(json.title).toBe("Integration plan");
  });

  it("rejects a wrong token for a valid public code", async () => {
    const { status } = await callJoin({ action: "join", code: planA.code, token: "x".repeat(32), displayName: "Eve" });
    expect(status).toBe(404);
  });

  it("gives the guest a real session scoped to the invited plan", async () => {
    const { data: jwtClaims } = await guest.client.auth.getClaims();
    expect(jwtClaims?.claims.app_metadata?.cp_guest).toBe(true);
    const { data: plans } = await guest.client.from("plans").select("id");
    expect(plans?.map((p) => p.id)).toEqual([planA.planId]);
  });

  it("resumes access with the persisted session (refresh)", async () => {
    const { data, error } = await guest.client.auth.refreshSession();
    expect(error).toBeNull();
    expect(data.session?.user.id).toBe(guest.userId);
    const { data: plans } = await guest.client.from("plans").select("id");
    expect(plans).toHaveLength(1);
  });

  it("lets the guest write their own availability and response", async () => {
    const { error } = await guest.client.from("availability_windows").insert({
      plan_id: planA.planId,
      member_id: guestMemberId,
      starts_at: "2026-10-03T22:00:00Z",
      ends_at: "2026-10-04T02:00:00Z",
      level: "works",
    });
    expect(error).toBeNull();
    const { error: respError } = await guest.client.from("member_responses").insert({
      plan_id: planA.planId,
      member_id: guestMemberId,
      answers: { budgetMax: 40 },
    });
    expect(respError).toBeNull();
  });
});

describe("guest cannot perform organizer-only or cross-member mutations", () => {
  it("cannot edit plan fields", async () => {
    const { data } = await guest.client.from("plans").update({ title: "hijacked" }).eq("id", planA.planId).select();
    expect(data ?? []).toHaveLength(0);
    const { data: plan } = await org.client.from("plans").select("title").eq("id", planA.planId).single();
    expect(plan?.title).toBe("Integration plan");
  });

  it("cannot change dimension states", async () => {
    const { data } = await guest.client.from("plan_dimensions").update({ state: "UNDECIDED" }).eq("plan_id", planA.planId).select();
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot write constraints or availability for another member", async () => {
    const { data: orgMember } = await org.client.from("plan_members").select("id").eq("user_id", org.userId).eq("plan_id", planA.planId).single();
    const { error } = await guest.client.from("plan_constraints").insert({
      plan_id: planA.planId, member_id: orgMember!.id, kind: "max_budget", strength: "hard", params: { amount: 1 },
    });
    expect(error).not.toBeNull();
    const { error: avError } = await guest.client.from("availability_windows").insert({
      plan_id: planA.planId, member_id: orgMember!.id, starts_at: "2026-10-03T22:00:00Z", ends_at: "2026-10-03T23:00:00Z", level: "unavailable",
    });
    expect(avError).not.toBeNull();
  });

  it("cannot escalate role or rebind membership", async () => {
    const { error } = await guest.client.from("plan_members").update({ role: "organizer" }).eq("id", guestMemberId);
    expect(error).not.toBeNull(); // column privilege denied
    const { error: rebind } = await guest.client.from("plan_members").update({ user_id: org.userId }).eq("id", guestMemberId);
    expect(rebind).not.toBeNull();
  });

  it("cannot insert live provider data or create plans", async () => {
    const { error } = await guest.client.from("candidates").insert({
      plan_id: planA.planId, type: "restaurant", title: "Fake live", origin: "shortlist", source_kind: "live", added_by: guestMemberId,
    });
    expect(error).not.toBeNull();
    const { error: planError } = await guest.client.rpc("create_plan", { p: { title: "guest plan", test_run_id: runId } });
    expect(planError).not.toBeNull();
  });

  it("cannot read invitations or finalize", async () => {
    const { data: invites } = await guest.client.from("plan_invites").select("id").eq("plan_id", planA.planId);
    expect(invites ?? []).toHaveLength(0);
    const { data: cand } = await org.client.from("candidates").insert({
      plan_id: planA.planId, type: "venue", title: "Vala's", origin: "fixed", source_kind: "user",
      added_by: (await org.client.from("plan_members").select("id").eq("plan_id", planA.planId).eq("user_id", org.userId).single()).data!.id,
    }).select("id").single();
    const { data: plan } = await org.client.from("plans").select("version").eq("id", planA.planId).single();
    const { error } = await guest.client.rpc("finalize_plan", {
      p_plan: planA.planId, p_candidate: cand!.id, p_expected_version: plan!.version, p_snapshot: {}, p_notes: null,
    });
    expect(error?.message).toMatch(/only the organizer/);
  });
});

describe("isolation between plans", () => {
  it("outsider account cannot read or join without a valid invitation", async () => {
    const { data } = await outsider.client.from("plans").select("id").eq("id", planA.planId);
    expect(data ?? []).toHaveLength(0);
    const { data: members } = await outsider.client.from("plan_members").select("id").eq("plan_id", planA.planId);
    expect(members ?? []).toHaveLength(0);
    const { error } = await outsider.client.rpc("redeem_invite", { p_code: planA.code, p_token: "y".repeat(32), p_display_name: "Out" });
    expect(error).not.toBeNull();
  });

  it("guest of another plan sees nothing from plan A", async () => {
    for (const table of ["plans", "plan_members", "availability_windows", "member_responses", "candidates", "reactions", "plan_constraints"]) {
      const column = table === "plans" ? "id" : "plan_id";
      const { data } = await otherGuest.client.from(table).select("*").eq(column, planA.planId);
      expect(data ?? [], table).toHaveLength(0);
    }
  });

  it("anonymous visitors have no table access", async () => {
    const { data, error } = await anonClient().from("plans").select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("revoked invitations stop working for new guests", async () => {
    await org.client.from("plan_invites").update({ revoked_at: new Date().toISOString() }).eq("plan_id", planA.planId);
    const { status } = await callJoin({ action: "join", code: planA.code, token: planA.token, displayName: "Late" });
    expect(status).toBe(404);
    // Existing members keep access.
    const { data } = await guest.client.from("plans").select("id").eq("id", planA.planId);
    expect(data).toHaveLength(1);
  });
});

describe("realtime authorization", () => {
  it("delivers plan version changes to members only", async () => {
    const received: Record<string, number> = { guest: 0, otherGuest: 0 };
    const subscribe = (name: string, client: SupabaseClient) =>
      new Promise<ReturnType<SupabaseClient["channel"]>>((resolve, reject) => {
        const channel = client
          .channel(`plan-${planA.planId}-${name}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "plans", filter: `id=eq.${planA.planId}` }, () => {
            received[name]++;
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") resolve(channel);
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`${name}: ${status}`));
          });
      });
    for (const c of [guest.client, otherGuest.client]) {
      const { data } = await c.auth.getSession();
      c.realtime.setAuth(data.session!.access_token);
    }
    const channels = [await subscribe("guest", guest.client), await subscribe("otherGuest", otherGuest.client)];
    await new Promise((r) => setTimeout(r, 1500));
    await org.client.from("plans").update({ title: "Integration plan (updated)" }).eq("id", planA.planId);
    const deadline = Date.now() + 15_000;
    while (received.guest === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 1500));
    expect(received.guest).toBeGreaterThan(0);
    expect(received.otherGuest).toBe(0);
    for (const ch of channels) await ch.unsubscribe();
  });
});

describe("finalization and stale writes", () => {
  it("rejects a stale version and finalizes with the current one", async () => {
    const { data: cand } = await org.client.from("candidates").select("id").eq("plan_id", planA.planId).limit(1).single();
    const { data: plan } = await org.client.from("plans").select("version").eq("id", planA.planId).single();
    const stale = await org.client.rpc("finalize_plan", {
      p_plan: planA.planId, p_candidate: cand!.id, p_expected_version: plan!.version - 1, p_snapshot: {}, p_notes: null,
    });
    expect(stale.error?.message).toMatch(/stale/);
    const ok = await org.client.rpc("finalize_plan", {
      p_plan: planA.planId, p_candidate: cand!.id, p_expected_version: plan!.version, p_snapshot: { headline: "Set" }, p_notes: "See you there",
    });
    expect(ok.error).toBeNull();
    const { data: seen } = await guest.client.from("plans").select("status, finalized_candidate_id").eq("id", planA.planId).single();
    expect(seen).toEqual({ status: "finalized", finalized_candidate_id: cand!.id });
    const { data: notes } = await guest.client.from("notifications").select("kind").eq("plan_id", planA.planId);
    expect(notes?.map((n) => n.kind)).toContain("plan_finalized");
    // Finalized plans reject further guest edits.
    const { error } = await guest.client.from("availability_windows").insert({
      plan_id: planA.planId, member_id: guestMemberId, starts_at: "2026-10-05T22:00:00Z", ends_at: "2026-10-05T23:00:00Z", level: "works",
    });
    expect(error).not.toBeNull();
  });
});

describe("guest account claim", () => {
  it("moves membership only with proof of the guest session", async () => {
    // A non-guest cannot mint a claim ticket.
    const { error: notGuest } = await outsider.client.rpc("create_claim_ticket");
    expect(notGuest).not.toBeNull();
    const { data: ticket, error } = await otherGuest.client.rpc("create_claim_ticket");
    expect(error).toBeNull();
    // A wrong ticket fails.
    const { error: wrong } = await org.client.rpc("redeem_claim_ticket", { p_ticket: "0".repeat(48) });
    expect(wrong).not.toBeNull();
    // Outsider already belongs to plan B as organizer, so the guest row is skipped, not merged.
    const { data: result, error: redeemError } = await outsider.client.rpc("redeem_claim_ticket", { p_ticket: ticket });
    expect(redeemError).toBeNull();
    expect(result).toEqual({ moved: 0, skipped: 1 });
    // Ticket is single-use.
    const { error: reuse } = await org.client.rpc("redeem_claim_ticket", { p_ticket: ticket });
    expect(reuse).not.toBeNull();
  });
});
