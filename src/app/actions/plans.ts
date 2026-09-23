"use server";

import { after } from "next/server";
import { z } from "zod";
import { validateDimension } from "@/domain/dimensions";
import { dimensionDraftSchema, type PlanExtraction } from "@/domain/interpretation/schema";
import type { Dimension } from "@/domain/types";
import { parsePlaceUrl } from "@/domain/urls";
import { interpretPlan, interpretationProviderName } from "@/providers/llm";
import { logEvent } from "@/server/events";
import { ActionError, requireAccount, requireViewer, run, type ActionResult } from "@/server/guard";
import { decryptToken, generateInvite, inviteUrl } from "@/server/invite";
import { enrichCandidatesInBackground } from "@/server/search";

const TZ = z.string().min(3).max(64).regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/);

export async function interpretPlanAction(input: { text: string; timezone: string }): Promise<ActionResult<{ extraction: PlanExtraction; provider: string; fallbackReason?: string }>> {
  return run(async () => {
    await requireViewer();
    const text = z.string().trim().min(2, "Tell CrowdPlan a little more.").max(600).parse(input.text);
    const timezone = TZ.catch("America/Chicago").parse(input.timezone);
    const { result, provider, fallbackReason } = await interpretPlan(text, { now: Date.now(), timezone });
    return { extraction: result, provider, fallbackReason };
  });
}

export async function providerStatusAction(): Promise<{ interpretation: string; search: boolean }> {
  return { interpretation: interpretationProviderName(), search: Boolean(process.env.SERPAPI_API_KEY) };
}

const createSchema = z.object({
  rawInput: z.string().max(2000),
  title: z.string().trim().min(1).max(140),
  kind: z.enum(["activity", "dinner", "travel"]),
  mode: z.enum(["fixed", "criteria", "shortlist", "discovery"]),
  discoveryEnabled: z.boolean(),
  timezone: TZ,
  organizerName: z.string().trim().min(1, "Add your name so friends know who's planning.").max(40),
  dimensions: z.array(dimensionDraftSchema).max(16),
  shortlist: z.array(z.object({ title: z.string().trim().max(160).optional(), url: z.string().trim().max(1000).optional() })).max(12),
  decideBy: z.string().datetime({ offset: true }).nullable().optional(),
  minDurationMinutes: z.number().int().min(15).max(1440).optional(),
  locationLabel: z.string().trim().max(120).nullable().optional(),
  testRunId: z.string().regex(/^[a-z0-9-]{6,40}$/).optional(),
});

export async function createPlanAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ planId: string }>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const data = createSchema.parse(input);
    const dims: Dimension[] = data.dimensions.map((d) => ({ ...d, source: "user" as const }));
    for (const d of dims) {
      const err = validateDimension(d);
      if (err) throw new ActionError(err);
    }
    const candidates: Array<Record<string, unknown>> = [];
    const place = dims.find((d) => (d.key === "place" || d.key === "destination") && d.state === "LOCKED" && d.value);
    if (place && place.value && (place.value.type === "place" || place.value.type === "text")) {
      const name = place.value.type === "place" ? place.value.name : place.value.text;
      candidates.push({
        type: data.kind === "travel" ? "travel_package" : data.kind === "dinner" ? "restaurant" : "venue",
        title: name,
        origin: "fixed",
        source_kind: "user",
        attributes: data.kind === "travel" ? { destination: name } : {},
        enrichment_status: data.kind === "travel" ? "none" : "pending",
      });
    }
    if (data.mode === "shortlist") {
      for (const item of data.shortlist) {
        let title = item.title?.trim() || null;
        let url: string | null = null;
        if (item.url) {
          const parsed = parsePlaceUrl(item.url);
          if ("error" in parsed) throw new ActionError(`${item.url}: ${parsed.error}`);
          url = parsed.url;
          title = title || parsed.title;
        }
        if (!title) throw new ActionError("Give each option a name (we couldn't read one from the link).");
        candidates.push({
          type: data.kind === "dinner" ? "restaurant" : "venue",
          title: title.slice(0, 160),
          origin: "shortlist",
          source_kind: "user",
          source_url: url,
          attributes: {},
          enrichment_status: "pending",
        });
      }
    }
    const invite = generateInvite();
    const { data: planId, error } = await supabase.rpc("create_plan", {
      p: {
        title: data.title,
        raw_input: data.rawInput,
        kind: data.kind,
        mode: data.mode,
        discovery_enabled: data.mode === "discovery" ? true : data.discoveryEnabled,
        timezone: data.timezone,
        location_label: data.locationLabel ?? null,
        min_duration_minutes: data.minDurationMinutes ?? (data.kind === "dinner" ? 90 : 120),
        decide_by: data.decideBy ?? null,
        organizer_name: data.organizerName,
        test_run_id: data.testRunId ?? null,
        dimensions: dims.map((d, i) => ({
          key: d.key,
          label: d.label,
          state: d.state,
          value: d.value,
          display: d.display,
          source: "user",
          needs_confirmation: false,
          sort: i,
        })),
        candidates,
        invite_token_hash: invite.hash,
        invite_token_ciphertext: invite.ciphertext,
      },
    });
    if (error) throw new Error(error.message);
    const id = planId as string;
    after(async () => {
      await logEvent(id, null, "plan_created", { mode: data.mode, kind: data.kind });
      await enrichCandidatesInBackground(id);
    });
    return { planId: id };
  });
}

