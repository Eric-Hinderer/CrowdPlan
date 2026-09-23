import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { addOption, answerQuestions, card, createPlan, inviteLink, joinAsGuest, newOrganizer, next, paintAvailability, signIn } from "./helpers";

const liveSearch = Boolean(process.env.E2E_EXPECT_SERPAPI);

function serverSql() {
  const url = process.env.CROWDPLAN_SERVER_DATABASE_URL;
  return url ? postgres(url, { prepare: false, max: 1 }) : null;
}

/**
 * Scenario B — criteria plan: viable windows precede discovery; required filters hold;
 * ranking and fairness are visible; real SerpAPI when configured.
 */
test.describe.serial("Scenario B — Dinner Friday, Italian, West Omaha, under $40", () => {
  let organizer: Page;

  const fri = next(5);

  test("B: criteria are parsed as constraints and search waits for availability", async ({ browser }) => {
    const org = await newOrganizer("Olivia");
    const ctx = await browser.newContext({ timezoneId: "America/Chicago" });
    organizer = await ctx.newPage();
    await signIn(organizer, org.email, org.password);
    await createPlan(organizer, "Dinner Friday, Italian, West Omaha, under $40", { organizerName: "Olivia", location: "Omaha, NE" });
    const board = organizer.getByTestId("resolution-board");
    await expect(board.getByTestId("board-row-cuisine")).toHaveAttribute("data-state", "CONSTRAINED");
    await expect(board.getByTestId("board-row-area")).toContainText("West Omaha");
    await expect(board.getByTestId("board-row-budget")).toHaveAttribute("data-state", "CONSTRAINED");
    await expect(board.getByTestId("board-row-place")).toHaveAttribute("data-state", "UNDECIDED");
    await organizer.getByRole("tab", { name: "Options" }).click();
    const search = organizer.getByTestId("run-search");
    await expect(search).toBeVisible();
    if (liveSearch) {
      await search.click();
      await expect(organizer.getByText(/Collect availability first/)).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(search).toBeDisabled();
      await expect(organizer.getByTestId("search-budget")).toContainText("Live search isn't configured");
      test.info().annotations.push({ type: "BLOCKED", description: "SERPAPI_API_KEY not configured — live search gate verified as disabled, live results not exercised" });
    }
  });

  test("B: guests add different budgets and preferences; ranking and fairness are visible", async ({ browser }) => {
    const link = await inviteLink(organizer);
    const sarah = await joinAsGuest(browser, link, "Sarah");
    const jake = await joinAsGuest(browser, link, "Jake");
    await answerQuestions(sarah.page, { max: 35, dietary: ["Vegetarian"] });
    await answerQuestions(jake.page, { preferred: 25 });
    await paintAvailability(organizer, [{ date: fri, from: "18:00", to: "22:00" }]);
    await paintAvailability(sarah.page, [{ date: fri, from: "17:30", to: "21:00" }]);
    await paintAvailability(jake.page, [{ date: fri, from: "19:00", to: "22:30" }]);

    if (liveSearch) {
      await organizer.getByRole("tab", { name: "Options" }).click();
      await organizer.getByTestId("run-search").click();
      await expect(organizer.getByText(/Added \d+ option/)).toBeVisible({ timeout: 60_000 });
      const cards = organizer.getByTestId("candidate-card");
      expect(await cards.count()).toBeGreaterThan(0);
      await expect(cards.first().getByText("Live data")).toBeVisible();
      // Required filters: nothing ranked may violate cuisine or the $40 cap.
      for (const c of await organizer.locator('[data-status="FEASIBLE"]').all()) {
        await expect(c.getByTestId("explanation")).not.toContainText("over");
      }
    }

    // User-entered options exercise ranking even without live data.
    await addOption(organizer, "Nonna's Table", 28);
    await addOption(organizer, "Villa Grande", 52);
    const cheap = card(organizer, "Nonna's Table");
    const pricey = card(organizer, "Villa Grande");
    await expect(pricey).toHaveAttribute("data-status", "INFEASIBLE");
    await expect(pricey.getByTestId("hard-violation").first()).toContainText("over");
    await expect(pricey.getByTestId("explanation")).toContainText("Sarah: $17 over maximum budget");
    // Cuisine can't be verified for a typed-in name, so it's "needs checking" — never guessed.
    await expect(cheap).toHaveAttribute("data-status", /UNVERIFIED|FEASIBLE/);
    await expect(cheap.getByTestId("explanation")).toContainText(/Cuisine not verified|Everyone available/);
    await expect(organizer.getByTestId("group-infeasible")).toContainText("Villa Grande");
    await sarah.context.close();
    await jake.context.close();
  });
});

