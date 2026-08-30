import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialGame, serializeGame, type Square } from "../../../lib/xiangqi/index";
import type { OpponentRequestV1 } from "../../../lib/xiangqi/ai/index";
import {
  MasterEngineAdapter,
  assessMasterCapabilities,
  gameToXiangqiFen,
  squareFromUci,
  squareToUci,
  type MasterEngineAdapterOptions,
  type MasterHostWorkerLike,
} from "../../../components/xiangqi/ai/MasterEngineAdapter";

class FakeMasterWorker implements MasterHostWorkerLike {
  readonly posted: unknown[] = [];
  readonly messages = new Set<(event: MessageEvent<unknown>) => void>();
  readonly errors = new Set<() => void>();
  terminated = 0;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | (() => void)): void {
    if (type === "message") this.messages.add(listener as (event: MessageEvent<unknown>) => void);
    else this.errors.add(listener as () => void);
  }

  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | (() => void)): void {
    if (type === "message") this.messages.delete(listener as (event: MessageEvent<unknown>) => void);
    else this.errors.delete(listener as () => void);
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: unknown): void {
    for (const listener of this.messages) listener({ data } as MessageEvent<unknown>);
  }
}

const emptyAssets = {
  cacheName: "test-cache",
  manifest: {
    schema: "xiangqi-engine-assets/v1" as const,
    engineId: "fairy-stockfish-nnue",
    version: "1.1.12",
    runtimeBaseUrl: "/engines/fairy-stockfish-nnue/1.1.12/",
    runtimeFiles: [],
  },
  files: {
    "stockfish.js": new ArrayBuffer(1),
    "stockfish.wasm": new ArrayBuffer(1),
    "stockfish.worker.js": new ArrayBuffer(1),
    "xiangqi-c07e94a5c7cb.nnue": new ArrayBuffer(1),
  },
};

const initialSerializedGame = serializeGame(createInitialGame());

