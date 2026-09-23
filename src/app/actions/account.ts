"use server";

import { z } from "zod";
import { ActionError, requireAccount, requireViewer, run, type ActionResult } from "@/server/guard";

export async function createClaimTicketAction(): Promise<ActionResult<{ ticket: string }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    if (!viewer.isGuest) throw new ActionError("You're already signed in to an account.");
    const { data, error } = await supabase.rpc("create_claim_ticket");
    if (error) throw new Error(error.message);
    // Sign the guest out of this browser so the account sign-in starts clean; the ticket proves the guest session.
    await supabase.auth.signOut({ scope: "local" });
    return { ticket: data as string };
  });
}

export async function claimGuestAction(ticket: string): Promise<ActionResult<{ moved: number; skipped: number }>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const t = z.string().regex(/^[0-9a-f]{48}$/).parse(ticket);
    const { data, error } = await supabase.rpc("redeem_claim_ticket", { p_ticket: t });
    if (error) throw new ActionError("That claim link expired. Open a plan as a guest and try again.");
    return data as { moved: number; skipped: number };
  });
}

const prefsSchema = z.object({
  homeArea: z.string().trim().max(120).nullable(),
  usualDinnerBudget: z.number().int().min(1).max(10000).nullable(),
  favoriteCuisines: z.array(z.string().trim().min(1).max(40)).max(12),
  dietaryRestrictions: z.array(z.string().trim().min(1).max(40)).max(12),
  activityPreferences: z.array(z.string().trim().min(1).max(40)).max(12),
});

export async function savePreferencesAction(input: z.input<typeof prefsSchema>): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase, viewer } = await requireAccount();
    const p = prefsSchema.parse(input);
    const { error } = await supabase.from("saved_preferences").upsert({
      user_id: viewer.userId,
      home_area: p.homeArea,
      usual_dinner_budget: p.usualDinnerBudget,
      favorite_cuisines: p.favoriteCuisines,
      dietary_restrictions: p.dietaryRestrictions,
      activity_preferences: p.activityPreferences,
    });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function getMyPreferencesAction(): Promise<ActionResult<{ homeArea: string | null; usualDinnerBudget: number | null; favoriteCuisines: string[]; dietaryRestrictions: string[] } | null>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    if (viewer.isGuest) return null;
    const { data } = await supabase.from("saved_preferences").select("*").eq("user_id", viewer.userId).maybeSingle();
    if (!data) return null;
    return { homeArea: data.home_area, usualDinnerBudget: data.usual_dinner_budget, favoriteCuisines: data.favorite_cuisines, dietaryRestrictions: data.dietary_restrictions };
  });
}
