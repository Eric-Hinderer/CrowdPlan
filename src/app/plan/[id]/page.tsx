import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/crowdplan/app-header";
import { PlanWorkspace } from "@/components/crowdplan/workspace/workspace";
import { loadPlanBundle, PlanAccessError } from "@/lib/plan-data";
import { getServerSupabase, getViewer } from "@/lib/supabase/server";
import { interpretationProviderName } from "@/providers/llm";
import { emailConfigured } from "@/server/notify";

export const metadata: Metadata = { title: "Plan", robots: { index: false, follow: false } };

export default async function PlanPage({ params, searchParams }: PageProps<"/plan/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!/^[0-9a-f-]{36}$/.test(id)) return <NoAccess signedIn={!!viewer} />;
  if (!viewer) return <NoAccess signedIn={false} />;
  const supabase = await getServerSupabase();
  let bundle: Awaited<ReturnType<typeof loadPlanBundle>>;
  try {
    bundle = await loadPlanBundle(supabase, id, viewer.userId);
  } catch (e) {
    if (e instanceof PlanAccessError) return <NoAccess signedIn />;
    throw e;
  }
  return (
      <>
        <AppHeader />
        <main className="flex-1">
          <PlanWorkspace
            initial={bundle}
            userId={viewer.userId}
            welcome={sp.welcome === "1"}
            flags={{
              searchConfigured: Boolean(process.env.SERPAPI_API_KEY),
              interpretation: interpretationProviderName(),
              emailConfigured: emailConfigured(),
              demo: false,
            }}
          />
        </main>
      </>
  );
}

function NoAccess({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <h1 className="t-title">This plan is private</h1>
        <p className="mt-3 text-ink-2">
          Open the invite link your organizer shared to join. {signedIn ? "If you already joined on another device, open the link there or ask for a new one." : "Organizers can sign in to see their plans."}
        </p>
        <div className="mt-6 flex gap-3">
          {!signedIn ? (
            <Link href="/login" className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-brand-ink">
              Sign in
            </Link>
          ) : null}
          <Link href="/" className="rounded-xl border border-rule px-4 py-2.5 font-semibold">
            Go home
          </Link>
        </div>
      </main>
    </>
  );
}
