import { expect, test } from "@playwright/test";

import type { RuntimePerformanceSnapshot } from "../../components/xiangqi/runtime/performance-metrics";
import { openCleanGame, startGame } from "./helpers";

test.skip(
  process.env.RUN_RENDER_PERFORMANCE !== "1",
  "renderer thresholds run only through the explicit performance commands",
);

test("@performance captures first-playable transfer size and renderer telemetry", async ({ page }, testInfo) => {
  const authoritativeFrameGate = Boolean(process.env.PLAYWRIGHT_MEASUREMENT_MODE);
  const baseUrl = new URL(testInfo.project.use.baseURL as string);
  const expectedAssetPaths = ["marshal", "advisor", "elephant", "chariot", "horse", "cannon", "soldier"]
    .map((role) => `/models/pieces/v1/${role}/${role}-lod1.glb`);
  const responseBodies: Promise<readonly [string, number]>[] = [];
  const seenPaths = new Set<string>();
  let recordingFirstPlayable = true;
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!recordingFirstPlayable || !response.ok() || url.origin !== baseUrl.origin) return;
    seenPaths.add(url.pathname);
    responseBodies.push(response.body().then(
      (body) => [url.pathname, body.byteLength] as const,
      (error: unknown) => {
        throw new Error(`Unable to measure required production response ${url.pathname}: ${String(error)}`);
      },
    ));
  });

  await openCleanGame(page, "high");
  const keyboard = await startGame(page);
  await expect.poll(() => expectedAssetPaths.every((path) => seenPaths.has(path))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.currentDrawCalls ?? 0)).toBeGreaterThan(0);
  const bootstrapMetrics = await page.evaluate(() => window.__XIANGQI_PERFORMANCE__);
  console.info(`PERFORMANCE_BOOTSTRAP ${JSON.stringify(bootstrapMetrics)}`);
  recordingFirstPlayable = false;
  const measuredResponses = await Promise.all(responseBodies);
  const responseBytes = new Map(measuredResponses);
  for (const path of expectedAssetPaths) {
    expect(responseBytes.has(path), `first-playable response must include ${path}`).toBe(true);
  }

  let metrics = bootstrapMetrics as RuntimePerformanceSnapshot;
  if (authoritativeFrameGate) {
    await keyboard.focus();
    for (const key of ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter"]) {
      await keyboard.press(key);
    }
    await page.evaluate(() => window.__XIANGQI_RESET_PERFORMANCE__?.());
    await keyboard.press("ArrowUp");
    await keyboard.press("Enter");
    await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1");
    await expect(keyboard).toHaveAttribute("aria-disabled", "false");
    if ((await page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0)) < 30) {
      await page.getByRole("button", { name: "自动巡游" }).click();
      await page.waitForFunction(() => (window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0) >= 30);
      await page.getByRole("button", { name: "停止巡游" }).click();
    }
    metrics = await page.evaluate(() => window.__XIANGQI_PERFORMANCE__) as RuntimePerformanceSnapshot;
  }
  const renderer = await page.locator("canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return debug && gl ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string : "unavailable";
  });
  const firstPlayableBytes = [...responseBytes.values()].reduce((total, bytes) => total + bytes, 0);
  const evidence = {
    ...metrics,
    authoritativeFrameGate,
    firstPlayableBytes,
    firstPlayableMiB: Number((firstPlayableBytes / 1024 / 1024).toFixed(2)),
    measurement: process.env.PLAYWRIGHT_MEASUREMENT_MODE ?? "Headless Chromium rendered-frame interval; not CPU time or GPU render duration",
    renderer,
    gpuMemoryMiB: "not measured; renderer.info exposes resource counts, not allocation bytes",
  };
  await testInfo.attach("performance-evidence.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  console.info(`PERFORMANCE_EVIDENCE ${JSON.stringify(evidence)}`);

  expect(metrics.sampleCount).toBeGreaterThanOrEqual(authoritativeFrameGate ? 30 : 1);
  expect(metrics.peakDrawCalls).toBeLessThanOrEqual(160);
  expect(metrics.currentDrawCalls).toBeLessThanOrEqual(100);
  if (authoritativeFrameGate) expect(metrics.p95FrameIntervalMs).toBeLessThanOrEqual(16.7);
  expect(firstPlayableBytes).toBeLessThanOrEqual(12 * 1024 * 1024);
});
