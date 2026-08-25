import { expect, test } from "@playwright/test";

import { openCleanGame, setReducedMotion, tapBoardSquare, waitForRevision } from "./helpers";

test("390 × 844 touch layout keeps game controls usable", async ({ page }) => {
  await openCleanGame(page);
  await page.getByRole("button", { name: "开始本机双人对局" }).tap();
  await expect(page.locator(".game-keyboard-control button")).toBeVisible();
  await setReducedMotion(page);

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("画质").selectOption("medium");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", "medium");
  await page.getByLabel("画质").selectOption("low");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", "low");
  await page.getByRole("button", { name: "设置" }).click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "悔棋" })).toBeVisible();
  await expect(page.getByRole("button", { name: /切换到黑方视角/ })).toBeVisible();

  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await page.getByRole("button", { name: /切换到黑方视角/ }).click();
  await page.waitForTimeout(2_000);
  const canvas = page.locator("canvas");
  await tapBoardSquare(canvas, 0, 3, "black");
  await expect(page.locator(".game-turn-card small")).toContainText("1 个合法落点");
  await tapBoardSquare(canvas, 0, 4, "black");
  await waitForRevision(page, 1);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");

  await expect(page.locator(".viewer-shell")).toHaveScreenshot("mobile-low-playing.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.005,
  });
});
