// join-plan: lets a visitor join ONE plan through a valid invitation without
// creating an account. The invitation is verified before any identity exists.
// A confirmed, guest-flagged auth user (app_metadata.cp_guest = true) is minted
// server-side and a single-use magic-link token hash is returned; the browser
// exchanges it with supabase.auth.verifyOtp for a normal Supabase session, so
// RLS and Realtime authorize the guest like any other user.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (parsed?.default) return parsed.default;
    } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const admin = createClient(SUPABASE_URL, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const CODE_RE = /^[A-Z2-9]{6}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { action?: string; code?: string; token?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const action = body.action ?? "join";
  const code = String(body.code ?? "").toUpperCase();
  const token = String(body.token ?? "");
  if (!CODE_RE.test(code) || !TOKEN_RE.test(token)) {
    return json(400, { error: "invalid_invite" });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const { data: allowed, error: rlError } = await admin.rpc("edge_rate_limit", {
    p_bucket: `join-ip:${ip}`,
    p_max: action === "preview" ? 120 : 30,
    p_window_seconds: 3600,
  });
  if (rlError) return json(500, { error: "rate_limit_unavailable" });
  if (!allowed) return json(429, { error: "rate_limited" });

  const { data: invite, error: inviteError } = await admin.rpc("check_invite", {
    p_code: code,
    p_token: token,
  });
  if (inviteError) return json(500, { error: "invite_check_failed" });
  const row = Array.isArray(invite) ? invite[0] : invite;
  if (!row?.plan_id) return json(404, { error: "invalid_invite" });

  if (action === "preview") {
    return json(200, {
      planId: row.plan_id,
      title: row.title,
      organizerName: row.organizer_name,
      memberCount: row.member_count,
    });
  }

  const displayName = String(body.displayName ?? "").trim();
  if (displayName.length < 1 || displayName.length > 40) {
    return json(400, { error: "invalid_display_name" });
  }

  const email = `guest-${crypto.randomUUID()}@guests.crowdplan.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { cp_guest: true },
    user_metadata: { display_name: displayName },
  });
  if (createError || !created?.user) {
    return json(500, { error: "guest_create_failed" });
  }
  const userId = created.user.id;

  const { data: planId, error: redeemError } = await admin.rpc("redeem_invite_as", {
    p_user: userId,
    p_code: code,
    p_token: token,
    p_display_name: displayName,
  });
  if (redeemError || !planId) {
    await admin.auth.admin.deleteUser(userId);
    return json(403, { error: "invalid_invite" });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return json(500, { error: "session_mint_failed" });
  }

  return json(200, { planId, tokenHash });
});
