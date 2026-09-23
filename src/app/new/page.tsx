import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/crowdplan/app-header";
import { getServerSupabase, getViewer } from "@/lib/supabase/server";
import { interpretationProviderName } from "@/providers/llm";
import { CreateFlow } from "./create-flow";

export const metadata: Metadata = { title: "New plan" };

export default async function NewPlanPage({ searchParams }: PageProps<"/new">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 600) : "";
  const viewer = await getViewer();
  if (!viewer || viewer.isGuest) {
    redirect(`/login?next=${encodeURIComponent(`/new${q ? `?q=${encodeURIComponent(q)}` : ""}`)}`);
  }
  const supabase = await getServerSupabase();
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", viewer.userId).maybeSingle();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-8 pb-24">
        <CreateFlow
          initialText={q}
          defaultName={profile?.display_name ?? ""}
          provider={interpretationProviderName()}
          searchConfigured={Boolean(process.env.SERPAPI_API_KEY)}
        />
      </main>
    </>
  );
}
