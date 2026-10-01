import { expect, test, type Page } from "@playwright/test";

import {
  clickBoardSquare,
  openCleanGame,
  pressSequence,
  startGame,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";

async function frameCount(page: Page) {
  return page.evaluate(() => window.__XIANGQI_FLUSH_PERFORMANCE__?.().renderedFrames ?? 0);
}

async function expectSleepingScene(page: Page) {
  let previous = await frameCount(page);
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const current = await frameCount(page);
        stableSamples = current === previous ? stableSamples + 1 : 0;
        previous = current;
        return stableSamples >= 3;
      },
      { intervals: [500], timeout: 15_000 },
    )
    .toBe(true);
  const before = await frameCount(page);
  // This timed observation is the behavior under test: no draw while waiting for input.
  await page.waitForTimeout(1_000);
  expect(await frameCount(page)).toBe(before);
}

test("the first move after a long idle still plays its animation", async ({ page }) => {
  await openCleanGame(page, "high");
  const keyboard = await startGame(page);
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await expectSleepingScene(page);
  const canvas = page.locator("canvas");
  await clickBoardSquare(canvas, 0, 3);
  await expect(page.locator(".game-turn-card small")).toContainText("1 个合法落点");
  await expectSleepingScene(page);
  await page.waitForTimeout(2_100);
  // Measure in the page: slow software rendering can delay Playwright commands
  // until after an otherwise complete animation has already finished.
  await keyboard.evaluate((button) => {
    let startedAt = 0;
    const observer = new MutationObserver(() => {
      if (button.getAttribute("aria-disabled") === "true") {
        if (startedAt === 0) startedAt = performance.now();
      } else if (startedAt > 0) {
        button.setAttribute("data-animation-duration-ms", String(performance.now() - startedAt));
        observer.disconnect();
      }
    });
    observer.observe(button, { attributes: true, attributeFilter: ["aria-disabled"] });
  });
  await clickBoardSquare(canvas, 0, 4);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1");
  await waitForRevision(page, 1);
  expect(Number(await keyboard.getAttribute("data-animation-duration-ms"))).toBeGreaterThan(500);
  await page.getByRole("button", { name: /切换到黑方视角/ }).click();
  await expectSleepingScene(page);
  await page.getByRole("button", { name: "战场视角" }).click();
  await expectSleepingScene(page);
});

test("high quality sleeps between moves and still renders a complete capture", async ({ page }) => {
  await openCleanGame(page, "high");
  const keyboard = await startGame(page);
  await expectSleepingScene(page);
  await keyboard.focus();
  await pressSequence(keyboard, [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "Enter",
    "ArrowUp",
    "Enter",
  ]);
  await waitForRevision(page, 1);
  await pressSequence(keyboard, ["ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter"]);
  await waitForRevision(page, 2);
  await page.evaluate(() => window.__XIANGQI_RESET_PERFORMANCE__?.());
  await pressSequence(keyboard, ["ArrowDown", "Enter", "ArrowUp", "Enter"]);
  await waitForRevision(page, 3);
  await expect(page.locator('.game-history li[data-last-move="true"]')).toContainText("吃黑卒");
  const capture = await page.evaluate(() => window.__XIANGQI_FLUSH_PERFORMANCE__?.());
  expect(capture?.sampleCount).toBeGreaterThan(0);
  expect(capture?.peakDrawCalls).toBeLessThanOrEqual(160);
  await expectSleepingScene(page);
  await page.getByRole("button", { name: "自动巡游" }).click();
  const beforeTour = await frameCount(page);
  await expect.poll(() => frameCount(page)).toBeGreaterThan(beforeTour + 5);
  await page.getByRole("button", { name: "停止巡游" }).click();
  await expectSleepingScene(page);
});

test("frame telemetry excludes sleep but retains stalls during continuous rendering", async ({
  page,
  headless,
}) => {
  test.skip(
    headless,
    "cadence assertions require visible hardware rendering, like the performance suite",
  );
  await openCleanGame(page, "high");
  await startGame(page);
  await expectSleepingScene(page);
  await page.evaluate(() => window.__XIANGQI_RESET_PERFORMANCE__?.());
  await page.waitForTimeout(1_000);
  await page.getByRole("button", { name: "自动巡游" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_FLUSH_PERFORMANCE__?.().sampleCount ?? 0))
    .toBeGreaterThan(10);
  expect(await page.evaluate(() => window.__XIANGQI_FLUSH_PERFORMANCE__?.().longFrames250Ms)).toBe(
    0,
  );
  // A real stall must survive telemetry; sleeping above must not look like one.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          const until = performance.now() + 350;
          while (performance.now() < until) {
            /* intentional main-thread stall */
          }
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
      ),
  );
  const stalled = await page.evaluate(() => window.__XIANGQI_FLUSH_PERFORMANCE__?.());
  expect(stalled?.longFrames250Ms).toBeGreaterThan(0);
  expect(stalled?.maximumFrameIntervalMs).toBeGreaterThan(300);
  await page.getByRole("button", { name: "停止巡游" }).click();
});

test("quality changes apply native antialiasing without replacing the game", async ({ page }) => {
  await openCleanGame(page, "high", true);
  const keyboard = await startGame(page);
  await pressSequence(keyboard, [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "Enter",
    "ArrowUp",
    "Enter",
  ]);
  await waitForRevision(page, 1);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  for (const quality of ["low", "high", "low"] as const) {
    await page.locator(".game-settings select").selectOption(quality);
    await waitForEnvironmentSettled(page);
    await expect
      .poll(() =>
        page
          .locator("canvas")
          .evaluate(
            (canvas) =>
              (canvas as HTMLCanvasElement).getContext("webgl2")?.getContextAttributes()?.antialias,
          ),
      )
      .toBe(quality !== "low");
    await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1");
  }
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter"]);
  await waitForRevision(page, 2);
});

test("volume preview saves once after keyboard adjustment and keeps focus", async ({ page }) => {
  await openCleanGame(page, "low", true);
  await startGame(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const slider = page.getByRole("slider", { name: "主音量" });
  await slider.focus();
  await page.keyboard.down("ArrowLeft");
  await expect(slider).toHaveValue("0.79");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("xiangqi3d:settings:v1")!).masterVolume,
    ),
  ).toBe(0.8);
  await page.keyboard.up("ArrowLeft");
  await expect(slider).toBeFocused();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("xiangqi3d:settings:v1")!).masterVolume,
    ),
  ).toBe(0.79);
});
