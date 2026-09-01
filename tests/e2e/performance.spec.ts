import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  summarizeFrameIntervals,
  type RuntimePerformanceSnapshot,
} from "../../components/xiangqi/runtime/performance-metrics";
import { getPanoramaUrl } from "../../components/xiangqi/scene/diorama-environment";
import {
  QIN_AUDIO_MANIFEST_URL,
  type QinAudioPackManifestV1,
} from "../../components/xiangqi/audio/qin-audio-pack-contract";
import { openCleanGame, startGame } from "./helpers";

const rootDir = process.cwd();
const audioManifest = JSON.parse(
  readFileSync(join(rootDir, "public/audio/qin-diorama/v1/manifest.json"), "utf8"),
) as QinAudioPackManifestV1;
const expectedAudioPaths = [
  QIN_AUDIO_MANIFEST_URL,
  ...audioManifest.assets.map((asset) => asset.url),
];
const expectedAudioBytes = new Map(
  expectedAudioPaths.map((path) => [
    path,
    statSync(join(rootDir, "public", path.replace(/^\//, ""))).size,
  ]),
);
const expectedAudioMime = new Map<string, string>([
  [QIN_AUDIO_MANIFEST_URL, "application/json"],
  ...audioManifest.assets.map((asset) => [asset.url, asset.mimeType] as const),
]);
const DOCUMENTED_PRE_AI_P95_MS = 18.4;
const AI_P95_REGRESSION_LIMIT_MS = Number((DOCUMENTED_PRE_AI_P95_MS * 1.1).toFixed(2));

test.skip(
  process.env.RUN_RENDER_PERFORMANCE !== "1",
  "renderer thresholds run only through the explicit performance commands",
);

test("@performance captures first-playable transfer size and renderer telemetry", async ({
  page,
}, testInfo) => {
  const authoritativeFrameGate = Boolean(process.env.PLAYWRIGHT_MEASUREMENT_MODE);
  const baseUrl = new URL(testInfo.project.use.baseURL as string);
  const expectedAssetPaths = [
    "marshal",
    "advisor",
    "elephant",
    "chariot",
    "horse",
    "cannon",
    "soldier",
  ].map((role) => `/models/pieces/v1/${role}/${role}-lod1.glb`);
  const activePanoramaPath = getPanoramaUrl("high");
  const inactivePanoramaPaths = [getPanoramaUrl("medium"), getPanoramaUrl("low")];
  const expectedFirstPlayablePaths = [...expectedAssetPaths, activePanoramaPath];
  const responseBodies: Promise<readonly [string, number]>[] = [];
  const audioResponseBodies: Promise<readonly [string, number, string]>[] = [];
  const audioRequests: string[] = [];
  const audioRequestsBeforeGesture: string[] = [];
  const seenPaths = new Set<string>();
  const seenAudioPaths = new Set<string>();
  let audioGestureUnlocked = false;
  let recordingFirstPlayable = true;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!expectedAudioPaths.includes(path)) return;
    audioRequests.push(path);
    if (!audioGestureUnlocked) audioRequestsBeforeGesture.push(path);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== baseUrl.origin) return;
    if (response.ok() && expectedAudioPaths.includes(url.pathname)) {
      seenAudioPaths.add(url.pathname);
      audioResponseBodies.push(
        response.body().then(
          (body) =>
            [
              url.pathname,
              body.byteLength,
              response.headers()["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "",
            ] as const,
          (error: unknown) => {
            throw new Error(
              `Unable to measure authored audio response ${url.pathname}: ${String(error)}`,
            );
          },
        ),
      );
    }
    if (!recordingFirstPlayable || !response.ok()) return;
    seenPaths.add(url.pathname);
    responseBodies.push(
      response.body().then(
        (body) => [url.pathname, body.byteLength] as const,
        (error: unknown) => {
          throw new Error(
            `Unable to measure required production response ${url.pathname}: ${String(error)}`,
          );
        },
      ),
    );
  });

  await openCleanGame(page, "high");
  await expect
    .poll(() => expectedFirstPlayablePaths.every((path) => seenPaths.has(path)))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.currentDrawCalls ?? 0))
    .toBeGreaterThan(0);
  const bootstrapMetrics = await page.evaluate(() => window.__XIANGQI_PERFORMANCE__);
  console.info(`PERFORMANCE_BOOTSTRAP ${JSON.stringify(bootstrapMetrics)}`);
  recordingFirstPlayable = false;
  const measuredResponses = await Promise.all(responseBodies);
  const responseBytes = new Map(measuredResponses);
  for (const path of expectedFirstPlayablePaths) {
    expect(responseBytes.has(path), `first-playable response must include ${path}`).toBe(true);
  }
  for (const path of inactivePanoramaPaths) {
    expect(seenPaths.has(path), `first playable must not request inactive panorama ${path}`).toBe(
      false,
    );
  }
  expect(
    audioRequestsBeforeGesture,
    "authored audio must not be part of pre-gesture first playable",
  ).toEqual([]);
  expect(audioRequests).toEqual([]);

  audioGestureUnlocked = true;
  const keyboard = await startGame(page);
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().packState))
    .toBe("ready");
  await expect.poll(() => expectedAudioPaths.every((path) => seenAudioPaths.has(path))).toBe(true);
  const measuredAudioResponses = await Promise.all(audioResponseBodies);
  const audioResponseBytes = new Map(measuredAudioResponses.map(([path, bytes]) => [path, bytes]));
  const audioResponseMime = new Map(measuredAudioResponses.map(([path, , mime]) => [path, mime]));
  expect(audioRequests).toEqual(expectedAudioPaths);
  expect(new Set(audioRequests).size).toBe(expectedAudioPaths.length);
  for (const path of expectedAudioPaths) {
    expect(audioResponseBytes.get(path), `cold-cache audio bytes must reconcile for ${path}`).toBe(
      expectedAudioBytes.get(path),
    );
    expect(audioResponseMime.get(path), `cold-cache audio MIME must match for ${path}`).toBe(
      expectedAudioMime.get(path),
    );
    expect(audioResponseMime.get(path)).not.toContain("text/html");
  }
  const audioSnapshot = await page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.());
  expect(audioSnapshot).toMatchObject({
    maxInFlightDecodes: 1,
    maxInFlightFetches: 1,
    pendingDecodes: 0,
    pendingFetches: 0,
  });
  expect(audioSnapshot!.authoredDecodedBytes).toBeLessThanOrEqual(30 * 1024 * 1024);
  expect(audioSnapshot!.totalDecodedBytes).toBeLessThanOrEqual(40 * 1024 * 1024);

  let metrics = bootstrapMetrics as RuntimePerformanceSnapshot;
  if (authoritativeFrameGate) {
    await page.evaluate(() => window.__XIANGQI_RESET_PERFORMANCE__?.());
    await page.getByRole("button", { name: "自动巡游" }).click();
    await page.waitForFunction(() => (window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0) >= 60);
    await page.getByRole("button", { name: "停止巡游" }).click();
    await keyboard.focus();
    for (const key of [
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowUp",
      "ArrowUp",
      "ArrowUp",
      "Enter",
    ]) {
      await keyboard.press(key);
    }
    await page.evaluate(() => window.__XIANGQI_RESET_PERFORMANCE__?.());
    await keyboard.press("ArrowUp");
    await keyboard.press("Enter");
    await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1");
    await expect(keyboard).toHaveAttribute("aria-disabled", "false");
    if ((await page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0)) < 180) {
      await page.getByRole("button", { name: "自动巡游" }).click();
      await page.waitForFunction(() => (window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0) >= 180);
      await page.getByRole("button", { name: "停止巡游" }).click();
    }
    metrics = (await page.evaluate(
      () => window.__XIANGQI_PERFORMANCE__,
    )) as RuntimePerformanceSnapshot;
  }
  const renderer = await page.locator("canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return debug && gl ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string) : "unavailable";
  });
  const firstPlayableBytes = [...responseBytes.values()].reduce((total, bytes) => total + bytes, 0);
  const rafIntervals = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const intervals: number[] = [];
        let previous = 0;
        const sample = (timestamp: number) => {
          if (previous > 0) intervals.push(timestamp - previous);
          previous = timestamp;
          if (intervals.length < 120) {
            window.requestAnimationFrame(sample);
            return;
          }
          resolve(intervals);
        };
        window.requestAnimationFrame(sample);
      }),
  );
  const rafCadence = summarizeFrameIntervals(rafIntervals);
  const canvasDpr = await page.locator("canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return Number(((canvas as HTMLCanvasElement).width / bounds.width).toFixed(2));
  });
  const evidence = {
    ...metrics,
    authoredAudio: {
      decodedBytes: audioSnapshot!.authoredDecodedBytes,
      engineOwnedDecodedBytes: audioSnapshot!.totalDecodedBytes,
      maxInFlightDecodes: audioSnapshot!.maxInFlightDecodes,
      maxInFlightFetches: audioSnapshot!.maxInFlightFetches,
      responseBytes: Object.fromEntries(audioResponseBytes),
      responseMime: Object.fromEntries(audioResponseMime),
      totalResponseBytes: [...audioResponseBytes.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      ),
      uniqueSuccessfulUrls: [...audioResponseBytes.keys()],
    },
    authoritativeFrameGate,
    firstPlayableBytes,
    firstPlayableMiB: Number((firstPlayableBytes / 1024 / 1024).toFixed(2)),
    canvasDpr,
    measurement:
      process.env.PLAYWRIGHT_MEASUREMENT_MODE ??
      "Headless Chromium rendered-frame interval; not CPU time or GPU render duration",
    rafCadence,
    renderer,
    gpuMemoryMiB: "not measured; renderer.info exposes resource counts, not allocation bytes",
  };
  await testInfo.attach("performance-evidence.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  console.info(`PERFORMANCE_EVIDENCE ${JSON.stringify(evidence)}`);

  expect(metrics.sampleCount).toBeGreaterThanOrEqual(authoritativeFrameGate ? 180 : 1);
  expect(metrics.peakDrawCalls).toBeLessThanOrEqual(160);
  expect(metrics.currentDrawCalls).toBeLessThanOrEqual(100);
  if (authoritativeFrameGate) expect(metrics.p95FrameIntervalMs).toBeLessThanOrEqual(16.7);
  expect(canvasDpr).toBeLessThanOrEqual(1.5);
  expect(firstPlayableBytes).toBeLessThanOrEqual(12 * 1024 * 1024);
});

