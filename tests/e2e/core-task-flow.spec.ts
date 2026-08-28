import { expect, test } from "@playwright/test";

test("draft to started task flow persists after reload", async ({ page }) => {
  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill("첫 번째 수직 슬라이스");
  await page.getByLabel("목표").fill("생성부터 시작까지 검증한다");
  await page.getByLabel("작업 종류").selectOption({ label: "개발" });
  await page.getByLabel("예상 작업량").fill("3");
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();

  const poolCard = page.getByRole("article", { name: "첫 번째 수직 슬라이스" });
  await expect(poolCard).toBeVisible();
  await poolCard.getByRole("button", { name: "가져가기" }).click();

  const myCard = page.getByRole("article", { name: "첫 번째 수직 슬라이스" });
  await expect(myCard).toContainText("가져감");
  await myCard.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("article", { name: "첫 번째 수직 슬라이스" })).toContainText("진행 중");
  await page.reload();
  await expect(page.getByRole("article", { name: "첫 번째 수직 슬라이스" })).toContainText("진행 중");
});

test("empty draft shows validation and is not published", async ({ page }) => {
  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill("");
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();
  await expect(page.getByText("제목을 입력해 주세요.")).toBeVisible();
  await page.goto("/task-pool");
  await expect(page.getByText("지금 가져갈 수 있는 작업이 없습니다.")).toBeVisible();
});

test("shows the validation error beside the field that blocked publishing", async ({ page }) => {
  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill("오류 안내 확인");
  await page.getByLabel("작업 종류").selectOption({ label: "개발" });
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();

  await expect(page.getByText("입력 내용을 확인해 주세요.")).toBeVisible();
  await expect(page.getByText("목표를 입력해 주세요.")).toBeVisible();
});

test("returns a taken task to the task pool before it starts", async ({ page }) => {
  await page.goto("/tasks/new");
  await page.getByLabel("작업명").fill("돌려놓을 작업");
  await page.getByLabel("목표").fill("작업 풀 반환을 검증한다");
  await page.getByLabel("작업 종류").selectOption({ label: "개발" });
  await page.getByRole("button", { name: "작업 풀에 공개" }).click();
  await page.getByRole("article", { name: "돌려놓을 작업" })
    .getByRole("button", { name: "가져가기" }).click();

  await expect(page.getByRole("heading", { name: "가져온 작업" })).toBeVisible();
  await page.getByRole("article", { name: "돌려놓을 작업" })
    .getByRole("button", { name: "돌려놓기" }).click();

  await expect(page).toHaveURL(/\/task-pool/);
  await expect(page.getByRole("article", { name: "돌려놓을 작업" })).toContainText("열림");
});
