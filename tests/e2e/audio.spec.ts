import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { AudioTransientCueId } from "../../components/xiangqi/audio/audio-types";
import {
  QIN_AUDIO_MANIFEST_URL,
  type QinAudioPackManifestV1,
} from "../../components/xiangqi/audio/qin-audio-pack-contract";
import { openCleanGame, pressSequence, startGame, waitForRevision } from "./helpers";

type BrowserAudioProbe = {
  constructed: number;
  decodeCalls: Array<{
    channels?: number;
    decodedDuration?: number;
    encodedBytes: number;
    error?: string;
  }>;
  gainRamps: number;
  initialStates: string[];
  maxPendingDecodes: number;
  mediaSources: number;
  pendingDecodes: number;
  resumed: number;
  sourceStarts: Array<{
    bufferDuration: number | null;
    loop: boolean;
    loopEnd: number;
    loopStart: number;
    offset: number | null;
    when: number | null;
  }>;
  suspended: number;
};

declare global {
  interface Window {
    __XIANGQI_AUDIO_PROBE__?: BrowserAudioProbe;
    __XIANGQI_AUDIO_MEDIA__?: HTMLMediaElement;
    __XIANGQI_TEST_HIDDEN__?: boolean;
  }
}

const rootDir = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(rootDir, "public/audio/qin-diorama/v1/manifest.json"), "utf8"),
) as QinAudioPackManifestV1;
const packPaths = [QIN_AUDIO_MANIFEST_URL, ...manifest.assets.map((asset) => asset.url)];
const expectedMime = new Map<string, string>([
  [QIN_AUDIO_MANIFEST_URL, "application/json"],
  ...manifest.assets.map((asset) => [asset.url, asset.mimeType] as const),
]);
const expectedDiskBytes = new Map(
  packPaths.map((path) => [path, statSync(join(rootDir, "public", path.replace(/^\//, ""))).size]),
);

async function installBrowserAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: BrowserAudioProbe = {
      constructed: 0,
      decodeCalls: [],
      gainRamps: 0,
      initialStates: [],
      maxPendingDecodes: 0,
      mediaSources: 0,
      pendingDecodes: 0,
      resumed: 0,
      sourceStarts: [],
      suspended: 0,
    };
    Object.defineProperty(window, "__XIANGQI_AUDIO_PROBE__", { configurable: true, value: probe });

    const NativeAudioContext = window.AudioContext;
    const nativeResume = NativeAudioContext.prototype.resume;
    const nativeSuspend = NativeAudioContext.prototype.suspend;
    const nativeDecode = NativeAudioContext.prototype.decodeAudioData;
    const nativeMediaSource = NativeAudioContext.prototype.createMediaElementSource;
    NativeAudioContext.prototype.createMediaElementSource = function createMediaElementSource(
      element: HTMLMediaElement,
    ) {
      probe.mediaSources += 1;
      window.__XIANGQI_AUDIO_MEDIA__ = element;
      return nativeMediaSource.call(this, element);
    };
    NativeAudioContext.prototype.resume = function resume() {
      probe.resumed += 1;
      return nativeResume.call(this);
    };
    NativeAudioContext.prototype.suspend = function suspend() {
      probe.suspended += 1;
      return nativeSuspend.call(this);
    };
    NativeAudioContext.prototype.decodeAudioData = function decodeAudioData(data: ArrayBuffer) {
      probe.pendingDecodes += 1;
      probe.maxPendingDecodes = Math.max(probe.maxPendingDecodes, probe.pendingDecodes);
      const call = { encodedBytes: data.byteLength } as BrowserAudioProbe["decodeCalls"][number];
      probe.decodeCalls.push(call);
      return nativeDecode
        .call(this, data)
        .then(
          (buffer) => {
            call.channels = buffer.numberOfChannels;
            call.decodedDuration = buffer.duration;
            return buffer;
          },
          (error: unknown) => {
            call.error = error instanceof Error ? error.message : String(error);
            throw error;
          },
        )
        .finally(() => {
          probe.pendingDecodes = Math.max(0, probe.pendingDecodes - 1);
        });
    };
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(target, argumentsList, newTarget) {
        probe.constructed += 1;
        const context = Reflect.construct(target, argumentsList, newTarget) as AudioContext;
        probe.initialStates.push(context.state);
        return context;
      },
    });

    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function start(
      when?: number,
      offset?: number,
      duration?: number,
    ) {
      const entry = {
        bufferDuration: this.buffer?.duration ?? null,
        loop: this.loop,
        loopEnd: this.loopEnd,
        loopStart: this.loopStart,
        offset: offset ?? null,
        when: when ?? null,
      };
      probe.sourceStarts.push(entry);
      if (duration !== undefined) return nativeStart.call(this, when, offset, duration);
      if (offset !== undefined) return nativeStart.call(this, when, offset);
      if (when !== undefined) return nativeStart.call(this, when);
      return nativeStart.call(this);
    };

    const nativeRamp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function linearRampToValueAtTime(
      value: number,
      endTime: number,
    ) {
      probe.gainRamps += 1;
      return nativeRamp.call(this, value, endTime);
    };
  });
}

