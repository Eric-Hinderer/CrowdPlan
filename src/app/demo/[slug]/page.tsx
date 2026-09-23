import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/crowdplan/app-header";
import { PlanWorkspace } from "@/components/crowdplan/workspace/workspace";
import { buildDemo, DEMO_PLANS, type DemoSlug } from "@/lib/demo-plans";

export const metadata: Metadata = { title: "Demo plan" };
export const dynamic = "force-dynamic";

export default async function DemoPage({ params }: PageProps<"/demo/[slug]">) {
  const { slug } = await params;
  if (!DEMO_PLANS.some((d) => d.slug === slug)) notFound();
  const bundle = buildDemo(slug as DemoSlug);
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <PlanWorkspace initial={bundle} userId={null} flags={{ demo: true, searchConfigured: false, interpretation: "deterministic", emailConfigured: false }} />
      </main>
    </>
  );
}
