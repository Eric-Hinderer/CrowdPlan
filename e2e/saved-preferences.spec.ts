import { expect, test } from "@playwright/test";
import { createPlan, newOrganizer, signIn } from "./helpers";

/**
 * CP-28: stable preferences saved on /me are offered — never silently applied —
 * when the account holder answers a new plan, and stay editable before saving.
 */
test("saved preferences prefill a new dinner plan after the person confirms", async ({ page }) => {
  const org = await newOrganizer("Priya");
  await signIn(page, org.email, org.password, "/me");

  await page.getByLabel("Home area").fill("Midtown");
  await page.getByLabel("Usual dinner budget ($ per person)").fill("35");
  await page.getByLabel("Favorite cuisines").fill("Thai, Sushi");
  await page.getByLabel("Dietary restrictions").fill("vegetarian, no cilantro");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 20_000 });

  await createPlan(page, "Dinner Thursday at 7pm", {
    organizerName: "Priya",
    location: "Omaha, NE",
  });

  await page.getByTestId("step-questions").click();
  const dialog = page.getByRole("dialog");
  const offer = dialog.getByTestId("saved-prefs");
  await expect(offer).toContainText("from Midtown");
  await expect(offer).toContainText("usually about $35");
  // Nothing is applied until the person asks for it.
  await expect(dialog.getByLabel("Prefer to spend")).toHaveValue("");
  await expect(dialog.getByRole("group", { name: "Dietary needs" }).getByRole("button", { name: "Vegetarian" })).toHaveAttribute("aria-pressed", "false");

  await offer.getByRole("button", { name: "Fill these in" }).click();
  await expect(offer).toBeHidden();
  await expect(dialog.getByLabel("Where are you coming from?")).toHaveValue("Midtown");
  await expect(dialog.getByLabel("Prefer to spend")).toHaveValue("35");
  await expect(dialog.getByRole("group", { name: "Dietary needs" }).getByRole("button", { name: "Vegetarian" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("group", { name: "Preferred cuisines" }).getByRole("button", { name: "Thai" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("group", { name: "Preferred cuisines" }).getByRole("button", { name: "Sushi" })).toHaveAttribute("aria-pressed", "true");
  // Items without a matching chip are kept visibly in the notes, not dropped.
  await expect(dialog.getByLabel("Anything else we should know?")).toHaveValue(/Dietary: no cilantro/);

  // Still editable before saving.
  await dialog.getByLabel("Prefer to spend").fill("30");
  await dialog.getByTestId("save-questions").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // Reopening shows the saved answers, without offering the prefill again.
  await page.getByTestId("step-questions").click();
  await expect(page.getByRole("dialog").getByLabel("Prefer to spend")).toHaveValue("30");
  await expect(page.getByRole("dialog").getByTestId("saved-prefs")).toHaveCount(0);
});
