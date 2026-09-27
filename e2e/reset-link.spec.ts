/**
 * The reset link Helix's template mails: its token reaches the page unspent
 * and stays in the address until save, so a mail app's second open or a reload
 * still finds the form rather than "the link cannot be used".
 */

import { expect, test } from "@playwright/test";

test("a reset link's token survives a reload", async ({ page }) => {
  await page.goto("/gital/reset-password?token_hash=unspent&type=recovery");
  await expect(page.getByRole("button", { name: "Şifreyi Yenile" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Şifreyi Yenile" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("token_hash")).toBe("unspent");
});
