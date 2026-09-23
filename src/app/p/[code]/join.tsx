"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, ErrorNote, Field, Input } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";

interface Preview {
  planId: string;
  title: string;
  organizerName: string | null;
  memberCount: number;
}

const FN = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/join-plan`;

async function callJoin(body: Record<string, unknown>) {
  const res = await fetch(FN(), {
    method: "POST",
    headers: { "content-type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, string> };
}

export function JoinPlan({ code, signedIn }: { code: string; signedIn: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    // The bearer token lives in the URL fragment: never sent to our server, logs or referrers.
    const t = new URLSearchParams(window.location.hash.slice(1)).get("t");
    void (async () => {
      await Promise.resolve();
      if (!t) return setState("invalid");
      setToken(t);
      const { status, json } = await callJoin({ action: "preview", code, token: t });
      if (status !== 200) return setState("invalid");
      setPreview(json as unknown as Preview);
      // Already a member on this device? Go straight to the plan.
      if (signedIn) {
        const supabase = getBrowserSupabase();
        const { data } = await supabase.from("plans").select("id").eq("id", json.planId).maybeSingle();
        if (data) {
          router.replace(`/plan/${json.planId}`);
          return;
        }
      }
      setState("ready");
    })();
  }, [code, signedIn, router]);

  const join = () =>
    start(async () => {
      setError(null);
      if (!token) return;
      const supabase = getBrowserSupabase();
      const { data: session } = await supabase.auth.getSession();
      if (session.session) {
        // Signed in already (organizer account or a guest from another plan): join with this identity.
        const { data, error: rpcError } = await supabase.rpc("redeem_invite", { p_code: code, p_token: token, p_display_name: name.trim() });
        if (rpcError) return setError(rpcError.message.includes("invalid") ? "This invite link is no longer valid." : "Couldn't join. Try again.");
        router.replace(`/plan/${data}`);
        router.refresh();
        return;
      }
      const { status, json } = await callJoin({ action: "join", code, token, displayName: name.trim() });
      if (status === 429) return setError("Too many attempts from this network. Try again in a bit.");
      if (status !== 200) return setError(status === 400 ? "Enter a name (up to 40 characters)." : "This invite link is no longer valid. Ask the organizer for a new one.");
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: json.tokenHash, type: "magiclink" });
      if (verifyError) return setError("Couldn't start your session. Try again.");
      window.history.replaceState(null, "", window.location.pathname); // drop the token from the address bar
      router.replace(`/plan/${json.planId}`);
      router.refresh();
    });

  if (state === "loading") return <p className="text-ink-2">Opening your invite…</p>;
  if (state === "invalid")
    return (
      <div>
        <h1 className="t-title">This invite link doesn&apos;t work</h1>
        <p className="mt-3 text-ink-2">It may have been replaced by a newer link, or copied without the part after the #. Ask your organizer to send it again.</p>
      </div>
    );

  return (
    <div>
      <p className="text-sm font-semibold text-ink-3">{preview?.organizerName ?? "Your friend"} invited you</p>
      <h1 className="t-title mt-1 break-words">{preview?.title}</h1>
      <p className="mt-3 text-ink-2">
        {preview && preview.memberCount > 1 ? `${preview.memberCount} people are planning this. ` : ""}Add your name to share when you&apos;re free and what works for you. No account needed.
      </p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) join();
        }}
      >
        <Field label="Your name" htmlFor="guest-name" hint="This is how the group will see you.">
          <Input id="guest-name" autoComplete="given-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!name.trim()} data-testid="join-submit">
          Join the plan
        </Button>
      </form>
      <p className="mt-6 text-xs text-ink-3">You&apos;ll only see this plan. You can save your answers to an account later.</p>
    </div>
  );
}
