import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test.local", override: true, quiet: true });

export const TEST_DOMAIN = "crowdplan-e2e.example.com";
const TZ = "America/Chicago";

export function runId(): string {
  try {
    return readFileSync("test-results/run-id.txt", "utf8").trim();
  } catch {
    return process.env.E2E_RUN_ID ?? "e2e-local";
  }
}

export async function adminCall(body: Record<string, unknown>) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cp-admin`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": process.env.E2E_ADMIN_SECRET! },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`cp-admin ${String(body.action)}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

export async function newOrganizer(label: string) {
  const email = `${label.toLowerCase()}.${runId()}.${randomBytes(2).toString("hex")}@${TEST_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  await adminCall({ action: "create_user", email, password, displayName: label });
  return { email, password, name: label };
}

/** Real password sign-in through the app's login form. */
export async function signIn(page: Page, email: string, password: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000, waitUntil: "commit" });
}

/** Creates a plan through the natural-language flow and returns its id. */
export async function createPlan(page: Page, text: string, opts: { organizerName: string; location?: string; mutate?: (p: Page) => Promise<void> }) {
  await page.goto(`/new?q=${encodeURIComponent(text)}`);
  await expect(page.getByRole("heading", { name: "Here's what I understood" })).toBeVisible({ timeout: 30_000 });
  if (opts.mutate) await opts.mutate(page);
  const nameInput = page.getByLabel("Your name");
  await nameInput.fill(opts.organizerName);
  if (opts.location) await page.getByLabel("Where is your group based?").fill(opts.location);
  await page.getByRole("button", { name: "Create plan and invite friends" }).click();
  await page.waitForURL(/\/plan\/[0-9a-f-]{36}/, { timeout: 30_000, waitUntil: "commit" });
  await expect(page.getByTestId("resolution-board")).toBeVisible({ timeout: 30_000 });
  const id = /\/plan\/([0-9a-f-]{36})/.exec(page.url())![1];
  return id;
}

export async function inviteLink(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog", { name: "Invite your group" });
  if (!(await dialog.isVisible().catch(() => false))) await page.getByTestId("invite-button").click();
  const link = page.getByTestId("invite-link");
  await expect(link).toContainText("/p/", { timeout: 20_000 });
  const url = (await link.textContent())!.trim();
  await dialog.getByRole("button", { name: "Close" }).click();
  return url;
}

/** Guest joins in an isolated browser context without any account. */
export async function joinAsGuest(browser: Browser, link: string, name: string, contextOptions: Parameters<Browser["newContext"]>[0] = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ timezoneId: TZ, locale: "en-US", ...contextOptions });
  const page = await context.newPage();
  const url = new URL(link);
  await page.goto(`${url.pathname}${url.hash}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByTestId("join-submit").click();
  await page.waitForURL(/\/plan\/[0-9a-f-]{36}/, { timeout: 30_000, waitUntil: "commit" });
  await expect(page.getByTestId("plan-title")).toBeVisible();
  return { context, page };
}

/** Local date (yyyy-MM-dd) helpers in the plan timezone. */
export function localToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
/** Upcoming day-of-week (0=Sun) strictly after today when today matches. */
export function next(dow: number, includeToday = false): string {
  let d = localToday();
  if (!includeToday || weekday(d) !== dow) {
    d = addDays(d, 1);
    while (weekday(d) !== dow) d = addDays(d, 1);
  }
  return d;
}

/** Paint availability in the "When" tab editor: [date, "HH:mm", "HH:mm"] half-hour cells. */
export async function paintAvailability(page: Page, blocks: Array<{ date: string; from: string; to: string; level?: "Ideal" | "Works" | "Not available" }>) {
  await page.getByRole("tab", { name: "When" }).click();
  const editor = page.getByTestId("availability-editor");
  await expect(editor).toBeVisible();
  for (const b of blocks) {
    await editor.getByRole("radio", { name: b.level ?? "Works", exact: true }).click();
    const [fh, fm] = b.from.split(":").map(Number);
    const [th, tm] = b.to.split(":").map(Number);
    for (let m = fh * 60 + fm; m < th * 60 + tm; m += 30) {
      await editor.getByTestId(`cell-${b.date}-${m}`).click();
    }
  }
  await editor.getByTestId("save-availability").click();
  await expect(editor.getByText("Saved — the group sees it now.")).toBeVisible({ timeout: 20_000 });
}

export async function answerQuestions(page: Page, answers: { max?: number; preferred?: number; dietary?: string[]; travelMinutes?: number }) {
  await page.getByTestId("step-questions").click();
  const dialog = page.getByRole("dialog");
  if (answers.preferred) await dialog.getByLabel(/Prefer to spend|Preferred total/).fill(String(answers.preferred));
  if (answers.max) await dialog.getByLabel(/Can't spend more than|Absolute max/).fill(String(answers.max));
  for (const d of answers.dietary ?? []) await dialog.getByRole("button", { name: d, exact: true }).first().click();
  if (answers.travelMinutes) await dialog.getByLabel("Longest you'd drive (minutes)").fill(String(answers.travelMinutes));
  await dialog.getByTestId("save-questions").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

export async function addOption(page: Page, title: string, price?: number, url?: string) {
  await page.getByRole("tab", { name: /Options|Trips/ }).click();
  await page.getByTestId("add-option").click();
  const dialog = page.getByRole("dialog", { name: "Add an option" });
  await dialog.getByLabel("Name").fill(title);
  if (url) await dialog.getByLabel("Link (optional)").fill(url);
  if (price) await dialog.getByLabel("Price per person, if you know it").fill(String(price));
  await dialog.getByTestId("add-option-submit").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(`[data-candidate-title="${title}"]`)).toBeVisible({ timeout: 20_000 });
}

export function card(page: Page, title: string) {
  return page.locator(`[data-candidate-title="${title}"]`);
}
