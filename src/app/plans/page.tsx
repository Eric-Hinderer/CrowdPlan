import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/crowdplan/app-header";
import { EmptyStateLink } from "@/components/crowdplan/empty-link";
import { getServerSupabase, getViewer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My plans" };

export default async function PlansPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/plans");
  const supabase = await getServerSupabase();
  const { data: plans } = await supabase
    .from("plans")
    .select("id, title, status, owner_id, updated_at, decide_by")
    .order("updated_at", { ascending: false })
    .limit(100);
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-end justify-between gap-3">
          <h1 className="t-title">Your plans</h1>
          <Link href="/new" className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-brand-ink">
            New plan
          </Link>
        </div>
        {plans?.length ? (
          <ul className="mt-6 divide-y divide-rule rounded-2xl border border-rule bg-surface">
            {plans.map((p) => (
              <li key={p.id}>
                <Link href={`/plan/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-surface-2">
                  <span>
                    <span className="block font-semibold">{p.title}</span>
                    <span className="text-sm text-ink-3">
                      {p.owner_id === viewer.userId ? "You're organizing" : "You're invited"}
                      {p.decide_by ? ` · decide by ${new Date(p.decide_by).toLocaleDateString()}` : ""}
                    </span>
                  </span>
                  <span className={p.status === "finalized" ? "text-sm font-semibold text-resolved" : "text-sm text-ink-3"}>{p.status === "finalized" ? "Finalized" : "Planning"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6">
            <EmptyStateLink />
          </div>
        )}
      </main>
    </>
  );
}
