import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupRun, createOrganizer, createPlan, joinAsGuest, newRunId } from "./helpers";

/**
 * Optional account claim and saved preferences (CP-06, CP-28) against the real
 * test project: a guest hands their plan memberships to an account through a
 * single-use ticket, and preferences are readable only by their owner.
 */
const runId = newRunId("acct");
let org: Awaited<ReturnType<typeof createOrganizer>>;
let claimer: Awaited<ReturnType<typeof createOrganizer>>;
let other: Awaited<ReturnType<typeof createOrganizer>>;
let plan: Awaited<ReturnType<typeof createPlan>>;
let guest: Awaited<ReturnType<typeof joinAsGuest>>;

beforeAll(async () => {
  org = await createOrganizer(runId, "Org");
  claimer = await createOrganizer(runId, "Claimer");
  other = await createOrganizer(runId, "Other");
  plan = await createPlan(org.client, runId);
  guest = await joinAsGuest(plan.code, plan.token, "Jake");
});

afterAll(async () => {
  await cleanupRun(runId, guest ? [guest.userId] : []);
});

describe("guest account claim", () => {
  let ticket: string;

  it("only a guest session can create a claim ticket", async () => {
    const { error } = await claimer.client.rpc("create_claim_ticket");
    expect(error?.code).toBe("42501");
    const res = await guest.client.rpc("create_claim_ticket");
    expect(res.error).toBeNull();
    ticket = res.data as string;
    expect(ticket).toMatch(/^[0-9a-f]{48}$/);
  });

  it("a guest cannot redeem a ticket into another guest identity", async () => {
    const { error } = await guest.client.rpc("redeem_claim_ticket", { p_ticket: ticket });
    expect(error?.code).toBe("42501");
  });

  it("an account redeems the ticket and takes over the guest's membership", async () => {
    const { data, error } = await claimer.client.rpc("redeem_claim_ticket", { p_ticket: ticket });
    expect(error).toBeNull();
    expect(data).toEqual({ moved: 1, skipped: 0 });
    const { data: members } = await org.client.from("plan_members").select("display_name, user_id").eq("plan_id", plan.planId);
    const jake = members?.find((m) => m.display_name === "Jake");
    expect(jake?.user_id).toBe(claimer.userId);
    // The claimed plan is now visible to the account.
    const { data: visible } = await claimer.client.from("plans").select("id").eq("id", plan.planId);
    expect(visible).toHaveLength(1);
  });

  it("tickets are single-use", async () => {
    const { error } = await other.client.rpc("redeem_claim_ticket", { p_ticket: ticket });
    expect(error?.code).toBe("42501");
    const { data: visible } = await other.client.from("plans").select("id").eq("id", plan.planId);
    expect(visible).toHaveLength(0);
  });
});

describe("saved preferences", () => {
  it("an account saves and reads its own preferences", async () => {
    const { error } = await claimer.client.from("saved_preferences").upsert({
      user_id: claimer.userId,
      home_area: "Midtown",
      usual_dinner_budget: 40,
      favorite_cuisines: ["Italian"],
      dietary_restrictions: ["vegetarian"],
      activity_preferences: [],
    });
    expect(error).toBeNull();
    const { data } = await claimer.client.from("saved_preferences").select("home_area, usual_dinner_budget, favorite_cuisines").eq("user_id", claimer.userId).single();
    expect(data).toEqual({ home_area: "Midtown", usual_dinner_budget: 40, favorite_cuisines: ["Italian"] });
  });

  it("other accounts cannot read or overwrite them", async () => {
    const { data } = await other.client.from("saved_preferences").select("user_id").eq("user_id", claimer.userId);
    expect(data).toEqual([]);
    const { error } = await other.client.from("saved_preferences").upsert({ user_id: claimer.userId, home_area: "Elsewhere" });
    expect(error).not.toBeNull();
  });

  it("guest sessions cannot store preferences", async () => {
    const { error } = await guest.client.from("saved_preferences").insert({ user_id: guest.userId, home_area: "Somewhere" });
    expect(error).not.toBeNull();
  });
});
