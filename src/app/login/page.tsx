import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/crowdplan/app-header";
import { getViewer } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  const viewer = await getViewer();
  if (viewer && !viewer.isGuest) redirect(next);
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
        <h1 className="t-title">Organize with CrowdPlan</h1>
        <p className="mt-2 text-ink-2">
          Organizers use a free account. Friends you invite don&apos;t need one — they just open your link.
        </p>
        {sp.error === "link" ? (
          <p role="alert" className="mt-4 rounded-xl border border-blocked/30 bg-blocked/8 px-3.5 py-2.5 text-sm text-blocked">
            That sign-in link expired or was already used. Request a new one below.
          </p>
        ) : null}
        <div className="mt-8">
          <LoginForm next={next} googleEnabled={process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"} />
        </div>
      </main>
    </>
  );
}
