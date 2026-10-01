import { expect, test, type Page } from "@playwright/test";

import {
  clickBoardSquare,
  openCleanGame,
  pressSequence,
  startGame,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";

declare global {
  interface Window {
    __XIANGQI_TEST_SHADER_HOLD__?: { enabled: boolean; polls: number };
  }
}

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

test("high quality sleeps between moves and completes capture after context restoration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__XIANGQI_TEST_SHADER_HOLD__ = { enabled: false, polls: 0 };
    const parameter = WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter = function (program, name) {
      const hold = window.__XIANGQI_TEST_SHADER_HOLD__!;
      if (hold.enabled && name === 0x91b1) {
        hold.polls++;
        return false;
      }
      return parameter.call(this, program, name);
    };
  });
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
  await page.locator("canvas").evaluate(
    (canvas) =>
      new Promise<void>((resolve) => {
        window.__XIANGQI_TEST_SHADER_HOLD__!.enabled = true;
        const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!;
        const extension = gl.getExtension("WEBGL_lose_context")!;
        canvas.addEventListener("webglcontextrestored", () => resolve(), { once: true });
        extension.loseContext();
        window.setTimeout(() => extension.restoreContext(), 150);
      }),
  );
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_TEST_SHADER_HOLD__!.polls))
    .toBeGreaterThan(0);
  await page.evaluate(() => window.__XIANGQI_RESET_PERFORMANCE__?.());
  try {
    await pressSequence(keyboard, ["ArrowDown", "Enter", "ArrowUp", "Enter"]);
    // A capture composer must not bypass the restored scene's compilation wait.
    await page.waitForTimeout(300);
    expect(await frameCount(page)).toBe(0);
    await expect(page.locator(".board-viewer")).toHaveAttribute(
      "data-environment-status",
      "loading",
    );
  } finally {
    await page.evaluate(() => {
      window.__XIANGQI_TEST_SHADER_HOLD__!.enabled = false;
    });
  }
  await waitForEnvironmentSettled(page);
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

test("piece shaders finish compiling before drawing a new quality tier", async ({ page }) => {
  await page.addInitScript(() => {
    const shaders = new WeakMap<WebGLShader, string>();
    const programs = new WeakMap<WebGLProgram, WebGLShader[]>();
    const ready = new WeakSet<WebGLProgram>();
    const target = window as typeof window & {
      __SHADER_READINESS__?: { checked: number; premature: number };
    };
    target.__SHADER_READINESS__ = { checked: 0, premature: 0 };
    const prototype = WebGL2RenderingContext.prototype;
    const source = prototype.shaderSource;
    prototype.shaderSource = function (shader, text) {
      shaders.set(shader, text);
      return source.call(this, shader, text);
    };
    const attach = prototype.attachShader;
    prototype.attachShader = function (program, shader) {
      programs.set(program, [...(programs.get(program) ?? []), shader]);
      return attach.call(this, program, shader);
    };
    const parameter = prototype.getProgramParameter;
    prototype.getProgramParameter = function (program, name) {
      const result = parameter.call(this, program, name);
      if (name === 0x91b1 && result === true) ready.add(program);
      return result;
    };
    const info = prototype.getProgramInfoLog;
    prototype.getProgramInfoLog = function (program) {
      if (
        this.getExtension("KHR_parallel_shader_compile") &&
        (programs.get(program) ?? []).some((shader) =>
          shaders.get(shader)?.includes("#define USE_SKINNING"),
        )
      ) {
        target.__SHADER_READINESS__!.checked++;
        if (!ready.has(program)) target.__SHADER_READINESS__!.premature++;
      }
      return info.call(this, program);
    };
  });
  await openCleanGame(page, "high", true);
  await startGame(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  for (const quality of ["low", "high"]) {
    await page.getByRole("combobox", { name: "画质" }).selectOption(quality);
    await waitForEnvironmentSettled(page);
  }
  const readiness = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __SHADER_READINESS__?: { checked: number; premature: number };
        }
      ).__SHADER_READINESS__!,
  );
  expect(readiness.checked).toBeGreaterThan(0);
  expect(readiness.premature).toBe(0);
});

test("a pending optional panorama does not prevent the board from drawing", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/background/qin-diorama-panorama-v1-*.webp", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "开始本机双人对局" })).toBeVisible();
    await expect.poll(() => frameCount(page), { timeout: 6_000 }).toBeGreaterThan(0);
    await expect(page.locator(".board-viewer")).toHaveAttribute(
      "data-environment-status",
      "loading",
    );
    await startGame(page);
    await page.getByRole("button", { name: "俯视棋盘" }).click();
    await expectSleepingScene(page);
    await clickBoardSquare(page.locator("canvas"), 0, 3);
    await expect(page.locator(".game-turn-card small")).toContainText("1 个合法落点");
  } finally {
    release();
  }
  await waitForEnvironmentSettled(page);
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
