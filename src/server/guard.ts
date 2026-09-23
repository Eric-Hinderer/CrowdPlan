import "server-only";

import { getServerSupabase, getViewer, type Viewer } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export class ActionError extends Error {}

/** Every server action authenticates here; authorization is then enforced by RLS on each query. */
export async function requireViewer(): Promise<{ viewer: Viewer; supabase: Awaited<ReturnType<typeof getServerSupabase>> }> {
  const viewer = await getViewer();
  if (!viewer) throw new ActionError("Your session expired. Sign in or reopen your invite link.");
  const supabase = await getServerSupabase();
  return { viewer, supabase };
}

export async function requireAccount() {
  const ctx = await requireViewer();
  if (ctx.viewer.isGuest) throw new ActionError("Create a free account to organize plans.");
  return ctx;
}

export function describeError(e: unknown): string {
  if (e instanceof ActionError) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    const msg = (e as { message: string }).message;
    if (/row-level security|permission denied|violates row-level/i.test(msg)) return "You don't have permission to do that.";
    if (/stale version/i.test(msg)) return "The plan changed while you were looking. Review the latest version and try again.";
    return msg.length < 200 ? msg : "Something went wrong. Try again.";
  }
  return "Something went wrong. Try again.";
}

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(describeError(e));
  }
}