const request: OpponentRequestV1 = {
  protocolVersion: 1,
  type: "search",
  matchId: "match-a",
  generation: 3,
  requestId: "request-a",
  positionRevision: 0,
  serializedGame: initialSerializedGame,
  positionFingerprint: createHash("sha256").update(initialSerializedGame).digest("hex"),
  sideToMove: "red",
  tier: "fairy-master",
  seed: "seed",
  nodeBudget: 50,
  depthCeiling: 2,
  safetyDeadlineMs: 500,
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function initialize(
  worker: FakeMasterWorker,
  options: Partial<MasterEngineAdapterOptions> = {},
) {
  const adapter = new MasterEngineAdapter({
    assetLoader: async () => emptyAssets,
    handshakeTimeoutMs: 5_000,
    workerFactory: () => worker,
    ...options,
  });
  const pending = adapter.initialize();
  await flush();
  expect(worker.posted.at(-1)).toMatchObject({ type: "boot" });
  worker.emit({ type: "booted" });
  await flush();
  expect(worker.posted.at(-1)).toEqual({ type: "command", line: "uci" });
  worker.emit({ type: "line", line: "info string harmless noise" });
  worker.emit({ type: "line", line: "option name UCI_Variant type combo default chess var xiangqi" });
  worker.emit({ type: "line", line: "option name EvalFile type string default <empty>" });
  worker.emit({ type: "line", line: "uciok" });
  worker.emit({ type: "line", line: "uciok" });
  await vi.waitFor(() => expect(worker.posted.at(-1)).toEqual({ type: "command", line: "isready" }));
  expect(worker.posted.slice(-3)).toEqual([
    { type: "command", line: "setoption name UCI_Variant value xiangqi" },
    { type: "command", line: "setoption name EvalFile value /xiangqi-c07e94a5c7cb.nnue" },
    { type: "command", line: "isready" },
  ]);
  worker.emit({ type: "line", line: "readyok" });
  await pending;
  return adapter;
}

describe("Master UCI adapter", () => {
  beforeEach(() => vi.useRealTimers());

  it("round-trips every square, maps red to UCI white, and serializes the standard position", () => {
    for (let file = 0; file < 9; file += 1) {
      for (let rank = 0; rank < 10; rank += 1) {
        const square: Square = { file, rank };
        expect(squareFromUci(squareToUci(square))).toEqual(square);
      }
    }
    expect(gameToXiangqiFen(createInitialGame())).toBe(
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
    );
  });

  it("accepts noisy duplicate handshake tokens and returns a parsed legal candidate", async () => {
    const worker = new FakeMasterWorker();
    const adapter = await initialize(worker);
    const beforeSearch = worker.posted.length;
    const outcome = adapter.search(request);
    await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(beforeSearch + 2));
    expect(worker.posted.at(-2)).toEqual({ type: "command", line: "ucinewgame" });
    expect(worker.posted.at(-1)).toEqual({ type: "command", line: "isready" });
    worker.emit({ type: "line", line: "readyok" });
    await vi.waitFor(() => expect(worker.posted.at(-1)).toEqual({ type: "command", line: "go depth 2 nodes 50" }));
    expect(worker.posted.at(-2)).toMatchObject({ type: "command", line: expect.stringMatching(/^position fen /) });
    expect(worker.posted.at(-1)).toEqual({ type: "command", line: "go depth 2 nodes 50" });
    worker.emit({ type: "line", line: "info depth 2 score cp 17 nodes 41 pv b1c3" });
    worker.emit({ type: "line", line: "bestmove b1c3 ponder h10g8" });

    await expect(outcome).resolves.toMatchObject({
      ok: true,
      result: {
        candidate: { from: { file: 1, rank: 0 }, to: { file: 2, rank: 2 } },
        completedDepth: 2,
        nodes: 41,
        score: 17,
      },
    });
  });

  it("drains a duplicate readyok before opening the next readiness phase", async () => {
    const worker = new FakeMasterWorker();
    const adapter = new MasterEngineAdapter({
      assetLoader: async () => emptyAssets,
      handshakeTimeoutMs: 250,
      workerFactory: () => worker,
    });
    const initialization = adapter.initialize();
    await flush();
    worker.emit({ type: "booted" });
    await flush();
    worker.emit({ type: "line", line: "option name UCI_Variant type combo var xiangqi" });
    worker.emit({ type: "line", line: "option name EvalFile type string" });
    worker.emit({ type: "line", line: "uciok" });
    await new Promise((resolve) => setTimeout(resolve, 1));
    worker.emit({ type: "line", line: "readyok" });
    worker.emit({ type: "line", line: "readyok" });
    await initialization;

    const beforeSearch = worker.posted.length;
    const outcome = adapter.search(request);
    await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(beforeSearch + 2));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(worker.posted.at(-1)).toEqual({ type: "command", line: "isready" });
    worker.emit({ type: "line", line: "readyok" });
    await vi.waitFor(() => expect(worker.posted.at(-1)).toMatchObject({ line: expect.stringMatching(/^go /) }));
    worker.emit({ type: "line", line: "bestmove b1c3" });
    await expect(outcome).resolves.toMatchObject({ ok: true });
  });

  it("fails closed when a required UCI handshake token never arrives", async () => {
    const worker = new FakeMasterWorker();
    const adapter = new MasterEngineAdapter({
      assetLoader: async () => emptyAssets,
      handshakeTimeoutMs: 10,
      workerFactory: () => worker,
    });
    const initialization = adapter.initialize();
    await flush();
    worker.emit({ type: "booted" });

    await expect(initialization).rejects.toThrow(/uciok/i);
    expect(worker.terminated).toBe(1);
  });

  it("rejects a syntactically valid bestmove that is illegal in the authoritative game", async () => {
    const worker = new FakeMasterWorker();
    const adapter = await initialize(worker);
    const beforeSearch = worker.posted.length;
    const outcome = adapter.search({ ...request, requestId: "request-illegal" });
    await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(beforeSearch + 2));
    expect(worker.posted.at(-1)).toEqual({ type: "command", line: "isready" });
    worker.emit({ type: "line", line: "readyok" });
    await vi.waitFor(() => expect(worker.posted.at(-1)).toMatchObject({ line: expect.stringMatching(/^go /) }));
    worker.emit({ type: "line", line: "bestmove a1a10" });

    await expect(outcome).resolves.toMatchObject({ ok: false, failure: { code: "failed" } });
  });

  it("stops, terminates, and reports timeout when the engine misses its safety deadline", async () => {
    const worker = new FakeMasterWorker();
    const adapter = await initialize(worker, { stopGraceMs: 1 });
    const beforeSearch = worker.posted.length;
    const outcome = adapter.search({
      ...request,
      requestId: "request-timeout",
      safetyDeadlineMs: 1,
    });
    await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(beforeSearch + 2));
    expect(worker.posted.at(-1)).toEqual({ type: "command", line: "isready" });
    worker.emit({ type: "line", line: "readyok" });
    await vi.waitFor(() => expect(worker.posted).toContainEqual({ type: "command", line: "stop" }));

    await expect(outcome).resolves.toMatchObject({ ok: false, failure: { code: "timeout" } });
    expect(worker.terminated).toBe(1);
  });

  it("cancels a request before asynchronous position validation completes", async () => {
    const worker = new FakeMasterWorker();
    const adapter = new MasterEngineAdapter({
      assetLoader: async () => emptyAssets,
      workerFactory: () => worker,
    });
    const pending = adapter.search({ ...request, requestId: "request-pre-validation-stop" });

    await adapter.stop({ ...request, requestId: "request-pre-validation-stop" });

    await expect(pending).resolves.toMatchObject({ ok: false, failure: { code: "cancelled" } });
    expect(worker.posted).toEqual([]);
  });

  it("cooperatively stops once, then terminates and recreates after grace expiry", async () => {
    const first = new FakeMasterWorker();
    const second = new FakeMasterWorker();
    const workers = [first, second];
    const adapter = new MasterEngineAdapter({
      assetLoader: async () => emptyAssets,
      handshakeTimeoutMs: 100,
      stopGraceMs: 1,
      workerFactory: () => workers.shift()!,
    });
    const initialization = adapter.initialize();
    await flush();
    first.emit({ type: "booted" });
    await flush();
    first.emit({ type: "line", line: "option name UCI_Variant type combo var xiangqi" });
    first.emit({ type: "line", line: "option name EvalFile type string" });
    first.emit({ type: "line", line: "uciok" });
    await vi.waitFor(() => expect(first.posted.at(-1)).toEqual({ type: "command", line: "isready" }));
    first.emit({ type: "line", line: "readyok" });
    await initialization;
    const beforeSearch = first.posted.length;
    const search = adapter.search(request);
    await vi.waitFor(() => expect(first.posted.length).toBeGreaterThanOrEqual(beforeSearch + 2));
    first.emit({ type: "line", line: "readyok" });
    await vi.waitFor(() => expect(first.posted.at(-1)).toMatchObject({
      type: "command",
      line: expect.stringMatching(/^go /),
    }));
    const stopped = adapter.stop(request);
    expect(first.posted.at(-1)).toEqual({ type: "command", line: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(stopped).resolves.toBeUndefined();
    await expect(search).resolves.toMatchObject({ ok: false, failure: { code: "cancelled" } });
    expect(first.terminated).toBe(1);

    const reinitialization = adapter.initialize();
    await flush();
    expect(second.posted.at(-1)).toMatchObject({ type: "boot" });
    adapter.dispose();
    await expect(reinitialization).rejects.toThrow(/disposed/i);
  });

  it("rejects unsupported capability sets before downloading or starting a Worker", async () => {
    expect(assessMasterCapabilities({
      cacheStorage: undefined,
      crossOriginIsolated: false,
      isSecureContext: false,
      sharedArrayBuffer: undefined,
      validateWasm: () => false,
      webAssembly: undefined,
    })).toEqual({
      supported: false,
      missing: ["secure-context", "cross-origin-isolation", "shared-array-buffer", "webassembly", "wasm-simd", "cache-storage"],
    });
    expect(assessMasterCapabilities({
      cacheStorage: { delete: async () => true, keys: async () => [], open: async () => { throw new Error("unused"); } },
      crossOriginIsolated: true,
      isSecureContext: true,
      sharedArrayBuffer: SharedArrayBuffer,
      validateWasm: (bytes) => WebAssembly.validate(bytes),
      webAssembly: WebAssembly,
    })).toEqual({ supported: true, missing: [] });
  });
});
