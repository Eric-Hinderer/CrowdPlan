import Link from "next/link";
import { getViewer } from "@/lib/supabase/server";
import { signOutAction } from "@/app/actions/auth";
import { Wordmark } from "./brand";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";

export async function AppHeader({ children }: { children?: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <header className="sticky top-0 z-30 border-b border-rule/70 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Wordmark />
          {children}
        </div>
        <nav className="flex items-center gap-1" aria-label="Account">
          <ThemeToggle />
          {viewer ? <NotificationBell userId={viewer.userId} /> : null}
          {viewer && !viewer.isGuest ? (
            <>
              <Link href="/plans" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink sm:block">
                My plans
              </Link>
              <Link href="/me" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                Account
              </Link>
              <form action={signOutAction}>
                <button className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">Sign out</button>
              </form>
            </>
          ) : viewer?.isGuest ? (
            <Link href="/me" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
              Save my answers
            </Link>
          ) : (
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-surface-2">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
