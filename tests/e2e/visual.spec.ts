import { expect, test } from "@playwright/test";

import {
  clickBoardSquare,
  openCleanGame,
  settleVisualScene,
  startGame,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";

const screenshotOptions = {
  animations: "disabled" as const,
  maxDiffPixelRatio: 0.005,
};

test("@visual Qin diorama menu, legal move, capture, and terminal states", async ({ page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page, "high", true);
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "desktop-high-menu-battle.png",
    screenshotOptions,
  );

  await startGame(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("画质").selectOption("low");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", "low");
  await waitForEnvironmentSettled(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  const canvas = page.locator("canvas");
  await clickBoardSquare(canvas, 0, 3);
  await expect(page.locator(".game-turn-card small")).toHaveText("1 个合法落点");
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "desktop-low-selected-legal.png",
    screenshotOptions,
  );

  await clickBoardSquare(canvas, 0, 4);
  await waitForRevision(page, 1);
  await clickBoardSquare(canvas, 0, 6);
  await clickBoardSquare(canvas, 0, 5);
  await waitForRevision(page, 2);
  await clickBoardSquare(canvas, 0, 4);
  await expect(page.locator(".game-turn-card small")).toHaveText("1 个合法落点");
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "desktop-low-pre-capture.png",
    screenshotOptions,
  );
  await clickBoardSquare(canvas, 0, 5);
  await waitForRevision(page, 3);
  await expect(page.locator(".game-history")).toContainText("吃");
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "desktop-low-post-capture.png",
    screenshotOptions,
  );

  await page.getByRole("button", { name: "认输" }).click();
  await page.getByRole("button", { name: "确认认输" }).click();
  await expect(page.getByRole("heading", { name: /胜 · 认输/ })).toBeVisible();
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "desktop-low-terminal.png",
    screenshotOptions,
  );
});

test("@visual check remains legible from the black battle view", async ({ page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page, "low", true);
  await startGame(page);
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  const canvas = page.locator("canvas");
  const moves = [
    [[1, 2], [4, 2]],
    [[0, 6], [0, 5]],
    [[4, 3], [4, 4]],
    [[2, 6], [2, 5]],
    [[4, 4], [4, 5]],
    [[6, 6], [6, 5]],
    [[4, 5], [4, 6]],
  ] as const;
  for (const [index, [from, to]] of moves.entries()) {
    await clickBoardSquare(canvas, from[0], from[1]);
    await clickBoardSquare(canvas, to[0], to[1]);
    await waitForRevision(page, index + 1);
  }
  await expect(page.locator(".game-turn-card")).toHaveAttribute("data-check", "true");
  await expect(page.locator(".game-turn-card small")).toHaveText("黑方被将军");
  await page.getByRole("button", { name: "战场视角" }).click();
  await page.getByRole("button", { name: /切换到黑方视角/ }).click();
  await settleVisualScene(page);
  await expect(page.locator(".viewer-shell")).toHaveScreenshot(
    "desktop-low-black-battle-check.png",
    screenshotOptions,
  );
});
