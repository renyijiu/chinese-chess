import { expect, test } from "@playwright/test";

import {
  openCleanGame,
  settleVisualScene,
  setReducedMotion,
  tapBoardSquare,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";

const screenshotOptions = {
  animations: "disabled" as const,
  maxDiffPixelRatio: 0.005,
};

test("390 × 844 touch layout keeps game controls usable", async ({ page }) => {
  await openCleanGame(page);
  await page.getByRole("button", { name: "开始本机双人对局" }).tap();
  await expect(page.locator(".game-keyboard-control button")).toBeVisible();
  await setReducedMotion(page);

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("画质").selectOption("medium");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", "medium");
  await waitForEnvironmentSettled(page);
  await page.getByLabel("画质").selectOption("low");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", "low");
  await waitForEnvironmentSettled(page);
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "mobile-low-settings.png",
    screenshotOptions,
  );
  const undersizedSettingsTargets = await page.locator(".game-settings select:visible, .game-settings input:visible").evaluateAll(
    (controls) => controls.flatMap((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width < 24 || rect.height < 24
        ? [{ height: rect.height, label: control.getAttribute("aria-label") ?? control.textContent?.trim(), width: rect.width }]
        : [];
    }),
  );
  expect(undersizedSettingsTargets).toEqual([]);
  await page.getByRole("button", { name: "设置" }).click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "悔棋" })).toBeVisible();
  await expect(page.getByRole("button", { name: /切换到黑方视角/ })).toBeVisible();
  const undersizedTargets = await page.locator(".viewer-shell button:visible").evaluateAll(
    (controls) => controls.flatMap((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width < 24 || rect.height < 24
        ? [{ height: rect.height, label: control.getAttribute("aria-label") ?? control.textContent?.trim(), width: rect.width }]
        : [];
    }),
  );
  expect(undersizedTargets).toEqual([]);

  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await page.getByRole("button", { name: /切换到黑方视角/ }).click();
  const canvas = page.locator("canvas");
  await tapBoardSquare(canvas, 0, 3, "black");
  await expect(page.locator(".game-turn-card small")).toContainText("1 个合法落点");
  await tapBoardSquare(canvas, 0, 4, "black");
  await waitForRevision(page, 1);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");

  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "mobile-low-playing.png",
    screenshotOptions,
  );

  await page.getByRole("button", { name: "认输" }).click();
  await page.getByRole("button", { name: "确认认输" }).click();
  await expect(page.getByRole("heading", { name: /胜 · 认输/ })).toBeVisible();
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "mobile-low-terminal.png",
    screenshotOptions,
  );
});
