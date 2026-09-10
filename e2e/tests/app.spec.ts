import { test, expect } from "@playwright/test";

test.describe("İş Takip", () => {
  test("should load the app", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/is-takip/);
  });

  test("should show calendar view by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Takvim")).toBeVisible();
  });

  test("should navigate to workers screen", async ({ page }) => {
    await page.goto("/");
    await page.click("text=Kişiler");
    await expect(page.locator("text=Çalışanlar")).toBeVisible();
  });

  test("should navigate to settings screen", async ({ page }) => {
    await page.goto("/");
    await page.click("text=Ayarlar");
    await expect(page.locator("text=Ayarlar")).toBeVisible();
  });
});
