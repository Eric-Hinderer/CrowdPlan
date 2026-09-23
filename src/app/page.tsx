import Link from "next/link";
import { AppHeader } from "@/components/crowdplan/app-header";
import { PlanPrompt } from "@/components/crowdplan/plan-prompt";
import { StateStamp } from "@/components/crowdplan/stamps";
import { DEMO_PLANS } from "@/lib/demo-plans";
import { getServerSupabase, getViewer } from "@/lib/supabase/server";

export default async function Home() {
  const viewer = await getViewer();
  let plans: Array<{ id: string; title: string; status: string; updated_at: string }> = [];
  if (viewer) {
    const supabase = await getServerSupabase();
    const { data } = await supabase.from("plans").select("id, title, status, updated_at").order("updated_at", { ascending: false }).limit(6);
    plans = data ?? [];
  }
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 pt-10 pb-14 sm:pt-16">
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div>
              <h1 className="t-display max-w-[14ch]">What are you trying to plan?</h1>
              <p className="mt-4 max-w-[46ch] text-lg text-ink-2">
                Tell CrowdPlan what your group has already figured out. It works out the rest — who&apos;s free, what fits everyone, and what still needs a decision.
              </p>
              <div className="mt-8 max-w-2xl">
                <PlanPrompt />
              </div>
            </div>
            <BoardPreview />
          </div>
        </section>

        {plans.length ? (
          <section className="mx-auto w-full max-w-6xl px-4 pb-12" aria-labelledby="yours">
            <div className="flex items-baseline justify-between">
              <h2 id="yours" className="t-heading">
                Your plans
              </h2>
              <Link href="/plans" className="text-sm font-semibold text-brand">
                See all
              </Link>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <li key={p.id}>
                  <Link href={`/plan/${p.id}`} className="block rounded-2xl border border-rule bg-surface p-4 hover:border-ink-3">
                    <span className="block font-semibold">{p.title}</span>
                    <span className="text-sm text-ink-3">{p.status === "finalized" ? "Finalized" : "Planning"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-rule bg-surface/60" aria-labelledby="demos">
          <div className="mx-auto w-full max-w-6xl px-4 py-12">
            <h2 id="demos" className="t-heading">
              See it with sample plans
            </h2>
            <p className="mt-1 text-ink-2">Demo plans use made-up people and prices, clearly marked.</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DEMO_PLANS.map((d) => (
                <li key={d.slug}>
                  <Link href={`/demo/${d.slug}`} className="flex h-full flex-col rounded-2xl border border-rule bg-surface p-4 hover:border-ink-3" data-testid={`demo-${d.slug}`}>
                    <span className="text-xs font-semibold text-brand">Demo · {d.modeLabel}</span>
                    <span className="mt-1 font-bold">{d.headline}</span>
                    <span className="mt-1 text-sm text-ink-2">{d.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <footer className="border-t border-rule py-6 text-center text-xs text-ink-3">
        CrowdPlan never books, reserves or charges anything. <Link href="/privacy" className="underline">Privacy</Link>
      </footer>
    </>
  );
}

function BoardPreview() {
  const rows: Array<{ label: string; value: string; state: "LOCKED" | "CONSTRAINED" | "UNDECIDED"; note?: string; highlight?: boolean }> = [
    { label: "What", value: "Vala's Pumpkin Patch", state: "LOCKED" },
    { label: "When", value: "Sun 1:30 – 6:30 PM", state: "CONSTRAINED", note: "6 of 6 available", highlight: true },
    { label: "Who", value: "6 people", state: "LOCKED", note: "6 responded" },
    { label: "Budget", value: "Not needed", state: "UNDECIDED" },
  ];
  return (
    <figure className="relative mx-auto w-full max-w-md lg:mt-4" aria-label="Example plan board">
      <div className="rounded-[1.4rem] border-2 border-ink bg-surface shadow-[6px_6px_0_var(--ink)]">
        <ul className="divide-y divide-rule">
          {rows.map((r) => (
            <li key={r.label} className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div>
                <p className="text-[0.8rem] font-semibold text-ink-3">{r.label}</p>
                <p className="text-[1.1rem] font-bold">{r.highlight ? <span className="highlighter rounded px-1">{r.value}</span> : r.value}</p>
                {r.note ? <p className="text-sm text-ink-2">{r.note}</p> : null}
              </div>
              <StateStamp state={r.state} />
            </li>
          ))}
        </ul>
        <div className="border-t-2 border-ink px-4 py-3.5">
          <p className="text-[0.8rem] font-semibold text-ink-3">Consensus</p>
          <p className="text-[1.1rem] font-bold text-resolved">Strong alignment</p>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-sm text-ink-3">One board instead of 140 group-chat messages.</figcaption>
    </figure>
  );
}
