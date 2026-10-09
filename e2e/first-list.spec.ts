/**
 * The first thing a person does, in a real browser against the export that
 * deploys, less its Supabase project: meet the tour, make a list, write two
 * things on it in one line, take one, and find all of it after a reload. The
 * unit suite holds each part; this holds that they meet — the sqlite worker,
 * the policy the page runs under, the router and the screens.
 */

import { expect, test, type Page } from "@playwright/test";

/** What the page refused or threw: the policy's refusals and uncaught errors. */
async function watchFailures(page: Page): Promise<string[]> {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // A route reloaded is answered as Pages answers it: `404.html`, with a 404
    // Chromium logs. A missing script, picture or font still fails.
    const { url } = message.location();
    if (message.text().startsWith("Failed to load resource:") && /^\/gital\/[^.]*$/.test(new URL(url).pathname)) return;
    failures.push(message.text());
  });
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => console.error(`CSP ${event.violatedDirective} ${event.blockedURI}`)),
  );
  return failures;
}

test("a first list is made, written on, ticked and kept @cross-browser", async ({ page }) => {
  const failures = await watchFailures(page);
  await page.goto("/gital/");

  // A device with no lists is introduced to the app once, in a dialog a
  // screen reader announces by its title.
  await expect(page.getByRole("dialog", { name: "Her alışverişe bir liste" })).toBeVisible();
  await page.getByRole("button", { name: "Geç" }).click();

  await page.getByRole("button", { name: "Yeni Liste" }).first().click();
  await page.getByRole("dialog").getByRole("textbox").fill("Market");
  await page.getByRole("button", { name: "Oluştur" }).click();
  await page.getByRole("button", { name: /^Market,/ }).click();
  await expect(page.getByRole("heading", { name: "Market" })).toBeVisible();

  await page.getByRole("textbox", { name: "Listeye ürün ekle" }).fill("2 kg domates, süt");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Domates, 2 kg" })).toBeVisible();
  const milk = page.getByRole("checkbox", { name: "Süt" });
  await expect(milk).not.toBeChecked();
  await milk.click();
  await expect(milk).toBeChecked();

  // A sheet taller than the window stops short of its top edge, so its title
  // is there to pull it away by (the owner, 2026-09-30).
  await page.getByRole("button", { name: "Katalogdan seç" }).click();
  const catalogue = page.getByRole("dialog", { name: "Katalog" });
  const heading = catalogue.getByRole("heading", { name: "Katalog" });
  const resting = (await heading.boundingBox())!;
  expect(resting.y).toBeGreaterThan(24);
  // Scrolled deep into its body, the title is still where it stopped: it is
  // what pulls the sheet away (2026-10-09).
  await page.mouse.move(resting.x + 20, resting.y + 300);
  await page.mouse.wheel(0, 2000);
  await expect(catalogue.getByText("Süt", { exact: true }).first()).not.toBeInViewport();
  const title = (await heading.boundingBox())!;
  expect(Math.abs(title.y - resting.y)).toBeLessThan(2);
  await page.mouse.move(title.x + 20, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x + 20, title.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(catalogue).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Domates, 2 kg" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Süt" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Domates" })).not.toBeChecked();

  await page.goto("/gital/");
  await expect(page.getByRole("button", { name: /^Market,/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("what is already at home goes into the pantry by hand, and stays after a reload", async ({ page }) => {
  const failures = await watchFailures(page);
  await page.goto("/gital/pantry");
  const tour = page.getByRole("button", { name: "Geç" });
  if (await tour.isVisible().catch(() => false)) await tour.click();

  await page.getByRole("textbox", { name: "Kilere ürün ekle" }).fill("2 kg un, tuz");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Un, 2 kg" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tuz, 1 adet" })).toBeVisible();

  // The list's suggestions, here too (the owner asked 2026-09-27).
  await page.getByRole("textbox", { name: "Kilere ürün ekle" }).fill("pey");
  await page.getByRole("button", { name: "Beyaz peynir ürününü ekle" }).click();
  await expect(page.getByRole("button", { name: "Beyaz peynir, 1 adet" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Un, 2 kg" })).toBeVisible();

  // Right-click chooses a row (the web does not swipe); Escape leaves, Sil is one write with one undo.
  await page.getByRole("button", { name: "Un, 2 kg" }).click({ button: "right" });
  await expect(page.getByText(/^1\s*seçildi$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/seçildi$/)).toHaveCount(0);

  await page.getByRole("button", { name: "Un, 2 kg" }).click({ button: "right" });
  await page.getByRole("button", { name: "Tümünü seç" }).click();
  await expect(page.getByText(/^3\s*seçildi$/)).toBeVisible();
  await page.getByRole("button", { name: "Sil", exact: true }).click();
  await expect(page.getByText(/3\s*ürün silindi/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Un, 2 kg" })).toHaveCount(0);
  await page.getByRole("button", { name: "Geri Al" }).click();
  await expect(page.getByRole("button", { name: "Un, 2 kg" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tuz, 1 adet" })).toBeVisible();
  expect(failures).toEqual([]);
});

/**
 * The web's database admits one tab. A second says which holds it instead of
 * offering a reload that lands back on itself, and opens by itself once that
 * tab closes: the waiting tab asks who has it, hears nothing, and reloads
 * (Helix's `useDatabaseHandoff`, whose browser suite this follows).
 */
test("a second tab waits for the first and opens when it closes", async ({ page, context }) => {
  await page.goto("/gital/");
  await expect(page.getByRole("heading", { name: "Listeler" })).toBeVisible();

  const second = await context.newPage();
  await second.goto("/gital/");
  await expect(second.getByText("Gital başka bir sekmede açık", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole("button", { name: "Tekrar Dene" })).toHaveCount(0);

  await page.close();
  await expect(second.getByRole("heading", { name: "Listeler" })).toBeVisible({ timeout: 20_000 });
});
