"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { claimGuestAction, createClaimTicketAction, savePreferencesAction } from "@/app/actions/account";
import { Button, ErrorNote, Field, Input } from "@/components/ui/primitives";

interface Prefs {
  home_area: string | null;
  usual_dinner_budget: number | null;
  favorite_cuisines: string[];
  dietary_restrictions: string[];
  activity_preferences: string[];
}

const TICKET_KEY = "cp-claim-ticket";

export function AccountPanel({ isGuest, email, displayName, prefs }: { isGuest: boolean; email: string | null; displayName: string; prefs: Prefs | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // After signing in, finish a pending claim that was started from a guest session on this device.
  useEffect(() => {
    if (isGuest) return;
    let ticket: string | null = null;
    try {
      ticket = sessionStorage.getItem(TICKET_KEY);
    } catch {}
    if (!ticket) return;
    start(async () => {
      const r = await claimGuestAction(ticket!);
      try {
        sessionStorage.removeItem(TICKET_KEY);
      } catch {}
      if (r.ok) setNotice(r.data.moved ? `Moved ${r.data.moved} plan${r.data.moved > 1 ? "s" : ""} into your account.` : "Nothing to move — you were already in those plans.");
      else setError(r.error);
    });
  }, [isGuest]);

  if (isGuest) {
    return (
      <div>
        <h1 className="t-title">Save your answers to an account</h1>
        <p className="mt-3 text-ink-2">
          You joined as a guest. Create or sign in to an account on this device and CrowdPlan will move your plans and answers into it — so you can open them anywhere and reuse your preferences.
        </p>
        {error ? <div className="mt-4"><ErrorNote>{error}</ErrorNote></div> : null}
        <Button
          className="mt-6"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await createClaimTicketAction();
              if (!r.ok) return setError(r.error);
              try {
                sessionStorage.setItem(TICKET_KEY, r.data.ticket);
              } catch {
                return setError("Your browser blocked storage needed to finish this. Try a normal (non-private) window.");
              }
              router.push("/login?next=/me");
            })
          }
        >
          Continue to sign in
        </Button>
        <p className="mt-3 text-xs text-ink-3">Proof is your current guest session on this device — never your name.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="t-title">Your account</h1>
        <p className="mt-1 text-ink-2">{displayName ? `${displayName} · ` : ""}{email}</p>
      </div>
      {notice ? <p role="status" className="rounded-xl border border-resolved/30 bg-resolved/8 px-3.5 py-2.5 text-sm text-resolved">{notice}</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <PreferencesForm prefs={prefs} />
    </div>
  );
}

function PreferencesForm({ prefs }: { prefs: Prefs | null }) {
  const [home, setHome] = useState(prefs?.home_area ?? "");
  const [budget, setBudget] = useState(prefs?.usual_dinner_budget ? String(prefs.usual_dinner_budget) : "");
  const [cuisines, setCuisines] = useState((prefs?.favorite_cuisines ?? []).join(", "));
  const [dietary, setDietary] = useState((prefs?.dietary_restrictions ?? []).join(", "));
  const [activities, setActivities] = useState((prefs?.activity_preferences ?? []).join(", "));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
  return (
    <form
      className="space-y-4 rounded-2xl border border-rule bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await savePreferencesAction({ homeArea: home || null, usualDinnerBudget: budget ? Number(budget) : null, favoriteCuisines: list(cuisines), dietaryRestrictions: list(dietary), activityPreferences: list(activities) });
          if (!r.ok) return setError(r.error);
          setSaved(true);
        });
      }}
    >
      <h2 className="t-heading">Stable preferences</h2>
      <p className="text-sm text-ink-2">Used to prefill your answers when you join a plan. You always review them first — nothing is applied automatically.</p>
      <Field label="Home area" htmlFor="home">
        <Input id="home" value={home} maxLength={120} onChange={(e) => setHome(e.target.value)} placeholder="West Omaha" />
      </Field>
      <Field label="Usual dinner budget ($ per person)" htmlFor="budget">
        <Input id="budget" type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} />
      </Field>
      <Field label="Favorite cuisines" htmlFor="cuis" hint="Comma separated">
        <Input id="cuis" value={cuisines} onChange={(e) => setCuisines(e.target.value)} />
      </Field>
      <Field label="Dietary restrictions" htmlFor="diet" hint="Sensitive — only suggested to you, never shared until you confirm in a plan.">
        <Input id="diet" value={dietary} onChange={(e) => setDietary(e.target.value)} />
      </Field>
      <Field label="Activities you enjoy" htmlFor="act">
        <Input id="act" value={activities} onChange={(e) => setActivities(e.target.value)} />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          Save preferences
        </Button>
        {saved ? <span role="status" className="text-sm text-resolved">Saved</span> : null}
      </div>
    </form>
  );
}
