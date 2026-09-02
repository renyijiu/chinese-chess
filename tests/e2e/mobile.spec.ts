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
  const keyboardControl = page.locator(".game-keyboard-control button");
  await expect(keyboardControl).toBeVisible();
  await expect(keyboardControl).not.toBeFocused();
  await expect(keyboardControl.locator(".game-keyboard-control__icon")).toBeVisible();
  await expect
    .poll(async () => (await keyboardControl.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
    .toBeLessThanOrEqual(48);

  await keyboardControl.focus();
  await expect(keyboardControl.getByText("键盘棋盘")).toBeVisible();
  await expect
    .poll(async () => (await keyboardControl.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(120);
  await keyboardControl.blur();
  await expect
    .poll(async () => (await keyboardControl.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
    .toBeLessThanOrEqual(48);
  await expect(page.locator(".game-history")).toHaveAttribute("data-expanded", "false");
  await expect(page.getByRole("button", { name: "展开完整着法历史" })).toBeVisible();
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
  const undersizedSettingsTargets = await page
    .locator(".game-settings select:visible, .game-settings input:visible")
    .evaluateAll((controls) =>
      controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width < 24 || rect.height < 24
          ? [
              {
                height: rect.height,
                label: control.getAttribute("aria-label") ?? control.textContent?.trim(),
                width: rect.width,
              },
            ]
          : [];
      }),
    );
  expect(undersizedSettingsTargets).toEqual([]);
  await page.getByRole("button", { name: "设置" }).click();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "悔棋" })).toBeVisible();
  await expect(page.getByRole("button", { name: /切换到黑方视角/ })).toBeVisible();
  const undersizedTargets = await page
    .locator(".viewer-shell button:visible")
    .evaluateAll((controls) =>
      controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width < 24 || rect.height < 24
          ? [
              {
                height: rect.height,
                label: control.getAttribute("aria-label") ?? control.textContent?.trim(),
                width: rect.width,
              },
            ]
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
  const latestMoveFitsHistory = await page.locator(".game-history").evaluate((history) => {
    const latestMove = history.querySelector<HTMLElement>("[data-last-move='true']");
    if (!latestMove) return false;
    const historyRect = history.getBoundingClientRect();
    const moveRect = latestMove.getBoundingClientRect();
    return moveRect.top >= historyRect.top && moveRect.bottom <= historyRect.bottom;
  });
  expect(latestMoveFitsHistory).toBe(true);

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

test("computer match keeps the collapsed keyboard control clear of status cards", async ({
  page,
}) => {
  await openCleanGame(page, "low", true);
  await page.getByRole("button", { name: "人机对战" }).tap();
  await page.getByRole("radio", { name: "标准", exact: true }).check();
  await page.getByRole("button", { name: "掷骰决定阵营" }).tap();
  const startMatch = page.getByRole("button", { name: /以[红黑]方开始对局/ });
  await expect(startMatch).toBeEnabled();
  await startMatch.tap();

  const keyboardControl = page.locator(".game-keyboard-control button");
  const opponentStatus = page.getByRole("status", { name: "对手状态" });
  await expect(opponentStatus).toBeVisible();
  await expect(keyboardControl).not.toBeFocused();

  const [keyboardBox, opponentBox] = await Promise.all([
    keyboardControl.boundingBox(),
    opponentStatus.boundingBox(),
  ]);
  expect(keyboardBox).not.toBeNull();
  expect(opponentBox).not.toBeNull();
  expect(keyboardBox!.x).toBeLessThanOrEqual(1);
  expect(keyboardBox!.width).toBeLessThanOrEqual(48);
  const overlapsOpponent =
    keyboardBox!.x < opponentBox!.x + opponentBox!.width &&
    keyboardBox!.x + keyboardBox!.width > opponentBox!.x &&
    keyboardBox!.y < opponentBox!.y + opponentBox!.height &&
    keyboardBox!.y + keyboardBox!.height > opponentBox!.y;
  expect(overlapsOpponent).toBe(false);
});

test("wide coarse-pointer layout preserves keyboard autofocus", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 844 });
  await openCleanGame(page);
  await page.getByRole("button", { name: "开始本机双人对局" }).tap();

  const keyboardControl = page.locator(".game-keyboard-control button");
  await expect(keyboardControl).toBeFocused();
  await expect
    .poll(async () => (await keyboardControl.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(150);
});
