import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  clickBoardSquare,
  openCleanGame,
  pressSequence,
  setReducedMotion,
  startGame,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";
import { getPanoramaUrl } from "../../components/xiangqi/scene/diorama-environment";
import {
  QIN_AUDIO_MANIFEST_URL,
  type QinAudioPackManifestV1,
} from "../../components/xiangqi/audio/qin-audio-pack-contract";

declare global {
  interface Window {
    __XIANGQI_AUDIO_RELEASE_HELD_DECODE__?: () => void;
  }
}

const audioManifest = JSON.parse(readFileSync(
  join(process.cwd(), "public/audio/qin-diorama/v1/manifest.json"),
  "utf8",
)) as QinAudioPackManifestV1;
const audioPackPaths = [
  QIN_AUDIO_MANIFEST_URL,
  ...audioManifest.assets.map((asset) => asset.url),
];

async function playTwoLegalTurns(page: Page) {
  const keyboard = page.locator(".game-keyboard-control button");
  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter"]);
  await waitForRevision(page, 1);
  await pressSequence(keyboard, ["ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter"]);
  await waitForRevision(page, 2);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");
  await expect(page.locator(".game-history")).toContainText("黑·卒 a6 → a5");
}

async function expectSynthFallback(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().packState)).toBe("unavailable");
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.())).toMatchObject({
    activeSourcesByKind: {
      "authored-music": 0,
      "synth-music": 1,
    },
    musicMode: "synth",
    pendingDecodes: 0,
    pendingFetches: 0,
  });
}

async function runFailedAudioSession(
  page: Page,
  testInfo: TestInfo,
) {
  const requestCounts = new Map<string, number>();
  const failures: Array<{ failure: string | null; path: string }> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (audioPackPaths.includes(path)) requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
  });
  page.on("requestfailed", (request) => {
    const path = new URL(request.url()).pathname;
    if (audioPackPaths.includes(path)) failures.push({ failure: request.failure()?.errorText ?? null, path });
  });

  await openCleanGame(page, "low", true);
  await startGame(page);
  await expectSynthFallback(page);
  await playTwoLegalTurns(page);

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("checkbox", { name: "静音" }).check();
  await page.getByRole("checkbox", { name: "静音" }).uncheck();
  await page.getByRole("button", { name: "设置" }).click();
  expect(requestCounts.get(QIN_AUDIO_MANIFEST_URL)).toBe(1);
  expect([...requestCounts.values()].every((count) => count === 1)).toBe(true);

  const evidence = {
    failures,
    requestCounts: Object.fromEntries(requestCounts),
    snapshot: await page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.()),
  };
  await testInfo.attach("audio-failure-traffic.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
}

test("a failed optional panorama degrades locally and leaves the board playable", async ({ page }) => {
  await page.route("**/background/qin-diorama-panorama-v1-*.webp", (route) => route.abort("failed"));
  await openCleanGame(page);
  await waitForEnvironmentSettled(page, "degraded");

  await startGame(page);
  await playTwoLegalTurns(page);
  await waitForEnvironmentSettled(page, "degraded");
});

test("a failed optional river degrades locally and leaves authoritative moves playable", async ({ page }) => {
  await page.addInitScript(() => {
    window.__XIANGQI_TEST_FAULTS__ = { riverRender: true };
  });
  await openCleanGame(page);
  await waitForEnvironmentSettled(page, "degraded");
  const devOverlay = page.getByRole("dialog", { name: "Unhandled Script Error" });
  if (await devOverlay.isVisible()) {
    await devOverlay.getByRole("button", { name: "Dismiss" }).click();
  }

  const keyboard = await startGame(page);
  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter"]);
  await waitForRevision(page, 1);
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");
  await waitForEnvironmentSettled(page, "degraded");
});

test("a failed optional ambient task degrades its owner without blocking the game", async ({ page }) => {
  await page.addInitScript(() => {
    window.__XIANGQI_TEST_FAULTS__ = { ambientTask: true };
  });
  await openCleanGame(page, "high");
  await waitForEnvironmentSettled(page, "degraded");

  const keyboard = await startGame(page);
  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter"]);
  await waitForRevision(page, 1);
});

