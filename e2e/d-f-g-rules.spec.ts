import { expect, test } from "@playwright/test";
import { addDays, addOption, answerQuestions, card, createPlan, inviteLink, joinAsGuest, newOrganizer, next, paintAvailability, signIn } from "./helpers";

/** Scenario D — "I can't go Sunday" asks for clarification instead of guessing. */
test("D: ambiguous input is clarified before it becomes a rule", async ({ browser }) => {
  const org = await newOrganizer("Dana");
  const ctx = await browser.newContext({ timezoneId: "America/Chicago" });
  const organizer = await ctx.newPage();
  await signIn(organizer, org.email, org.password);
  await createPlan(organizer, "Vala's sometime next weekend", { organizerName: "Dana" });
  const link = await inviteLink(organizer);
  const { page, context } = await joinAsGuest(browser, link, "Sam");

  await page.getByTestId("step-statement").click();
  await page.getByTestId("statement-input").fill("I can't go Sunday.");
  await page.getByTestId("statement-continue").click();
  const result = page.getByTestId("statement-result");
  await expect(result.getByTestId("needs-clarification")).toContainText("When you say you can't go Sunday, what do you mean?");
  await page.getByTestId("statement-confirm").click();

  // Stored as an open question — no rule is active yet.
  const clar = page.getByTestId("clarification");
  await expect(clar).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("your-part")).not.toContainText("Unavailable all day");
  await organizer.getByRole("tab", { name: "People" }).click();
  await expect(organizer.getByText("1 answer waiting on clarification — not applied yet.")).toBeVisible({ timeout: 20_000 });

  await clar.getByLabel("I'm unavailable for the whole day Sunday").check();
  await clar.getByRole("button", { name: "Confirm" }).click();
  const mine = page.getByTestId("your-part");
  await expect(mine.getByText("I'm unavailable for the whole day Sunday")).toBeVisible({ timeout: 20_000 });
  await expect(organizer.getByText("I'm unavailable for the whole day Sunday")).toBeVisible({ timeout: 20_000 });
  // Editable: the applied rule can be relaxed to a preference.
  await mine.getByRole("button", { name: "Must" }).click();
  await expect(mine.getByRole("button", { name: "Prefer" })).toBeVisible({ timeout: 20_000 });
  await context.close();
});

/** Scenario F — a candidate violating one participant's hard constraint is explained and unranked. */
test("F: infeasible candidate shows the person and the exact reason", async ({ browser }) => {
  const org = await newOrganizer("Frank");
  const ctx = await browser.newContext({ timezoneId: "America/Chicago" });
  const organizer = await ctx.newPage();
  await signIn(organizer, org.email, org.password);
  const fri = next(5);
  await createPlan(organizer, "Dinner Friday", { organizerName: "Frank" });
  const link = await inviteLink(organizer);
  const { page, context } = await joinAsGuest(browser, link, "Sarah");
  await answerQuestions(page, { max: 40 });
  await paintAvailability(organizer, [{ date: fri, from: "18:00", to: "22:00" }]);
  await paintAvailability(page, [{ date: fri, from: "18:00", to: "22:00" }]);

  await addOption(organizer, "Steakhouse 1882", 82);
  await addOption(organizer, "Pizza Shoppe", 20);
  const steak = card(organizer, "Steakhouse 1882");
  await expect(steak).toHaveAttribute("data-status", "INFEASIBLE");
  await expect(steak).toHaveAttribute("data-rank", "");
  await expect(steak.getByTestId("hard-violation")).toContainText("Sarah: $42 over maximum budget");
  await expect(organizer.getByTestId("group-infeasible")).toContainText("Steakhouse 1882");
  const pizza = card(organizer, "Pizza Shoppe");
  await expect(pizza).toHaveAttribute("data-status", "FEASIBLE");
  await expect(pizza).toHaveAttribute("data-rank", "1");
  // The guest sees the same explanation.
  await page.getByRole("tab", { name: "Options" }).click();
  await expect(card(page, "Steakhouse 1882").getByTestId("hard-violation")).toContainText("Sarah: $42 over maximum budget");
  // Constraint matrix marks the blocked cell.
  await organizer.getByRole("tab", { name: "People" }).click();
  await expect(organizer.getByRole("button", { name: "Sarah and Steakhouse 1882: blocked" })).toBeVisible();
  await context.close();
});

/** Scenario G — Make This Work finds a specific fix, and reports honestly when there is none. */
test("G: Make This Work proposes 8:30 for a timing clash and reports no-fix for a price clash", async ({ browser }) => {
  const org = await newOrganizer("Gwen");
  const ctx = await browser.newContext({ timezoneId: "America/Chicago" });
  const organizer = await ctx.newPage();
  await signIn(organizer, org.email, org.password);
  const sat = next(6);
  await createPlan(organizer, "Escape room Saturday at 8pm", { organizerName: "Gwen" });
  await expect(organizer.getByTestId("board-row-time")).toHaveAttribute("data-state", "LOCKED");
  const link = await inviteLink(organizer);
  const { page, context } = await joinAsGuest(browser, link, "Jake");
  await page.getByTestId("step-statement").click();
  await page.getByTestId("statement-input").fill("I won't get there until 8:15, and I can't spend more than $40.");
  await page.getByTestId("statement-continue").click();
  await expect(page.getByTestId("statement-result")).toContainText("Can't start before 8:15 PM");
  await page.getByTestId("statement-confirm").click();
  await expect(page.getByTestId("your-part")).toContainText("Can't start before 8:15 PM", { timeout: 20_000 });
  await paintAvailability(organizer, [{ date: sat, from: "18:00", to: "23:30" }]);
  await paintAvailability(page, [{ date: sat, from: "18:00", to: "23:30" }]);

  await addOption(organizer, "Escape room: The Vault", 30);
  const room = card(organizer, "Escape room: The Vault");
  await expect(room).toHaveAttribute("data-status", "INFEASIBLE");
  await expect(room.getByTestId("hard-violation")).toContainText("Jake: Can't start before 8:15 PM; starts 8 PM");
  await room.getByTestId("make-this-work").click();
  await expect(room.getByTestId("repair-panel")).toContainText("Jake: Can't start before 8:15 PM");
  const proposal = room.getByTestId("proposal").first();
  await expect(proposal).toContainText("Would everyone be okay starting at 8:30 PM?", { timeout: 20_000 });
  // Guests see the same focused question and can answer it.
  await page.getByRole("tab", { name: "Options" }).click();
  await card(page, "Escape room: The Vault").getByTestId("proposal").first().getByRole("button", { name: "Works for me" }).click();
  await expect(proposal).toContainText("1 of 2 said yes", { timeout: 20_000 });
  await proposal.getByTestId("apply-proposal").click();
  await expect(organizer.getByTestId("board-row-time")).toContainText("8:30 PM", { timeout: 20_000 });
  await expect(room).toHaveAttribute("data-status", "FEASIBLE", { timeout: 20_000 });

  // No-fix case: the price itself breaks Jake's hard limit.
  await addOption(organizer, "Rooftop tasting menu", 95);
  const tasting = card(organizer, "Rooftop tasting menu");
  await expect(tasting).toHaveAttribute("data-status", "INFEASIBLE");
  await tasting.getByTestId("make-this-work").click();
  await expect(tasting.getByTestId("no-fix")).toContainText("No change CrowdPlan can make fixes this");
  await expect(tasting.getByTestId("no-fix")).toContainText("over maximum budget");
  await context.close();
  expect(addDays(sat, 0)).toBe(sat);
});