export async function updateDimensionAction(input: { planId: string; dimension: z.input<typeof dimensionDraftSchema> }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const planId = z.string().uuid().parse(input.planId);
    const d = dimensionDraftSchema.parse(input.dimension);
    const err = validateDimension({ ...d, source: "user" });
    if (err) throw new ActionError(err);
    const { data, error } = await supabase
      .from("plan_dimensions")
      .upsert(
        { plan_id: planId, key: d.key, label: d.label, state: d.state, value: d.value, display: d.display, source: "user", needs_confirmation: false },
        { onConflict: "plan_id,key" },
      )
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new ActionError("Only the organizer can change what's settled.");
    return null;
  });
}

export async function getInviteLinkAction(planId: string): Promise<ActionResult<{ url: string; code: string }>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const id = z.string().uuid().parse(planId);
    const { data: plan } = await supabase.from("plans").select("share_code, owner_id").eq("id", id).maybeSingle();
    if (!plan) throw new ActionError("Plan not found.");
    const { data: invites } = await supabase
      .from("plan_invites")
      .select("token_ciphertext")
      .eq("plan_id", id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const token = decryptToken(invites?.[0]?.token_ciphertext);
    if (token) return { url: inviteUrl(plan.share_code, token), code: plan.share_code };
    return rotate(supabase, id, plan.share_code);
  });
}

async function rotate(supabase: Awaited<ReturnType<typeof requireAccount>>["supabase"], planId: string, code: string) {
  const { data: userData } = await supabase.auth.getUser();
  const invite = generateInvite();
  await supabase.from("plan_invites").update({ revoked_at: new Date().toISOString() }).eq("plan_id", planId).is("revoked_at", null);
  const { error } = await supabase.from("plan_invites").insert({
    plan_id: planId,
    token_hash: invite.hash,
    token_ciphertext: invite.ciphertext,
    created_by: userData.user!.id,
  });
  if (error) throw new ActionError("Only the organizer can create invite links.");
  return { url: inviteUrl(code, invite.token), code };
}

export async function rotateInviteAction(planId: string): Promise<ActionResult<{ url: string; code: string }>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const id = z.string().uuid().parse(planId);
    const { data: plan } = await supabase.from("plans").select("share_code").eq("id", id).maybeSingle();
    if (!plan) throw new ActionError("Plan not found.");
    const result = await rotate(supabase, id, plan.share_code);
    after(() => logEvent(id, null, "invite_rotated"));
    return result;
  });
}

const addCandidateSchema = z.object({
  planId: z.string().uuid(),
  title: z.string().trim().max(160).optional(),
  url: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(500).optional(),
  priceMax: z.number().positive().max(100000).optional(),
});

export async function addCandidateAction(input: z.input<typeof addCandidateSchema>): Promise<ActionResult<{ candidateId: string }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const data = addCandidateSchema.parse(input);
    let title = data.title || null;
    let url: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    if (data.url) {
      const parsed = parsePlaceUrl(data.url);
      if ("error" in parsed) throw new ActionError(parsed.error);
      url = parsed.url;
      title = title || parsed.title;
      lat = parsed.lat;
      lng = parsed.lng;
    }
    if (!title) throw new ActionError("Add a name for this option.");
    const [{ data: plan }, { data: me }] = await Promise.all([
      supabase.from("plans").select("kind, mode").eq("id", data.planId).maybeSingle(),
      supabase.from("plan_members").select("id").eq("plan_id", data.planId).eq("user_id", viewer.userId).maybeSingle(),
    ]);
    if (!plan || !me) throw new ActionError("You're not part of this plan.");
    const { data: row, error } = await supabase
      .from("candidates")
      .insert({
        plan_id: data.planId,
        type: plan.kind === "dinner" ? "restaurant" : plan.kind === "travel" ? "destination" : "venue",
        title: title.slice(0, 160),
        description: data.description ?? null,
        origin: plan.mode === "shortlist" ? "shortlist" : "custom",
        source_kind: "user",
        source_url: url,
        lat,
        lng,
        cost: data.priceMax ? { min: null, max: data.priceMax, currency: "USD", basis: "per_person", kind: "user", sourceKind: "user" } : null,
        added_by: me.id,
        enrichment_status: plan.kind === "travel" ? "none" : "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    after(async () => {
      await logEvent(data.planId, me.id, "candidate_added", { title });
      await enrichCandidatesInBackground(data.planId, [row.id]);
    });
    return { candidateId: row.id };
  });
}

export async function withdrawCandidateAction(input: { candidateId: string; restore?: boolean }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireViewer();
    const id = z.string().uuid().parse(input.candidateId);
    const { data, error } = await supabase.from("candidates").update({ status: input.restore ? "active" : "withdrawn" }).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new ActionError("Only the organizer (or whoever added it) can remove this option.");
    return null;
  });
}

const settingsSchema = z.object({
  planId: z.string().uuid(),
  discoveryEnabled: z.boolean().optional(),
  decideBy: z.string().datetime({ offset: true }).nullable().optional(),
  locationLabel: z.string().trim().max(120).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  minDurationMinutes: z.number().int().min(15).max(1440).optional(),
  title: z.string().trim().min(1).max(140).optional(),
});

export async function updatePlanSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const d = settingsSchema.parse(input);
    const patch: Record<string, unknown> = {};
    if (d.discoveryEnabled !== undefined) patch.discovery_enabled = d.discoveryEnabled;
    if (d.decideBy !== undefined) patch.decide_by = d.decideBy;
    if (d.locationLabel !== undefined) patch.location_label = d.locationLabel;
    if (d.locationLat !== undefined) patch.location_lat = d.locationLat;
    if (d.locationLng !== undefined) patch.location_lng = d.locationLng;
    if (d.minDurationMinutes !== undefined) patch.min_duration_minutes = d.minDurationMinutes;
    if (d.title !== undefined) patch.title = d.title;
    const { data, error } = await supabase.from("plans").update(patch).eq("id", d.planId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new ActionError("Only the organizer can change plan settings.");
    return null;
  });
}
