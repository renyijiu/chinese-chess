import { expect, test, type Page } from "@playwright/test";

import {
  getDeterministicFallbackCandidate,
  runLightweightSearchBatched,
} from "../../lib/xiangqi/ai/lightweight";
import {
  createInitialGame,
  dispatch,
  getPieceAt,
  serializeGame,
  type GameState,
} from "../../lib/xiangqi/index";
import { openCleanGame, waitForRevision } from "./helpers";

const GAME_SAVE_KEY = "xiangqi3d:game:v3";

function applyFixtureMoves(
  moves: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]>,
): GameState {
  let state = createInitialGame();
  for (const [[fromFile, fromRank], [toFile, toRank]] of moves) {
    const result = dispatch(state, {
      type: "move",
      expectedRevision: state.revision,
      from: { file: fromFile, rank: fromRank },
      to: { file: toFile, rank: toRank },
    });
    if (result.error) throw new Error(`Invalid browser fixture move: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

function computerSaveFixture(state: GameState, seed: string) {
  return JSON.stringify({
    kind: "xiangqi-game-save",
    version: 3,
    savedAt: 1,
    revision: state.revision,
    serialized: serializeGame(state),
    match: {
      mode: "computer",
      matchId: `fixture-${seed}`,
      seed,
      dieResult: 4,
      humanSide: "black",
      requestedDifficulty: "easy",
      effectiveTier: "lightweight-easy",
    },
  });
}

const AI_CHECK_CAPTURE_SEED = "check-capture-0";
const AI_CHECK_CAPTURE_STATE = applyFixtureMoves([
  [
    [1, 2],
    [4, 2],
  ],
  [
    [0, 6],
    [0, 5],
  ],
  [
    [4, 3],
    [4, 4],
  ],
  [
    [2, 6],
    [2, 5],
  ],
  [
    [4, 4],
    [4, 5],
  ],
  [
    [7, 9],
    [6, 7],
  ],
]);
const AI_CHECK_CAPTURE_FIXTURE = computerSaveFixture(AI_CHECK_CAPTURE_STATE, AI_CHECK_CAPTURE_SEED);
const AI_CHECK_CAPTURE_MOVE = {
  from: { file: 4, rank: 5 },
  to: { file: 4, rank: 6 },
} as const;

function searchCheckCaptureAtDepth(depthCeiling: number) {
  return runLightweightSearchBatched(AI_CHECK_CAPTURE_STATE, {
    tier: "lightweight-easy",
    seed: AI_CHECK_CAPTURE_SEED,
    nodeBudget: 100_000,
    depthCeiling,
    safetyDeadlineMs: 1,
    batchNodes: 128,
    isCancelled: () => false,
    // Keep this fixture contract independent from host performance.
    now: () => 0,
    yieldTask: async () => undefined,
  });
}

async function forceNextDie(page: Page, dieResult: 1 | 2 | 3 | 4 | 5 | 6) {
  await page.addInitScript((value) => {
    let first = true;
    const original = Crypto.prototype.getRandomValues;
    Crypto.prototype.getRandomValues = function getRandomValues<T extends ArrayBufferView | null>(
      array: T,
    ): T {
      if (first && array instanceof Uint8Array) {
        first = false;
        array.fill(value - 1);
        return array as T;
      }
      return Reflect.apply(original, this, [array]) as T;
    };
  }, dieResult);
}

async function forceEveryDie(page: Page, dieResult: 1 | 2 | 3 | 4 | 5 | 6) {
  await page.addInitScript((value) => {
    const original = Crypto.prototype.getRandomValues;
    Crypto.prototype.getRandomValues = function getRandomValues<T extends ArrayBufferView | null>(
      array: T,
    ): T {
      if (array instanceof Uint8Array && array.byteLength === 1) {
        array[0] = value - 1;
        return array as T;
      }
      return Reflect.apply(original, this, [array]) as T;
    };
  }, dieResult);
}

async function installFixture(page: Page, raw: string) {
  await openCleanGame(page, "low", true);
  await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
    key: GAME_SAVE_KEY,
    value: raw,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function chooseComputerMode(page: Page, difficulty: "简单" | "标准" | "困难" | "大师") {
  await page.getByRole("button", { name: "人机对战" }).click();
  await page.getByRole("radio", { name: difficulty, exact: true }).check();
}

test("keeps the capture-and-check fixture stable across Easy search cutoffs", async () => {
  const completedSearches = await Promise.all([1, 2, 3].map(searchCheckCaptureAtDepth));
  completedSearches.forEach((result, index) => {
    expect(result.completedDepth).toBe(index + 1);
  });
  const candidates = [
    getDeterministicFallbackCandidate(AI_CHECK_CAPTURE_STATE),
    ...completedSearches.map((result) => result.candidate),
  ];

  for (const candidate of candidates) {
    expect(candidate).toEqual(AI_CHECK_CAPTURE_MOVE);
  }
  expect(getPieceAt(AI_CHECK_CAPTURE_STATE, AI_CHECK_CAPTURE_MOVE.to)?.side).toBe("black");
  const result = dispatch(AI_CHECK_CAPTURE_STATE, {
    type: "move",
    expectedRevision: AI_CHECK_CAPTURE_STATE.revision,
    ...AI_CHECK_CAPTURE_MOVE,
  });
  if (result.error) throw new Error(`Invalid capture-and-check fixture: ${result.error.code}`);
  expect(result.state.status).toEqual({ kind: "playing", check: "black" });
});

test("rolls and persists an odd die before confirming a red-side computer match", async ({
  page,
}) => {
  await forceNextDie(page, 5);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "简单");

  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await expect(page.getByRole("status", { name: "阵营分配结果" })).toContainText("5");
  await expect(page.getByRole("status", { name: "阵营分配结果" })).toContainText("红方");
  await expect(page.getByRole("button", { name: "以红方开始对局" })).toBeEnabled();

  const persisted = await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v3"));
  expect(persisted).toContain('"dieResult":5');
  expect(persisted).toContain('"humanSide":"red"');

  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await expect(page.getByRole("button", { name: "悔棋" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "认输" })).toBeEnabled();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("简单");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
});

test("restores a persisted die confirmation without rerolling", async ({ page }) => {
  await forceNextDie(page, 3);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "标准");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await expect(page.getByRole("button", { name: "以红方开始对局" })).toBeEnabled();
  const saved = await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v3"));

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "阵营分配结果" })).toContainText("3");
  await expect(page.getByRole("button", { name: "以红方开始对局" })).toBeEnabled();
  await expect(page.locator(".computer-die")).not.toHaveAttribute("data-rolling", "true");
  expect(await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v3"))).toBe(saved);

  await page.getByRole("button", { name: "以红方开始对局" }).click();
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
  await waitForRevision(page, 2);
  await expect(page.locator(".game-history li")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("xiangqi3d:game:v3");
        return raw ? JSON.parse(raw).match.effectiveTier : null;
      }),
    )
    .toBe("lightweight-normal");
});

test("orients for human black and lets the computer open while controls stay responsive", async ({
  page,
}) => {
  const lightweightWorkerResponse = page.waitForResponse((response) =>
    /lightweight\.worker(?:-[A-Za-z0-9_-]+\.js|\.ts)/.test(response.url()),
  );
  await forceNextDie(page, 4);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "困难");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以黑方开始对局" }).click();

  await expect(page.getByRole("button", { name: "切换到红方视角" })).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("region", { name: "对局设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新开局" })).toBeEnabled();
  await page.getByRole("button", { name: "重新开局" }).click();
  await expect(page.getByRole("alertdialog", { name: "确认重新开局？" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText(
    /思考|落子|结算|轮到你/,
  );
  await waitForRevision(page, 1);
  const workerResponse = await lightweightWorkerResponse;
  expect(workerResponse.status()).toBe(200);
  expect((await workerResponse.allHeaders())["cross-origin-embedder-policy"]).toBe("require-corp");
  await expect(page.getByRole("button", { name: "认输" })).toBeEnabled();
  await page.getByRole("button", { name: "认输" }).click();
  await page.getByRole("button", { name: "确认认输" }).click();
  await expect(page.getByRole("heading", { name: /红方胜 · 认输/ })).toBeVisible();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "2");
  await page.waitForTimeout(500);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "2");
});

test("resumes a computer turn and presents one authoritative capture and check", async ({
  page,
}) => {
  await installFixture(page, AI_CHECK_CAPTURE_FIXTURE);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window.__XIANGQI_AUDIO_DEBUG__ && window.__XIANGQI_PRESENTATION_DEBUG__),
      ),
    )
    .toBe(true);
  const baselineAudio = await page.evaluate(
    () => window.__XIANGQI_AUDIO_DEBUG__?.().sourceStartsByCue,
  );
  await page.getByRole("button", { name: "继续对局" }).click();
  await waitForRevision(page, 7);
  await expect(page.locator(".game-history li")).toHaveCount(7);
  await expect(page.locator(".game-history li").first()).toContainText("吃");
  await expect(page.locator(".game-turn-card")).toHaveAttribute("data-check", "true");
  await expect(page.locator(".game-turn-card small")).toHaveText("黑方被将军");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("xiangqi3d:game:v3");
        return raw ? JSON.parse(raw).revision : null;
      }),
    )
    .toBe(7);
  const captureEvidence = await page.evaluate(() => ({
    audio: window.__XIANGQI_AUDIO_DEBUG__?.().sourceStartsByCue,
    presentation: window.__XIANGQI_PRESENTATION_DEBUG__?.(),
  }));
  expect(captureEvidence.audio?.["system.capture"] ?? 0).toBe(
    (baselineAudio?.["system.capture"] ?? 0) + 1,
  );
  expect(captureEvidence.audio?.["system.check"] ?? 0).toBe(
    (baselineAudio?.["system.check"] ?? 0) + 1,
  );
  expect(captureEvidence.presentation).toMatchObject({
    activeActionId: null,
    activeTimelines: 0,
    timers: 0,
  });
  expect(
    captureEvidence.presentation?.completedActionIds.filter((id) => id.includes(":7:0:")),
  ).toHaveLength(1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "继续对局" }).click();
  await waitForRevision(page, 7);
  await page.waitForTimeout(500);
  await expect(page.locator(".game-history li")).toHaveCount(7);
  expect(
    await page.evaluate(() => window.__XIANGQI_PRESENTATION_DEBUG__?.().completedActionIds ?? []),
  ).toEqual([]);
});

test("pauses a hidden computer opening and starts exactly once after restoration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    (
      window as typeof window & { __XIANGQI_SET_TEST_HIDDEN__?: (value: boolean) => void }
    ).__XIANGQI_SET_TEST_HIDDEN__ = (value) => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
  await forceNextDie(page, 4);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "简单");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.evaluate(() =>
    (
      window as typeof window & { __XIANGQI_SET_TEST_HIDDEN__?: (value: boolean) => void }
    ).__XIANGQI_SET_TEST_HIDDEN__?.(true),
  );
  await page.getByRole("button", { name: "以黑方开始对局" }).click();
  await page.waitForTimeout(700);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("页面已隐藏");

  await page.evaluate(() =>
    (
      window as typeof window & { __XIANGQI_SET_TEST_HIDDEN__?: (value: boolean) => void }
    ).__XIANGQI_SET_TEST_HIDDEN__?.(false),
  );
  await waitForRevision(page, 1);
  await page.waitForTimeout(500);
  await expect(page.locator(".game-history li")).toHaveCount(1);
});

test("keeps malformed Worker output recoverable without committing a move", async ({ page }) => {
  await page.addInitScript(() => {
    class MalformedWorker extends EventTarget {
      postMessage(message: unknown) {
        const input = message as {
          generation?: number;
          matchId?: string;
          requestId?: string;
          type?: string;
        };
        const data =
          input.type === "stop"
            ? {
                protocolVersion: 1,
                type: "stopped",
                matchId: input.matchId,
                generation: input.generation,
                requestId: input.requestId,
              }
            : { type: "malformed-result" };
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
      }
      terminate() {}
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: MalformedWorker,
    });
  });
  await forceNextDie(page, 4);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "简单");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以黑方开始对局" }).click();
  await page.waitForTimeout(1_200);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("当前局面保持不变");
  await expect(page.getByRole("button", { name: "重新开局" })).toBeEnabled();
});

test("discloses Master fallback, hides computer undo, and preserves local undo", async ({
  page,
}) => {
  await page.route("**/engines/fairy-stockfish-nnue/1.1.12/manifest.json", (route) =>
    route.fulfill({
      body: "Master unavailable in this scenario",
      contentType: "text/plain",
      status: 404,
    }),
  );
  await forceNextDie(page, 5);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "大师");
  await expect(page.getByRole("note")).toContainText(/首次使用.*下载/);
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("大师");
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("困难");
  await expect(page.getByRole("button", { name: "悔棋" })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("xiangqi3d:game:v3");
        return raw ? JSON.parse(raw).match.effectiveTier : null;
      }),
    )
    .toBe("lightweight-hard");

  await page.evaluate(() => {
    window.localStorage.removeItem("xiangqi3d:game:v3");
    window.localStorage.removeItem("xiangqi3d:game:v3:backup");
    window.localStorage.removeItem("xiangqi3d:game:v1");
    window.localStorage.removeItem("xiangqi3d:game:v1:backup");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "开始本机双人对局" }).click();
  await expect(page.getByRole("button", { name: "悔棋" })).toBeVisible();
});

test("boots the isolated verified Master Worker and commits one legal opening move", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const failedEngineRequests: string[] = [];
  page.on("requestfailed", (request) => {
    if (/\/(?:engines\/fairy-stockfish-nnue|workers\/xiangqi-master)/.test(request.url())) {
      failedEngineRequests.push(request.url());
    }
  });
  await forceNextDie(page, 4);
  await openCleanGame(page, "low", true);
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("xiangqi-master:")) await caches.delete(name);
    }
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        isolated: crossOriginIsolated,
        secure: isSecureContext,
        shared: typeof SharedArrayBuffer === "function",
      })),
    )
    .toEqual({ isolated: true, secure: true, shared: true });

  await chooseComputerMode(page, "大师");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以黑方开始对局" }).click();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("大师");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1", {
    timeout: 40_000,
  });
  await expect(page.locator(".game-keyboard-control button")).toHaveAttribute(
    "aria-disabled",
    "false",
    { timeout: 20_000 },
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("xiangqi3d:game:v3");
        return raw ? JSON.parse(raw).match.effectiveTier : null;
      }),
    )
    .toBe("fairy-master");
  expect(failedEngineRequests).toEqual([]);
});

test("keeps setup and presentation controls usable at 390 by 844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await forceNextDie(page, 5);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "标准");

  const menu = page.getByRole("dialog", { name: "兵临九宫" });
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(844);
  const rollBox = await page.getByRole("button", { name: "掷骰决定阵营" }).boundingBox();
  expect(rollBox?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await page.getByRole("button", { name: "设置" }).click();
  const settingsBox = await page.getByRole("region", { name: "对局设置" }).boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(settingsBox!.x).toBeGreaterThanOrEqual(0);
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(390);
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(844);
});

test("keeps one Worker and stable lifecycle resources across 100 computer openings", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_AI_LIFECYCLE !== "1",
    "long AI lifecycle coverage runs through test:ai:lifecycle",
  );
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    let activeWorkers = 0;
    let createdWorkers = 0;
    let terminatedWorkers = 0;
    let activeTimers = 0;
    const timerHandles = new Set<number>();
    const visibilityListeners = new Set<EventListenerOrEventListenerObject>();
    const nativeDocumentAdd = document.addEventListener.bind(document);
    const nativeDocumentRemove = document.removeEventListener.bind(document);

    class TrackedWorker extends NativeWorker {
      private tracked = true;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        activeWorkers += 1;
        createdWorkers += 1;
      }
      override terminate() {
        if (this.tracked) {
          this.tracked = false;
          activeWorkers -= 1;
          terminatedWorkers += 1;
        }
        super.terminate();
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: TrackedWorker });
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      let handle = 0;
      const wrapped = (...callbackArgs: unknown[]) => {
        if (timerHandles.delete(handle)) activeTimers -= 1;
        if (typeof handler === "function") handler(...callbackArgs);
        else Function(handler)();
      };
      handle = nativeSetTimeout(wrapped, timeout, ...args);
      timerHandles.add(handle);
      activeTimers += 1;
      return handle;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((handle?: number) => {
      if (typeof handle === "number" && timerHandles.delete(handle)) activeTimers -= 1;
      nativeClearTimeout(handle);
    }) as typeof window.clearTimeout;
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "visibilitychange") visibilityListeners.add(listener);
      nativeDocumentAdd(type, listener, options);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === "visibilitychange") visibilityListeners.delete(listener);
      nativeDocumentRemove(type, listener, options);
    }) as typeof document.removeEventListener;
    (
      window as typeof window & { __XIANGQI_AI_LIFECYCLE__?: () => unknown }
    ).__XIANGQI_AI_LIFECYCLE__ = () => ({
      activeTimers,
      activeWorkers,
      createdWorkers,
      terminatedWorkers,
      visibilityListeners: visibilityListeners.size,
    });
  });
  await forceEveryDie(page, 4);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "简单");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以黑方开始对局" }).click();
  await waitForRevision(page, 1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const sampleHeap = async (opening: number) => {
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    const used = metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
    expect(used, "Chromium must expose JSHeapUsedSize for lifecycle verification").toBeDefined();
    return { opening, jsHeapUsedBytes: used! };
  };
  const baseline = await page.evaluate(() =>
    (
      window as typeof window & { __XIANGQI_AI_LIFECYCLE__?: () => unknown }
    ).__XIANGQI_AI_LIFECYCLE__?.(),
  );
  const cacheKeys = await page.evaluate(() => caches.keys());
  const heapSamples = [await sampleHeap(1)];

  for (let opening = 2; opening <= 100; opening += 1) {
    await page.getByRole("button", { name: "重新开局" }).click();
    await page
      .getByRole("alertdialog", { name: "确认重新开局？" })
      .getByRole("button", { name: "重新开局", exact: true })
      .click();
    await page.getByRole("button", { name: "以黑方开始对局" }).click();
    await waitForRevision(page, 1);
    if (opening % 10 === 0) {
      const sample = await page.evaluate(() =>
        (
          window as typeof window & { __XIANGQI_AI_LIFECYCLE__?: () => { activeWorkers: number } }
        ).__XIANGQI_AI_LIFECYCLE__?.(),
      );
      expect(sample?.activeWorkers).toBe(1);
    }
    if (opening === 50) heapSamples.push(await sampleHeap(opening));
  }

  await page.waitForTimeout(500);
  const settled = await page.evaluate(() =>
    (
      window as typeof window & {
        __XIANGQI_AI_LIFECYCLE__?: () => {
          activeTimers: number;
          activeWorkers: number;
          createdWorkers: number;
          terminatedWorkers: number;
          visibilityListeners: number;
        };
      }
    ).__XIANGQI_AI_LIFECYCLE__?.(),
  );
  expect(settled).toMatchObject({
    activeWorkers: 1,
    createdWorkers: 100,
    terminatedWorkers: 99,
  });
  expect(settled!.visibilityListeners).toBe(
    (baseline as { visibilityListeners: number }).visibilityListeners,
  );
  expect(settled!.activeTimers).toBeLessThanOrEqual(
    (baseline as { activeTimers: number }).activeTimers + 2,
  );
  expect(await page.evaluate(() => caches.keys())).toEqual(cacheKeys);
  heapSamples.push(await sampleHeap(100));
  const heapBaseline = heapSamples[0]?.jsHeapUsedBytes;
  if (heapBaseline === undefined) throw new Error("AI lifecycle heap baseline was not captured");
  const heapFinal = heapSamples.at(-1)!.jsHeapUsedBytes;
  expect(heapFinal).toBeLessThanOrEqual(heapBaseline + 32 * 1024 * 1024);
  await testInfo.attach("ai-lifecycle.json", {
    body: JSON.stringify({ baseline, settled, cacheKeys, heapSamples }, null, 2),
    contentType: "application/json",
  });
  console.info(
    `AI_LIFECYCLE_EVIDENCE ${JSON.stringify({ baseline, settled, cacheKeys, heapSamples })}`,
  );
});
