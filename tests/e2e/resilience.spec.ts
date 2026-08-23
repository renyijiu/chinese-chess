import { expect, test } from "@playwright/test";

import { clickBoardSquare, openCleanGame, pressSequence, startGame, waitForRevision } from "./helpers";

test("authoritative rules continue through a WebGL context loss and restore", async ({ page }) => {
  test.setTimeout(90_000);
  await openCleanGame(page);
  const keyboard = await startGame(page);

  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp"]);
  await keyboard.press("Enter");

  const contextControl = await page.locator("canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension || !gl) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => resolve(false), 5_000);
      canvas.addEventListener("webglcontextrestored", () => {
        window.clearTimeout(timeout);
        window.requestAnimationFrame(() => resolve(!gl.isContextLost()));
      }, { once: true });
      extension.loseContext();
      window.setTimeout(() => extension.restoreContext(), 150);
    });
  });
  test.skip(!contextControl, "Chromium did not expose WEBGL_lose_context");

  await waitForRevision(page, 1);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");
  await expect(page.getByRole("button", { name: "悔棋" })).toBeEnabled();

  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await page.waitForTimeout(2_000);
  const canvas = page.locator("canvas");
  await clickBoardSquare(canvas, 0, 6);
  await clickBoardSquare(canvas, 0, 5);
  await waitForRevision(page, 2);
  await expect(page.locator(".game-history")).toContainText("黑·卒 a6 → a5");

  await page.getByRole("button", { name: "悔棋" }).click();
  await waitForRevision(page, 3);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");
});
