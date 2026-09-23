"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const EXAMPLES = [
  "Dinner at Firebirds Friday",
  "Vala's sometime next weekend",
  "Something fun Saturday night",
  "Vegas in October, 3-4 nights, under $800 each",
  "Dinner Friday, Italian, somewhere out west, under $40",
  "Which of these three places should we choose?",
];

export function PlanPrompt({ autoFocus, initial = "" }: { autoFocus?: boolean; initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const submit = (text: string) => {
    const q = text.trim();
    if (!q) return;
    router.push(`/new?q=${encodeURIComponent(q)}`);
  };
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="group relative rounded-[1.4rem] border-2 border-ink bg-surface p-2 shadow-[4px_4px_0_var(--ink)] transition focus-within:shadow-[6px_6px_0_var(--brand)] focus-within:border-brand"
      >
        <label htmlFor="plan-input" className="sr-only">
          What are you trying to plan?
        </label>
        <textarea
          id="plan-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(value);
            }
          }}
          autoFocus={autoFocus}
          rows={2}
          maxLength={600}
          placeholder="Dinner Friday, Italian, somewhere out west…"
          className="block w-full resize-none bg-transparent px-3 pt-2 pb-12 text-lg leading-snug text-ink outline-none placeholder:text-ink-3 sm:text-xl"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="absolute right-3 bottom-3 grid size-10 place-items-center rounded-xl bg-brand text-brand-ink transition disabled:opacity-30"
          aria-label="Start planning"
        >
          <ArrowUp className="size-5" aria-hidden="true" />
        </button>
      </form>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              onClick={() => setValue(ex)}
              className="rounded-full border border-rule bg-surface/60 px-3 py-1.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              {ex}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
