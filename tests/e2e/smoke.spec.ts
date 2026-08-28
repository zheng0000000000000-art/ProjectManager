import { expect, test } from "@playwright/test";

test("opens the app shell", async ({ page }) => {
  await page.goto("/my-work");
  await expect(page.getByRole("link", { name: "내 작업" })).toBeVisible();
  await expect(page.getByRole("link", { name: "작업 풀" })).toBeVisible();
});
