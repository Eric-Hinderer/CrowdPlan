// cp-admin: TEST AUTOMATION ONLY. Creates and cleans up tagged test accounts
// so Playwright can exercise the real sign-in paths. Guarded by a secret whose
// SHA-256 is stored in private.app_settings (e2e_admin_secret_sha256), and
// restricted to the dedicated test email domain so it cannot touch real users.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";

const TEST_DOMAIN = "@crowdplan-e2e.example.com";
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function isTestEmail(email: unknown): email is string {
  return typeof email === "string" && email.length < 200 && email.toLowerCase().endsWith(TEST_DOMAIN)
    && /^[a-z0-9._+-]+@/i.test(email);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (provided.length < 32) return json(401, { error: "unauthorized" });

  const { data: expected } = await admin.rpc("get_app_setting", { p_key: "e2e_admin_secret_sha256" });
  if (typeof expected !== "string" || !timingSafeEqual(await sha256Hex(provided), expected)) {
    return json(401, { error: "unauthorized" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  switch (body.action) {
    case "create_user": {
      if (!isTestEmail(body.email) || typeof body.password !== "string" || body.password.length < 12) {
        return json(400, { error: "invalid_input" });
      }
      const { data, error } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        user_metadata: { display_name: typeof body.displayName === "string" ? body.displayName : undefined },
      });
      if (error) return json(400, { error: error.message });
      return json(200, { userId: data.user?.id });
    }
    case "magic_link": {
      if (!isTestEmail(body.email)) return json(400, { error: "invalid_input" });
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: body.email });
      if (error) return json(400, { error: error.message });
      return json(200, { tokenHash: data.properties?.hashed_token, actionLink: data.properties?.action_link });
    }
    case "cleanup": {
      const runId = String(body.testRunId ?? "");
      if (!/^[a-z0-9-]{6,40}$/.test(runId)) return json(400, { error: "invalid_input" });
      // Collect exactly this run's users before deleting: members of the run's
      // plans (organizer test accounts and minted guests) plus run-tagged accounts.
      const userIds = new Set<string>();
      const runAccounts: string[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        const users = data?.users ?? [];
        for (const u of users) {
          if ((u.email ?? "").endsWith(TEST_DOMAIN) && (u.email ?? "").includes(runId)) {
            userIds.add(u.id);
            runAccounts.push(u.id);
          }
        }
        if (users.length < 200) break;
      }
      const planIds = new Set<string>();
      const { data: tagged } = await admin.from("plans").select("id").eq("test_run_id", runId);
      for (const p of tagged ?? []) planIds.add(p.id);
      if (runAccounts.length) {
        const { data: owned } = await admin.from("plans").select("id").in("owner_id", runAccounts);
        for (const p of owned ?? []) planIds.add(p.id);
      }
      if (planIds.size > 0) {
        const { data: members } = await admin.from("plan_members").select("user_id").in("plan_id", [...planIds]);
        for (const m of members ?? []) userIds.add(m.user_id);
      }
      // Guest identities the run already detached from its plans (e.g. claimed
      // into an account). Still subject to the guest-domain + no-membership check below.
      const extraGuests = Array.isArray(body.guestUserIds) ? body.guestUserIds.slice(0, 50) : [];
      for (const id of extraGuests) {
        if (typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) userIds.add(id);
      }
      const { data: deleted } = planIds.size ? await admin.from("plans").delete().in("id", [...planIds]).select("id") : { data: [] };
      let usersDeleted = 0;
      for (const id of userIds) {
        const { data: u } = await admin.auth.admin.getUserById(id);
        const email = u?.user?.email ?? "";
        // Never delete a real account: only test-domain accounts, and minted
        // guests that no longer belong to any plan.
        if (email.endsWith(TEST_DOMAIN)) {
          await admin.auth.admin.deleteUser(id);
          usersDeleted++;
        } else if (email.endsWith("@guests.crowdplan.invalid")) {
          const { count } = await admin.from("plan_members")
            .select("id", { count: "exact", head: true }).eq("user_id", id);
          if ((count ?? 0) === 0) {
            await admin.auth.admin.deleteUser(id);
            usersDeleted++;
          }
        }
      }
      return json(200, { plansDeleted: deleted?.length ?? 0, usersDeleted });
    }
    default:
      return json(400, { error: "unknown_action" });
  }
});
