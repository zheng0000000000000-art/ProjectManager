import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`task screens do not overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const route of ["/task-pool", "/my-work"]) {
      await page.goto(route);
      const sizes = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
      if (viewport.name === "mobile") {
        const navigation = await page.locator(".app-sidebar").boundingBox();
        expect(navigation?.height).toBeLessThanOrEqual(90);
      }
    }
  });
}

test("desktop workspace follows the mockup gutter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/my-work");

  const sidebar = await page.locator(".app-sidebar").boundingBox();
  const content = await page.locator(".page").boundingBox();

  expect(sidebar?.width).toBe(220);
  expect(content?.x).toBe(252);
  expect(content?.width).toBe(1156);

  await page.goto("/tasks/new");
  const draft = await page.locator(".page").boundingBox();
  expect(draft?.x).toBe(252);
  expect(draft?.width).toBe(1156);
});

test("uses Pretendard as the primary interface font", async ({ page }) => {
  await page.goto("/my-work");
  const fontFamily = await page.locator("body").evaluate(
    (body) => getComputedStyle(body).fontFamily,
  );

  expect(fontFamily).toMatch(/^"?(Pretendard Variable|Pretendard)/);
});
