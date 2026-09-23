import { expect, test, type Page } from "@playwright/test";
import { createPlan, inviteLink, newOrganizer, next, signIn } from "./helpers";

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page must not scroll horizontally").toBeLessThanOrEqual(client + 1);
}

/** Core mobile flow at 390px: create → invite → guest joins from a phone → responds → reacts. */
test("mobile: organizer and guest complete the core flow at 390px", async ({ page, browser }) => {
  const org = await newOrganizer("Mia");
  await signIn(page, org.email, org.password);
  await page.goto("/");
  await noHorizontalOverflow(page);
  const fri = next(5);
  await createPlan(page, "Dinner Friday", { organizerName: "Mia" });
  await noHorizontalOverflow(page);
  const link = await inviteLink(page);

  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Chicago" });
  const guest = await guestCtx.newPage();
  const url = new URL(link);
  await guest.goto(`${url.pathname}${url.hash}`);
  await noHorizontalOverflow(guest);
  await guest.getByLabel("Your name").fill("Leo");
  await guest.getByTestId("join-submit").click();
  await guest.waitForURL(/\/plan\//, { waitUntil: "commit" });
  await expect(guest.getByTestId("your-part")).toBeVisible();
  await noHorizontalOverflow(guest);

  // Availability from the phone: sheet editor, one day at a time, tap to mark.
  await guest.getByTestId("step-availability").click();
  const sheet = guest.getByRole("dialog", { name: "Your availability" });
  await sheet.getByRole("tab", { name: new RegExp(new Date(`${fri}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })) }).click();
  for (const m of [1080, 1110, 1140, 1170]) await sheet.getByTestId(`cell-${fri}-${m}`).tap();
  await sheet.getByTestId("save-availability").tap();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
  await expect(guest.getByTestId("step-availability")).toContainText("Shared");

  // Tap targets on the reaction bar are at least 36px tall.
  await page.getByRole("tab", { name: "Options" }).click();
  await page.getByTestId("add-option").click();
  const dialog = page.getByRole("dialog", { name: "Add an option" });
  await dialog.getByLabel("Name").fill("Taqueria Olé");
  await dialog.getByTestId("add-option-submit").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await guest.getByRole("tab", { name: "Options" }).click();
  const love = guest.getByTestId("react-love").first();
  await expect(love).toBeVisible({ timeout: 20_000 });
  const box = await love.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(34);
  await love.tap();
  await expect(page.getByTestId("reaction-summary").first()).toContainText("Leo: Love it", { timeout: 20_000 });
  await noHorizontalOverflow(page);
  await noHorizontalOverflow(guest);
  await guestCtx.close();
});