test("a required scene failure can retry without changing the authoritative match", async ({ page }) => {
  await openCleanGame(page);
  const keyboard = await startGame(page);
  await keyboard.focus();
  await pressSequence(keyboard, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter"]);
  await waitForRevision(page, 1);
  const savedBeforeFailure = await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"));

  await page.evaluate(() => {
    const state = window as typeof window & {
      __oldRendererSettlement?: "pending" | "rejected" | "resolved";
      __oldSettleRenderer?: typeof window.__XIANGQI_SETTLE_RENDERER__;
    };
    state.__oldSettleRenderer = window.__XIANGQI_SETTLE_RENDERER__;
    state.__oldRendererSettlement = "pending";
    void window.__XIANGQI_SETTLE_RENDERER__?.().then(
      () => { state.__oldRendererSettlement = "resolved"; },
      () => { state.__oldRendererSettlement = "rejected"; },
    );
    window.__XIANGQI_TEST_FAULTS__ = { sceneRender: true };
    const viewButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("俯视棋盘"));
    viewButton?.click();
  });

  await expect(page.locator(".viewer-fallback")).toContainText("棋盘场景加载失败");
  await expect.poll(() => page.evaluate(() => ({
    lod: window.__XIANGQI_PIECE_LOD_COMMIT__,
    performance: window.__XIANGQI_PERFORMANCE__,
    settlement: (window as typeof window & { __oldRendererSettlement?: string }).__oldRendererSettlement,
    settleType: typeof window.__XIANGQI_SETTLE_RENDERER__,
  }))).toEqual({ lod: undefined, performance: undefined, settlement: "rejected", settleType: "undefined" });
  const retry = page.getByRole("button", { name: "重新加载场景" });
  await expect(retry).toBeVisible();

  // Vinext's development error overlay covers the application after an
  // intentionally thrown render error, so dispatch through the verified,
  // accessible control while exercising this development-only fault seam.
  const firstRetryControl = await retry.elementHandle();
  expect(firstRetryControl).not.toBeNull();
  await retry.evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => firstRetryControl!.evaluate((element) => element.isConnected)).toBe(false);
  await expect(retry).toBeVisible();

  const secondRetryControl = await retry.elementHandle();
  expect(secondRetryControl).not.toBeNull();
  await page.evaluate(() => {
    delete window.__XIANGQI_TEST_FAULTS__;
  });
  await retry.evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => secondRetryControl!.evaluate((element) => element.isConnected)).toBe(false);

  await expect(page.locator(".viewer-canvas canvas")).toBeVisible();
  await waitForEnvironmentSettled(page);
  await expect.poll(() => page.evaluate(() => {
    const oldSettle = (window as typeof window & {
      __oldSettleRenderer?: typeof window.__XIANGQI_SETTLE_RENDERER__;
    }).__oldSettleRenderer;
    return typeof window.__XIANGQI_SETTLE_RENDERER__ === "function"
      && window.__XIANGQI_SETTLE_RENDERER__ !== oldSettle
      && Boolean(window.__XIANGQI_PIECE_LOD_COMMIT__);
  })).toBe(true);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1");
  expect(await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"))).toBe(savedBeforeFailure);
});