async function audioSnapshot(page: Page) {
  return page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.() ?? null);
}

async function waitForPackState(page: Page, expected: "loading" | "ready" | "unavailable") {
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().packState))
    .toBe(expected);
}

async function playOpeningCapture(page: Page) {
  const keyboard = page.locator(".game-keyboard-control button");
  await keyboard.focus();
  await pressSequence(keyboard, [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowUp",
    "ArrowUp",
    "Enter",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "Enter",
  ]);
  await waitForRevision(page, 1);
  await pressSequence(keyboard, ["ArrowLeft", "Enter", "ArrowDown", "Enter"]);
  await waitForRevision(page, 2);
  await pressSequence(keyboard, [
    "ArrowRight",
    "ArrowUp",
    "Enter",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "Enter",
  ]);
  await waitForRevision(page, 3);
}

test("the authored pack stays dormant until Start, then real media decodes and starts serially", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await installBrowserAudioProbe(page);
  const requests: string[] = [];
  const responses: Promise<{ bytes: number; contentType: string; path: string; status: number }>[] =
    [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (packPaths.includes(path)) requests.push(path);
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!packPaths.includes(path)) return;
    responses.push(
      response.body().then((body) => ({
        bytes: body.byteLength,
        contentType: response.headers()["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "",
        path,
        status: response.status(),
      })),
    );
  });

  await openCleanGame(page, "low", true);
  expect(requests).toEqual([]);
  await expect
    .poll(() => audioSnapshot(page))
    .toMatchObject({ contextPresent: false, packState: "unrequested", state: "locked" });
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__?.constructed)).toBe(0);

  await startGame(page);
  await waitForPackState(page, "ready");
  await expect
    .poll(() => audioSnapshot(page))
    .toMatchObject({
      authoredBufferCount: 5,
      maxInFlightDecodes: 1,
      maxInFlightFetches: 1,
      musicMode: "authored",
      pendingDecodes: 0,
      pendingFetches: 0,
    });

  const evidence = await Promise.all(responses);
  const responseByPath = new Map(evidence.map((item) => [item.path, item]));
  expect(requests).toEqual(packPaths);
  expect(new Set(requests).size).toBe(packPaths.length);
  for (const path of packPaths) {
    const response = responseByPath.get(path);
    expect(response, `missing cold-cache response for ${path}`).toBeDefined();
    expect(response?.status).toBe(200);
    expect(response?.contentType).toBe(expectedMime.get(path));
    expect(response?.contentType).not.toContain("text/html");
    expect(response?.bytes).toBe(expectedDiskBytes.get(path));
  }

  const transientCues: readonly AudioTransientCueId[] = [
    "system.capture",
    "system.check",
    "system.victory",
    "system.defeat",
    "system.draw",
  ];
  for (const cue of transientCues) {
    expect(await page.evaluate((id) => window.__XIANGQI_AUDIO_TEST__?.playTransient(id), cue)).toBe(
      true,
    );
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__XIANGQI_AUDIO_DEBUG__?.().sourceStartsByKind["authored-transient"],
      ),
    )
    .toBe(5);

  const probe = await page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__!);
  expect(probe.constructed).toBe(1);
  expect(probe.maxPendingDecodes).toBe(1);
  expect(probe.decodeCalls).toHaveLength(5);
  expect(
    probe.decodeCalls.every((decode) => !decode.error && (decode.decodedDuration ?? 0) > 0),
  ).toBe(true);
  expect(probe.mediaSources).toBe(1);
  const music = await page.evaluate(() => {
    const media = window.__XIANGQI_AUDIO_MEDIA__!;
    return { currentTime: media.currentTime, duration: media.duration, paused: media.paused };
  });
  expect(music.paused).toBe(false);
  expect(music.duration).toBeCloseTo(manifest.assets[0]!.durationSeconds, 0);
  expect(music.currentTime).toBeGreaterThanOrEqual(manifest.assets[0]!.loop!.startSeconds);
  expect(music.currentTime).toBeLessThan(manifest.assets[0]!.loop!.endSeconds);
  expect(probe.decodeCalls.every((decode) => (decode.decodedDuration ?? 0) < 3)).toBe(true);
  expect(
    probe.sourceStarts.filter((source) => !source.loop && (source.bufferDuration ?? 0) >= 0.4),
  ).toHaveLength(5);
  expect(probe.gainRamps).toBeGreaterThanOrEqual(1);

  const snapshot = await audioSnapshot(page);
  expect(snapshot?.authoredDecodedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(snapshot?.totalDecodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);

  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("note")).toContainText("秦风灵感的幻想沙盘");
  await expect(page.getByRole("note")).toContainText("并非历史音乐或史实复原");

  await testInfo.attach("audio-cold-cache.json", {
    body: Buffer.from(JSON.stringify({ evidence, probe, snapshot }, null, 2)),
    contentType: "application/json",
  });
});

