import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addDays, card, createPlan, inviteLink, joinAsGuest, newOrganizer, next, paintAvailability, signIn } from "./helpers";

/**
 * Scenario A — fixed place + four guests with different availability; strongest overlap.
 * Scenario E — a guest reacts while the organizer watches; organizer updates via Realtime.
 * Scenario I — organizer finalizes; every guest sees the same final plan; guests can't finalize.
 */
test.describe.serial("Scenario A/E/I — Vala's next weekend", () => {
  let organizer: Page;
  const guests: Array<{ name: string; page: Page; context: BrowserContext }> = [];
  const sat = addDays(next(6, true), 7);
  const sun = addDays(sat, 1);

  test.afterAll(async () => {
    for (const g of guests) await g.context.close();
  });

  test("A: organizer creates a fixed-place plan and four guests join without accounts", async ({ browser }) => {
    const org = await newOrganizer("Eric");
    const ctx = await browser.newContext({ timezoneId: "America/Chicago", locale: "en-US" });
    organizer = await ctx.newPage();
    await signIn(organizer, org.email, org.password);

    await createPlan(organizer, "Vala's sometime next weekend", {
      organizerName: "Eric",
      location: "Omaha, NE",
      mutate: async (p) => {
        // Fixed place is locked; dates constrained to next weekend; time undecided.
        await expect(p.locator("#dim-place")).toHaveValue("Vala's");
      },
    });
    const board = organizer.getByTestId("resolution-board");
    await expect(board.getByTestId("board-row-place")).toHaveAttribute("data-state", "LOCKED");
    await expect(board.getByTestId("board-row-place")).toContainText("Vala's");
    await expect(board.getByTestId("board-row-date")).toHaveAttribute("data-state", "CONSTRAINED");
    await expect(board.getByTestId("board-row-time")).toHaveAttribute("data-state", "UNDECIDED");

    const link = await inviteLink(organizer);
    expect(link).toMatch(/\/p\/[A-Z2-9]{6}#t=[A-Za-z0-9_-]{40,}/);
    for (const name of ["Jake", "Sarah", "Priya", "Marcus"]) {
      const g = await joinAsGuest(browser, link, name);
      guests.push({ name, ...g });
    }
    // Joins arrive on the organizer's board through realtime.
    await expect(organizer.getByTestId("board-row-participants")).toContainText("5 participants", { timeout: 20_000 });
  });

  test("A: everyone marks different availability and the strongest overlap is correct", async () => {
    await paintAvailability(organizer, [{ date: sun, from: "12:00", to: "20:00" }]);
    const byName = Object.fromEntries(guests.map((g) => [g.name, g.page]));
    await paintAvailability(byName.Jake, [{ date: sun, from: "13:00", to: "19:00" }]);
    await paintAvailability(byName.Sarah, [{ date: sun, from: "13:30", to: "19:00", level: "Ideal" }]);
    await paintAvailability(byName.Priya, [{ date: sun, from: "11:00", to: "17:30" }]);
    await paintAvailability(byName.Marcus, [
      { date: sat, from: "10:00", to: "14:00" },
      { date: sun, from: "13:00", to: "18:00" },
    ]);

    // Organizer's group view (updated via realtime) and a guest's view must agree.
    for (const page of [organizer, byName.Sarah]) {
      await page.getByRole("tab", { name: "When" }).click();
      await expect(page.getByTestId("best-overlap")).toContainText("1:30 PM–5:30 PM", { timeout: 20_000 });
      await expect(page.getByTestId("best-overlap")).toContainText("5/5 available");
      await expect(page.getByTestId("overlap-timeline")).toContainText("1:30 PM–5:30 PM");
    }
    const timeRow = organizer.getByTestId("board-row-time");
    await expect(timeRow).toContainText("5/5 available");
    await expect(timeRow).toHaveAttribute("data-progress", "RESOLVED");
    // The fixed place is retained and ranked; no unsolicited alternatives were added.
    await organizer.getByRole("tab", { name: "Options" }).click();
    await expect(organizer.getByTestId("candidate-card")).toHaveCount(1);
    await expect(card(organizer, "Vala's")).toHaveAttribute("data-status", /FEASIBLE|UNVERIFIED/);
    await expect(organizer.getByTestId("run-search")).toHaveCount(0);
  });

  test("E: a guest's reaction appears on the organizer's screen without a refresh", async () => {
    const jake = guests.find((g) => g.name === "Jake")!.page;
    await jake.getByRole("tab", { name: "Options" }).click();
    await organizer.getByRole("tab", { name: "Options" }).click();
    const before = await organizer.getByTestId("consensus").getAttribute("data-state");
    await card(jake, "Vala's").getByTestId("react-love").click();
    await expect(card(organizer, "Vala's").getByTestId("reaction-summary")).toContainText("Jake: Love it", { timeout: 15_000 });
    await expect(organizer.getByTestId("consensus")).toContainText("1/5 reacted");
    for (const g of guests.filter((x) => x.name !== "Jake")) {
      await g.page.getByRole("tab", { name: "Options" }).click();
      await card(g.page, "Vala's").getByTestId("react-works").click();
    }
    await card(organizer, "Vala's").getByTestId("react-love").click();
    await expect(organizer.getByTestId("consensus")).toHaveAttribute("data-state", "strong", { timeout: 20_000 });
    expect(before).not.toBe("strong");
  });

  test("I: organizer finalizes and every guest sees the same final plan", async () => {
    for (const g of guests) await expect(card(g.page, "Vala's").getByTestId("finalize-open")).toHaveCount(0);
    await card(organizer, "Vala's").getByTestId("finalize-open").click();
    await organizer.getByLabel("Notes for everyone (optional)").fill("Meet at the main gate.");
    await organizer.getByTestId("finalize-confirm").click();
    await expect(organizer.getByTestId("final-plan")).toBeVisible({ timeout: 20_000 });
    const headline = (await organizer.getByTestId("final-title").textContent())!.trim();
    for (const g of guests) {
      await expect(g.page.getByTestId("final-plan")).toBeVisible({ timeout: 20_000 });
      await expect(g.page.getByTestId("final-title")).toHaveText(headline);
      await expect(g.page.getByText("Meet at the main gate.")).toBeVisible();
      await expect(g.page.getByText("1:30 PM")).toBeVisible();
      await expect(g.page.getByRole("button", { name: "Reopen planning" })).toHaveCount(0);
    }
    await expect(organizer.getByText(/doesn.t book or pay for anything/)).toBeVisible();
  });
});