test("@performance keeps lightweight AI search off the main thread during presentation", async ({
  page,
}, testInfo) => {
  const authoritativeFrameGate = Boolean(process.env.PLAYWRIGHT_MEASUREMENT_MODE);
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __XIANGQI_AI_CAPTURE_FRAMES__?: boolean;
      __XIANGQI_AI_FRAME_INTERVALS__?: number[];
      __XIANGQI_AI_LONG_TASKS__?: number[];
      __XIANGQI_AI_SEARCH_MEASURE_STARTED__?: boolean;
      __XIANGQI_AI_SEARCH_LONG_TASKS__?: number[];
    };
    target.__XIANGQI_AI_LONG_TASKS__ = [];
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries())
        target.__XIANGQI_AI_LONG_TASKS__?.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    const NativeWorker = window.Worker;
    class MeasuredWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          const output = event.data as { type?: string } | null;
          if (output?.type !== "result" && output?.type !== "error") return;
          target.__XIANGQI_AI_SEARCH_LONG_TASKS__ = [...(target.__XIANGQI_AI_LONG_TASKS__ ?? [])];
          window.__XIANGQI_RESET_PERFORMANCE__?.();
          target.__XIANGQI_AI_FRAME_INTERVALS__ = [];
          target.__XIANGQI_AI_CAPTURE_FRAMES__ = true;
          let previous = 0;
          const sample = (timestamp: number) => {
            if (!target.__XIANGQI_AI_CAPTURE_FRAMES__) return;
            if (previous > 0) target.__XIANGQI_AI_FRAME_INTERVALS__?.push(timestamp - previous);
            previous = timestamp;
            window.requestAnimationFrame(sample);
          };
          window.requestAnimationFrame(sample);
        });
      }
      override postMessage(
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) {
        const send = () => {
          const nativePostMessage = NativeWorker.prototype.postMessage as unknown as (
            this: Worker,
            value: unknown,
            transfer?: StructuredSerializeOptions | Transferable[],
          ) => void;
          nativePostMessage.call(this, message, options);
        };
        const input = message as { type?: string } | null;
        if (input?.type !== "search") {
          send();
          return;
        }
        target.__XIANGQI_AI_LONG_TASKS__ = [];
        target.__XIANGQI_AI_SEARCH_MEASURE_STARTED__ = false;
        send();
        window.setTimeout(() => {
          target.__XIANGQI_AI_LONG_TASKS__ = [];
          target.__XIANGQI_AI_SEARCH_MEASURE_STARTED__ = true;
        }, 1_000);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: MeasuredWorker });
    let first = true;
    const original = Crypto.prototype.getRandomValues;
    Crypto.prototype.getRandomValues = function getRandomValues<T extends ArrayBufferView | null>(
      array: T,
    ): T {
      if (first && array instanceof Uint8Array) {
        first = false;
        array.fill(4);
        return array as T;
      }
      return Reflect.apply(original, this, [array]) as T;
    };
  });
  await openCleanGame(page, authoritativeFrameGate ? "high" : "low", !authoritativeFrameGate);
  await page.getByRole("button", { name: "人机对战" }).click();
  await page.getByRole("radio", { name: "困难", exact: true }).check();
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().packState))
    .toBe("ready");
  await page.evaluate(() => {
    window.__XIANGQI_RESET_PERFORMANCE__?.();
  });

  const keyboard = page.locator(".game-keyboard-control button");
  await keyboard.focus();
  for (const key of [
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
  ])
    await keyboard.press(key);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "2", {
    timeout: 45_000,
  });
  await expect(keyboard).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
  if (authoritativeFrameGate) {
    const settledSamples = await page.evaluate(
      () => window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0,
    );
    await page.getByRole("button", { name: "自动巡游" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0))
      .toBeGreaterThan(settledSamples);
    await page.getByRole("button", { name: "停止巡游" }).click();
  } else {
    // Reduced-motion deliberately disables auto-tour. The AI result and its
    // short presentation still produce enough demand frames for resource
    // telemetry; frame cadence remains diagnostic under SwiftShader.
    await expect
      .poll(() => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0))
      .toBeGreaterThan(0);
  }
  const evidence = await page.evaluate(() => {
    const target = window as typeof window & {
      __XIANGQI_AI_CAPTURE_FRAMES__?: boolean;
      __XIANGQI_AI_FRAME_INTERVALS__?: number[];
      __XIANGQI_AI_SEARCH_MEASURE_STARTED__?: boolean;
      __XIANGQI_AI_SEARCH_LONG_TASKS__?: number[];
    };
    target.__XIANGQI_AI_CAPTURE_FRAMES__ = false;
    return {
      frameIntervals: target.__XIANGQI_AI_FRAME_INTERVALS__ ?? [],
      searchMeasureStarted: target.__XIANGQI_AI_SEARCH_MEASURE_STARTED__ ?? false,
      searchLongTasks: target.__XIANGQI_AI_SEARCH_LONG_TASKS__ ?? [],
      renderer: window.__XIANGQI_PERFORMANCE__,
    };
  });
  const frameCadence = summarizeFrameIntervals(evidence.frameIntervals);
  const comparedEvidence = {
    ...evidence,
    authoritativeFrameGate,
    documentedPreAiP95Ms: DOCUMENTED_PRE_AI_P95_MS,
    frameCadence,
    regressionLimitP95Ms: AI_P95_REGRESSION_LIMIT_MS,
  };
  await testInfo.attach("ai-performance-evidence.json", {
    body: Buffer.from(JSON.stringify(comparedEvidence, null, 2)),
    contentType: "application/json",
  });
  console.info(`AI_PERFORMANCE_EVIDENCE ${JSON.stringify(comparedEvidence)}`);

  expect(evidence.searchMeasureStarted).toBe(true);
  expect(evidence.searchLongTasks.filter((duration) => duration > 50)).toEqual([]);
  if (authoritativeFrameGate) {
    expect(evidence.renderer?.sampleCount ?? 0).toBeGreaterThanOrEqual(30);
    expect(evidence.renderer?.p95FrameIntervalMs ?? Infinity).toBeLessThanOrEqual(
      AI_P95_REGRESSION_LIMIT_MS,
    );
  }
  expect(evidence.renderer?.peakDrawCalls ?? Infinity).toBeLessThanOrEqual(160);
  expect(evidence.renderer?.currentDrawCalls ?? Infinity).toBeLessThanOrEqual(100);
});
