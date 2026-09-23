import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/crowdplan/app-header";
import { getServerSupabase, getViewer } from "@/lib/supabase/server";
import { AccountPanel } from "./account-panel";

export const metadata: Metadata = { title: "Account" };

export default async function MePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/me");
  const supabase = await getServerSupabase();
  const [{ data: profile }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", viewer.userId).maybeSingle(),
    viewer.isGuest ? Promise.resolve({ data: null }) : supabase.from("saved_preferences").select("*").eq("user_id", viewer.userId).maybeSingle(),
  ]);
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <AccountPanel isGuest={viewer.isGuest} email={viewer.email} displayName={profile?.display_name ?? ""} prefs={prefs ?? null} />
      </main>
    </>
  );
}