test.describe("authored audio failure isolation", () => {
  test("a network abort is attempted once and both sides continue on synth", async ({ page }, testInfo) => {
    await page.route(`**${QIN_AUDIO_MANIFEST_URL}`, (route) => route.abort("failed"));
    await runFailedAudioSession(page, testInfo);
  });

  test("an HTTP error is attempted once and both sides continue on synth", async ({ page }, testInfo) => {
    await page.route("**/audio/qin-diorama/v1/qin-procession-v1.mp3", (route) => route.fulfill({
      body: "upstream unavailable",
      contentType: "text/plain",
      status: 503,
    }));
    await runFailedAudioSession(page, testInfo);
  });

  test("corrupt media fails real decode without blocking authoritative turns", async ({ page }, testInfo) => {
    const corruptBody = Buffer.from("not-an-mp3-stream");
    const corruptManifest = structuredClone(audioManifest);
    corruptManifest.assets[0] = {
      ...corruptManifest.assets[0]!,
      bytes: corruptBody.byteLength,
      sha256: createHash("sha256").update(corruptBody).digest("hex"),
    };
    await page.route(`**${QIN_AUDIO_MANIFEST_URL}`, (route) => route.fulfill({
      body: JSON.stringify(corruptManifest),
      contentType: "application/json",
      status: 200,
    }));
    await page.route("**/audio/qin-diorama/v1/qin-procession-v1.mp3", (route) => route.fulfill({
      body: corruptBody,
      contentType: "audio/mpeg",
      status: 200,
    }));
    await runFailedAudioSession(page, testInfo);
  });

  test("an authored source-start failure invalidates the pack and preserves turns", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const nativeStart = AudioBufferSourceNode.prototype.start;
      let failed = false;
      AudioBufferSourceNode.prototype.start = function start(when?: number, offset?: number, duration?: number) {
        if (!failed && this.loop && this.loopStart > 0) {
          failed = true;
          throw new DOMException("Injected authored source-start failure", "NotSupportedError");
        }
        if (duration !== undefined) return nativeStart.call(this, when, offset, duration);
        if (offset !== undefined) return nativeStart.call(this, when, offset);
        if (when !== undefined) return nativeStart.call(this, when);
        return nativeStart.call(this);
      };
    });
    await runFailedAudioSession(page, testInfo);
    await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.())).toMatchObject({
      sourceStartAttemptsByKind: { "authored-music": 1 },
      sourceStartsByKind: { "authored-music": 0 },
    });
  });

  test("a held decode never blocks play and cannot start late after disposal", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const nativeDecode = AudioContext.prototype.decodeAudioData;
      let held = true;
      AudioContext.prototype.decodeAudioData = function decodeAudioData(data: ArrayBuffer) {
        if (!held) return nativeDecode.call(this, data);
        held = false;
        return new Promise<void>((resolve) => {
          window.__XIANGQI_AUDIO_RELEASE_HELD_DECODE__ = resolve;
        }).then(() => nativeDecode.call(this, data));
      };
    });

    await openCleanGame(page, "low", true);
    await startGame(page);
    await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().pendingDecodes)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.())).toMatchObject({
      activeSourcesByKind: { "synth-music": 1 },
      musicMode: "synth",
      packState: "loading",
    });
    await playTwoLegalTurns(page);

    const beforeDispose = await page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.());
    await page.evaluate(() => window.__XIANGQI_AUDIO_TEST__?.dispose());
    await page.evaluate(() => window.__XIANGQI_AUDIO_RELEASE_HELD_DECODE__?.());
    await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().pendingDecodes)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.())).toMatchObject({
      activeSources: 0,
      authoredBufferCount: 0,
      cachedBuffers: 0,
      contextPresent: false,
      disposed: true,
      listenerAttachments: 0,
      loadingAuthoredBufferCount: 0,
    });
    expect((await page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().sourceStarts))).toBe(beforeDispose?.sourceStarts);

    await testInfo.attach("audio-late-decode-disposal.json", {
      body: Buffer.from(JSON.stringify({
        after: await page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.()),
        beforeDispose,
      }, null, 2)),
      contentType: "application/json",
    });
  });
});

test("high-quality ambient motion keeps resources stable across 100 browser frames", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openCleanGame(page, "high", false);
  await waitForEnvironmentSettled(page, "ready");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-reduced-motion", "false");
  await expect.poll(
    () => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.geometries ?? 0),
  ).toBeGreaterThan(0);
  const baseline = await page.evaluate(() => window.__XIANGQI_PERFORMANCE__!);

  const browserFrames = await page.evaluate(() => new Promise<{
    elapsedMs: number;
    frameCount: number;
  }>((resolve) => {
    const startedAt = performance.now();
    let frameCount = 0;
    const sample = () => {
      frameCount += 1;
      if (frameCount >= 120) {
        resolve({ elapsedMs: performance.now() - startedAt, frameCount });
        return;
      }
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  }));
  const settled = await page.evaluate(() => window.__XIANGQI_PERFORMANCE__!);
  const evidence = { baseline, browserFrames, settled };
  console.info(`AMBIENT_LIFECYCLE ${JSON.stringify(evidence)}`);
  await testInfo.attach("ambient-lifecycle.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });

  await waitForEnvironmentSettled(page, "ready");
  expect(browserFrames.frameCount).toBeGreaterThanOrEqual(100);
  expect(browserFrames.elapsedMs).toBeGreaterThan(0);
  expect(Math.abs(settled.geometries - baseline.geometries)).toBeLessThanOrEqual(1);
  expect(Math.abs(settled.textures - baseline.textures)).toBeLessThanOrEqual(1);
});

