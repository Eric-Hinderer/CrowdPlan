import type { Metadata } from "next";
import { AppHeader } from "@/components/crowdplan/app-header";
import { getViewer } from "@/lib/supabase/server";
import { JoinPlan } from "./join";

export const metadata: Metadata = { title: "Join a plan", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function JoinPage({ params }: PageProps<"/p/[code]">) {
  const { code } = await params;
  const viewer = await getViewer();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
        <JoinPlan code={code.toUpperCase().slice(0, 6)} signedIn={!!viewer} />
      </main>
    </>
  );
}
