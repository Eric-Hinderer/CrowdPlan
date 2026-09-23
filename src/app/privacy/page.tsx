import type { Metadata } from "next";
import { AppHeader } from "@/components/crowdplan/app-header";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-10 leading-relaxed">
        <h1 className="t-title">Privacy</h1>
        <p>Plans are private. Only the organizer and people who joined through the plan&apos;s invite link can see them. The invite code alone doesn&apos;t grant access — the link also carries a secret that never reaches our servers&apos; logs.</p>
        <p>Guests don&apos;t need an account. What you share (name, availability, preferences, requirements) is visible to the other people in that plan so everyone can see what works. Your starting location, if you choose to share it, is rounded before it&apos;s saved.</p>
        <p>To find places, flights and hotels, CrowdPlan sends search terms (like &ldquo;Italian restaurants in West Omaha&rdquo; or airport codes and dates) to a search provider. It never sends names or personal details.</p>
        <p>CrowdPlan never books, reserves or charges anything.</p>
      </main>
    </>
  );
}
