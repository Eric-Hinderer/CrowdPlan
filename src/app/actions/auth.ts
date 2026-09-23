"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { appOrigin } from "@/server/invite";
import { fail, ok, type ActionResult } from "@/server/guard";

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);
const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(128);

function safeNext(next: unknown): string {
  const n = typeof next === "string" ? next : "/";
  // Only same-origin relative paths; never protocol-relative or absolute URLs.
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

export async function signInWithPasswordAction(input: { email: string; password: string; next?: string }): Promise<ActionResult<{ next: string }>> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return fail(email.error.issues[0].message);
  if (!input.password) return fail("Enter your password.");
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password: input.password });
  if (error) return fail(/confirm/i.test(error.message) ? "Confirm your email first — check your inbox for the link." : "That email and password don't match.");
  return ok({ next: safeNext(input.next) });
}

export async function signUpAction(input: { email: string; password: string; name: string; next?: string }): Promise<ActionResult<{ next: string; needsConfirmation: boolean }>> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return fail(email.error.issues[0].message);
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) return fail(password.error.issues[0].message);
  const name = input.name.trim().slice(0, 60);
  const next = safeNext(input.next);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      data: { display_name: name || undefined },
      emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return fail(error.message);
  return ok({ next, needsConfirmation: !data.session });
}

export async function sendMagicLinkAction(input: { email: string; next?: string }): Promise<ActionResult<{ sent: true }>> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return fail(email.error.issues[0].message);
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(safeNext(input.next))}`, shouldCreateUser: true },
  });
  if (error) {
    if (/not authorized/i.test(error.message)) return fail("Email sign-in isn't available for this address yet. Use a password instead.");
    if (/rate limit/i.test(error.message)) return fail("Too many emails were sent recently. Wait a few minutes or use a password.");
    return fail(error.message);
  }
  return ok({ sent: true });
}

export async function signOutAction() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
