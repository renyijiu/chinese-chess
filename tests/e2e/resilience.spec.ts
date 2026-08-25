import { expect, test } from "@playwright/test";

import {
  clickBoardSquare,
  openCleanGame,
  pressSequence,
  setReducedMotion,
  startGame,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";

test("a failed optional panorama degrades locally and leaves the board playable", async ({ page }) => {
  await page.route("**/background/qin-diorama-panorama-v1-*.webp", (route) => route.abort("failed"));
  await openCleanGame(page);
  await expect(page.locator(".board-viewer")).toHaveAttribute("data-environment-status", "degraded");

  const keyboard = await startGame(page);
  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp"]);
  await keyboard.press("Enter");
  await waitForRevision(page, 1);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");

  await pressSequence(keyboard, ["ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter"]);
  await waitForRevision(page, 2);
  await expect(page.locator(".game-history")).toContainText("黑·卒 a6 → a5");
  await expect(page.locator(".board-viewer")).toHaveAttribute("data-environment-status", "degraded");
});

test("high-low-high environment switching settles without cumulative renderer growth", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openCleanGame(page, "high");
  await startGame(page);
  await setReducedMotion(page);

  const switchQuality = async (quality: "high" | "low") => {
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByLabel("画质").selectOption(quality);
    await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", quality);
    await waitForEnvironmentSettled(page, "ready");
    await page.getByRole("button", { name: "设置" }).click();
    await expect.poll(
      () => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.geometries ?? 0),
    ).toBeGreaterThan(0);
    return page.evaluate(() => {
      const metrics = window.__XIANGQI_PERFORMANCE__;
      return { geometries: metrics?.geometries ?? 0, textures: metrics?.textures ?? 0 };
    });
  };

  await switchQuality("low");
  const warmedHigh = await switchQuality("high");
  await switchQuality("low");
  const settledHigh = await switchQuality("high");
  const evidence = { settledHigh, warmedHigh };
  console.info(`ENVIRONMENT_LIFECYCLE ${JSON.stringify(evidence)}`);
  await testInfo.attach("environment-lifecycle.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  expect(settledHigh.geometries).toBeLessThanOrEqual(warmedHigh.geometries + 1);
  expect(settledHigh.textures).toBeLessThanOrEqual(warmedHigh.textures + 1);
});

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
