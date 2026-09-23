import { expect, test } from "@playwright/test";
import { createPlan, inviteLink, joinAsGuest, newOrganizer, signIn } from "./helpers";

const liveSearch = Boolean(process.env.E2E_EXPECT_SERPAPI);

/**
 * Scenario H — travel plan with flights and hotels. Live provider proof requires
 * SERPAPI_API_KEY; without it the test records an explicit BLOCKED annotation and
 * only verifies labeling on the clearly-marked demo plan (never as live evidence).
 */
test("H: travel costs are per traveler, labeled by source, with timestamps", async ({ browser, page }) => {
  // Labeling contract on the demo (demo data is never presented as live).
  await page.goto("/demo/vegas");
  const trip = page.getByTestId("candidate-card").first();
  await expect(page.getByText(/Demo plan — sample people/)).toBeVisible();
  await expect(trip.getByTestId("travel-breakdown")).toBeVisible();
  await expect(trip.getByText("Demo data").first()).toBeVisible();
  await expect(trip.getByText("Estimate").first()).toBeVisible();
  await expect(trip.getByTestId("traveler-total")).toHaveCount(4);
  await expect(trip.getByText("incl. estimates").first()).toBeVisible();
  await expect(trip.getByText("Live data")).toHaveCount(0);

  if (!liveSearch) {
    test.info().annotations.push({ type: "BLOCKED", description: "SERPAPI_API_KEY not configured — live Google Flights/Hotels requests not exercised" });
    return;
  }

  const org = await newOrganizer("Tara");
  const ctx = await browser.newContext({ timezoneId: "America/Chicago" });
  const organizer = await ctx.newPage();
  await signIn(organizer, org.email, org.password);
  await createPlan(organizer, "Vegas in October, 3-4 nights, under $800 each", { organizerName: "Tara", location: "Omaha, NE" });
  const link = await inviteLink(organizer);
  const guest = await joinAsGuest(browser, link, "Sarah");
  // Both mark the same October days (day mode for trips).
  const year = new Date().getFullYear() + (new Date().getMonth() > 9 ? 1 : 0);
  for (const p of [organizer, guest.page]) {
    await p.getByRole("tab", { name: "When" }).click();
    for (let d = 16; d <= 19; d++) await p.getByTestId(`day-${year}-10-${String(d).padStart(2, "0")}`).click();
    await p.getByTestId("save-availability").click();
    await expect(p.getByText("Saved — the group sees it now.")).toBeVisible({ timeout: 20_000 });
  }
  await organizer.getByRole("tab", { name: "Trips" }).click();
  await organizer.getByTestId("run-search").click();
  await expect(organizer.getByTestId("travel-breakdown").first()).toBeVisible({ timeout: 90_000 });
  const card = organizer.getByTestId("candidate-card").first();
  await expect(card.getByText("Live data").first()).toBeVisible();
  await expect(card.getByText(/min ago|just now|hr ago/).first()).toBeVisible(); // fetchedAt visible
  await expect(card.getByText("Estimate").first()).toBeVisible(); // local costs labeled estimate
  await expect(card.getByTestId("traveler-total")).toHaveCount(2);
  await guest.context.close();
});
