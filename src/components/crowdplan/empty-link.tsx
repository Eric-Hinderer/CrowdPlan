import Link from "next/link";

export function EmptyStateLink() {
  return (
    <div className="rounded-2xl border border-dashed border-rule px-5 py-10 text-center">
      <p className="font-semibold">No plans yet</p>
      <p className="mx-auto mt-1 max-w-sm text-ink-2">Start with what your group already knows — a place, a day, a budget.</p>
      <Link href="/new" className="mt-4 inline-block rounded-xl bg-brand px-4 py-2.5 font-semibold text-brand-ink">
        Start a plan
      </Link>
    </div>
  );
}