test("a saved muted start does not initialize audio until the unmute gesture", async ({ page }) => {
  await installBrowserAudioProbe(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (packPaths.includes(path)) requests.push(path);
  });
  await openCleanGame(page, "low", true);
  await page.evaluate(() => {
    const key = "xiangqi3d:settings:v1";
    const settings = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...settings, muted: true }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "开始本机双人对局" }).click();
  await expect(page.locator(".game-keyboard-control button")).toBeFocused();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-audio-state", "muted");
  expect(requests).toEqual([]);
  expect(await audioSnapshot(page)).toMatchObject({
    contextPresent: false,
    packState: "unrequested",
    totalDecodedBytes: 0,
  });
  expect(await page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__?.constructed)).toBe(0);

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("checkbox", { name: "静音" }).uncheck();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-audio-state", "running");
  await waitForPackState(page, "ready");
  await expect.poll(() => audioSnapshot(page)).toMatchObject({ musicMode: "authored" });
  expect(await page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__?.constructed)).toBe(1);
});

test("muting and visibility changes consume transients without catch-up or duplicate music", async ({
  page,
}) => {
  await installBrowserAudioProbe(page);
  await openCleanGame(page, "low", true);
  await startGame(page);
  await waitForPackState(page, "ready");

  const baseline = await audioSnapshot(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("checkbox", { name: "静音" }).check();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-audio-state", "muted");
  expect(await page.evaluate(() => window.__XIANGQI_AUDIO_MEDIA__?.paused)).toBe(true);
  expect(
    await page.evaluate(() => window.__XIANGQI_AUDIO_TEST__?.playTransient("system.check")),
  ).toBe(false);
  await page.getByRole("checkbox", { name: "静音" }).uncheck();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-audio-state", "running");
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_MEDIA__?.paused)).toBe(false);
  expect((await audioSnapshot(page))?.sourceStartsByKind["authored-transient"]).toBe(
    baseline?.sourceStartsByKind["authored-transient"],
  );

  await page.evaluate(() => {
    window.__XIANGQI_TEST_HIDDEN__ = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.__XIANGQI_TEST_HIDDEN__ === true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().foregroundEligible))
    .toBe(false);
  expect(await page.evaluate(() => window.__XIANGQI_AUDIO_MEDIA__?.paused)).toBe(true);
  expect(
    await page.evaluate(() => window.__XIANGQI_AUDIO_TEST__?.playTransient("system.capture")),
  ).toBe(false);
  const startsWhileHidden = (await audioSnapshot(page))?.sourceStarts;

  await page.evaluate(() => {
    window.__XIANGQI_TEST_HIDDEN__ = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_DEBUG__?.().foregroundEligible))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_MEDIA__?.paused)).toBe(false);
  expect((await audioSnapshot(page))?.sourceStarts).toBe(startsWhileHidden);
  expect((await audioSnapshot(page))?.activeSourcesByKind["authored-music"]).toBe(1);

  await page.evaluate(() => {
    window.__XIANGQI_AUDIO_MEDIA__!.currentTime = 67.9;
  });
  await expect
    .poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_MEDIA__?.currentTime ?? 99))
    .toBeLessThan(6);
});

test("the same opening capture remains audible in two consecutive match epochs", async ({
  page,
}) => {
  await installBrowserAudioProbe(page);
  await openCleanGame(page, "low", true);
  await startGame(page);
  await waitForPackState(page, "ready");

  const initialStarts = (await audioSnapshot(page))!.sourceStartsByKind["authored-transient"];
  await playOpeningCapture(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__XIANGQI_AUDIO_DEBUG__?.().sourceStartsByKind["authored-transient"],
      ),
    )
    .toBe(initialStarts + 1);

  await page.getByRole("button", { name: "重新开局" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "重新开局", exact: true })
    .click();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  await playOpeningCapture(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__XIANGQI_AUDIO_DEBUG__?.().sourceStartsByKind["authored-transient"],
      ),
    )
    .toBe(initialStarts + 2);
});
