"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendMagicLinkAction, signInWithPasswordAction, signUpAction } from "@/app/actions/auth";
import { Button, ErrorNote, Field, Input } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";

type Mode = "link" | "password" | "signup";

export function LoginForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      if (mode === "link") {
        const r = await sendMagicLinkAction({ email, next });
        if (!r.ok) setError(r.error);
        else setNotice(`Check ${email} for a sign-in link.`);
      } else if (mode === "password") {
        const r = await signInWithPasswordAction({ email, password, next });
        if (!r.ok) setError(r.error);
        else {
          router.replace(r.data.next);
          router.refresh();
        }
      } else {
        const r = await signUpAction({ email, password, name, next });
        if (!r.ok) setError(r.error);
        else if (r.data.needsConfirmation) setNotice(`Almost there — confirm your email from the message we sent to ${email}, then sign in.`);
        else {
          router.replace(r.data.next);
          router.refresh();
        }
      }
    });

  const tabs: Array<{ id: Mode; label: string }> = [
    { id: "password", label: "Sign in" },
    { id: "signup", label: "Create account" },
    { id: "link", label: "Email me a link" },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Sign-in method" className="mb-6 grid grid-cols-3 rounded-xl bg-surface-2 p-1 text-sm font-semibold">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={mode === t.id}
            onClick={() => {
              setMode(t.id);
              setError(null);
              setNotice(null);
            }}
            className={`rounded-lg px-2 py-2 transition ${mode === t.id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === "signup" ? (
          <Field label="Your name" htmlFor="name" hint="Shown to friends on your plans.">
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
        ) : null}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode !== "link" ? (
          <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {notice ? (
          <p role="status" className="rounded-xl border border-resolved/30 bg-resolved/8 px-3.5 py-2.5 text-sm text-resolved">
            {notice}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={pending}>
          {mode === "link" ? "Email me a sign-in link" : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>
      {googleEnabled ? (
        <div className="mt-6 border-t border-rule pt-6">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              getBrowserSupabase().auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
              })
            }
          >
            Continue with Google
          </Button>
        </div>
      ) : null}
    </div>
  );
}
