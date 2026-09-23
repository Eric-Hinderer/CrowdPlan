import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

export const TEST_DOMAIN = "crowdplan-e2e.example.com";

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} (see .env.example)`);
  return value;
}

export function newRunId(prefix = "it"): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function anonClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function adminCall(body: Record<string, unknown>) {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/cp-admin`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": env("E2E_ADMIN_SECRET") },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`cp-admin ${String(body.action)} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

export async function createOrganizer(runId: string, name: string) {
  const email = `${name.toLowerCase()}.${runId}@${TEST_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  await adminCall({ action: "create_user", email, password, displayName: name });
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return { client, email, password, userId: data.user!.id };
}

export async function magicLinkTokenHash(email: string): Promise<string> {
  const json = await adminCall({ action: "magic_link", email });
  return json.tokenHash;
}

export async function cleanupRun(runId: string) {
  return adminCall({ action: "cleanup", testRunId: runId });
}

export function newInvite() {
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export async function callJoin(body: Record<string, unknown>) {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/join-plan`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

export async function joinAsGuest(code: string, token: string, displayName: string) {
  const { status, json } = await callJoin({ action: "join", code, token, displayName });
  if (status !== 200) throw new Error(`join failed: ${status} ${JSON.stringify(json)}`);
  const client = anonClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash: json.tokenHash, type: "magiclink" });
  if (error || !data.session) throw new Error(`guest verify failed: ${error?.message}`);
  return { client, userId: data.user!.id, planId: json.planId as string };
}

export async function createPlan(client: SupabaseClient, runId: string, extra: Record<string, unknown> = {}) {
  const invite = newInvite();
  const { data: planId, error } = await client.rpc("create_plan", {
    p: {
      title: "Integration plan",
      kind: "activity",
      mode: "fixed",
      organizer_name: "Org",
      test_run_id: runId,
      invite_token_hash: invite.hash,
      dimensions: [
        { key: "activity", label: "What", state: "LOCKED", value: { type: "text", text: "Pumpkin patch" }, display: "Pumpkin patch" },
      ],
      ...extra,
    },
  });
  if (error) throw new Error(`create_plan failed: ${error.message}`);
  const { data: plan } = await client.from("plans").select("id, share_code, version").eq("id", planId).single();
  return { planId: planId as string, code: plan!.share_code as string, token: invite.token, version: plan!.version as number };
}