test("high-low-high environment switching settles without cumulative renderer growth", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openCleanGame(page, "high");
  await startGame(page);
  await setReducedMotion(page);

  const switchQuality = async (quality: "high" | "low") => {
    const previousCommit = await page.evaluate(() => window.__XIANGQI_PIECE_LOD_COMMIT__ ?? null);
    const expectedLod = quality === "high" ? 1 : 2;
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByLabel("画质").selectOption(quality);
    await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", quality);
    await waitForEnvironmentSettled(page, "ready");
    await page.getByRole("button", { name: "设置" }).click();
    await expect.poll(() => page.evaluate(({ generation, lod }) => {
      const commit = window.__XIANGQI_PIECE_LOD_COMMIT__;
      return Boolean(commit
        && commit.lod === lod
        && (!generation || commit.generation > generation));
    }, {
      generation: previousCommit?.lod === expectedLod ? 0 : previousCommit?.generation ?? 0,
      lod: expectedLod,
    })).toBe(true);
    return page.evaluate(async () => {
      const settleRenderer = window.__XIANGQI_SETTLE_RENDERER__;
      if (!settleRenderer) throw new Error("Renderer settle diagnostic is unavailable.");
      const metrics = await settleRenderer();
      const diagnostics = window.__XIANGQI_ENVIRONMENT_DIAGNOSTICS__;
      return {
        activePanoramaUrls: diagnostics?.activePanoramaUrls ?? [],
        disposedPanoramaCount: diagnostics?.disposedPanoramaCount ?? 0,
        geometries: metrics?.geometries ?? 0,
        textures: metrics?.textures ?? 0,
      };
    });
  };

  const initialHigh = await switchQuality("high");
  const lowAfterHigh = await switchQuality("low");
  const warmedHigh = await switchQuality("high");
  // The first visit to each LOD also warms useLoader's parsed GLB cache. Compare
  // repeated visits only after both piece tiers have completed that warm-up so
  // delayed LOD allocation cannot be mistaken for an environment leak.
  const warmedLow = await switchQuality("low");
  const settledHigh = await switchQuality("high");
  const settledLow = await switchQuality("low");
  const evidence = { initialHigh, lowAfterHigh, settledHigh, settledLow, warmedHigh, warmedLow };
  console.info(`ENVIRONMENT_LIFECYCLE ${JSON.stringify(evidence)}`);
  await testInfo.attach("environment-lifecycle.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  expect(settledHigh.geometries).toBeLessThanOrEqual(warmedHigh.geometries + 1);
  expect(settledHigh.textures).toBeLessThanOrEqual(warmedHigh.textures + 1);
  expect(settledLow.geometries).toBeLessThanOrEqual(warmedLow.geometries + 1);
  expect(settledLow.textures).toBeLessThanOrEqual(warmedLow.textures + 1);
  expect(lowAfterHigh.textures).toBeLessThanOrEqual(initialHigh.textures + 1);
  expect(initialHigh.activePanoramaUrls).toEqual([getPanoramaUrl("high")]);
  expect(lowAfterHigh.activePanoramaUrls).toEqual([getPanoramaUrl("low")]);
  expect(warmedHigh.activePanoramaUrls).toEqual([getPanoramaUrl("high")]);
  expect(warmedLow.activePanoramaUrls).toEqual([getPanoramaUrl("low")]);
  expect(settledHigh.activePanoramaUrls).toEqual([getPanoramaUrl("high")]);
  expect(settledLow.activePanoramaUrls).toEqual([getPanoramaUrl("low")]);
  expect(lowAfterHigh.disposedPanoramaCount).toBeGreaterThan(initialHigh.disposedPanoramaCount);
  expect(warmedHigh.disposedPanoramaCount).toBeGreaterThan(lowAfterHigh.disposedPanoramaCount);
  expect(warmedLow.disposedPanoramaCount).toBeGreaterThan(warmedHigh.disposedPanoramaCount);
  expect(settledHigh.disposedPanoramaCount).toBeGreaterThan(warmedLow.disposedPanoramaCount);
  expect(settledLow.disposedPanoramaCount).toBeGreaterThan(settledHigh.disposedPanoramaCount);
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
