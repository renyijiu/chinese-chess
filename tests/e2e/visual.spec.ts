import { expect, test } from "@playwright/test";

import { openCleanGame, setReducedMotion, startGame } from "./helpers";

test("@visual initial 32-piece Qin terracotta diorama board", async ({ page }) => {
  await openCleanGame(page);
  await startGame(page);
  await setReducedMotion(page);
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await page.waitForFunction(() => (window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0) >= 2);
  await page.waitForTimeout(2_000);

  await expect(page.locator(".viewer-shell")).toHaveScreenshot("desktop-low-initial-board.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.005,
  });
});