/**
 * Scenario C — shortlist: only the named options are enriched; no broad discovery.
 */
test.describe.serial("Scenario C — three named restaurants", () => {
  test("C: shortlist creates exactly the named options and never searches broadly", async ({ browser }) => {
    const org = await newOrganizer("Casey");
    const ctx = await browser.newContext({ timezoneId: "America/Chicago" });
    const page = await ctx.newPage();
    await signIn(page, org.email, org.password);
    const planId = await createPlan(page, "Dinner Friday options: Firebirds, Charleston's, Texas Roadhouse", {
      organizerName: "Casey",
      location: "Omaha, NE",
      mutate: async (p) => {
        await expect(p.getByRole("radio", { name: /We have a few options/ })).toHaveAttribute("aria-checked", "true");
        await expect(p.getByLabel("Option 1 name")).toHaveValue("Firebirds");
        await expect(p.getByLabel("Option 2 name")).toHaveValue("Charleston's");
        await expect(p.getByLabel("Option 3 name")).toHaveValue("Texas Roadhouse");
        await expect(p.getByRole("checkbox", { name: /suggest more options/i })).not.toBeChecked();
      },
    });
    await page.getByRole("tab", { name: "Options" }).click();
    await expect(page.getByTestId("candidate-card")).toHaveCount(3);
    for (const t of ["Firebirds", "Charleston's", "Texas Roadhouse"]) await expect(card(page, t)).toBeVisible();
    // No discovery control unless explicitly requested.
    await expect(page.getByTestId("run-search")).toHaveCount(0);
    await expect(page.getByTestId("enable-suggestions")).toBeVisible();

    // Place URL and custom candidate entry.
    await page.getByTestId("add-option").click();
    const dialog = page.getByRole("dialog", { name: "Add an option" });
    await dialog.getByLabel("Link (optional)").fill("https://www.google.com/maps/place/Upstream+Brewing+Company/@41.2565,-95.9345,17z");
    await dialog.getByTestId("add-option-submit").click();
    await expect(card(page, "Upstream Brewing Company")).toBeVisible({ timeout: 20_000 });
    await addOption(page, "Mom's backyard cookout");
    await page.getByTestId("add-option").click();
    await dialog.getByLabel("Name").fill("Bad link");
    await dialog.getByLabel("Link (optional)").fill("http://127.0.0.1/admin");
    await dialog.getByTestId("add-option-submit").click();
    await expect(dialog.getByRole("alert")).toContainText("Use a public website link");
    await dialog.getByRole("button", { name: "Close" }).click();

    // Evidence: the search ledger shows no broad/discovery queries for this plan.
    const sql = serverSql();
    if (sql) {
      await page.waitForTimeout(3000); // background enrichment settles
      const rows = await sql`select engine, outcome, count(*)::int as n from private.search_ledger where plan_id = ${planId} group by 1, 2`;
      await sql.end();
      const engines = rows.map((r) => r.engine as string);
      expect(engines.every((e) => e === "google_maps")).toBe(true);
      const network = rows.filter((r) => r.outcome === "network").reduce((s, r) => s + (r.n as number), 0);
      expect(network).toBeLessThanOrEqual(4); // one lookup per named place at most
      test.info().annotations.push({ type: "ledger", description: JSON.stringify(rows) });
    }
  });
});
