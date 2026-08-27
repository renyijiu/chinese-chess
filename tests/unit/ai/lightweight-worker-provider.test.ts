import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpponentRequestV1 } from "../../../lib/xiangqi/ai/index";
import {
  createLightweightWorker,
  LightweightWorkerProvider,
  type OpponentWorkerLike,
} from "../../../components/xiangqi/ai/LightweightWorkerProvider";

class FakeWorker implements OpponentWorkerLike {
  readonly posted: unknown[] = [];
  terminated = 0;
  readonly messages = new Set<(event: MessageEvent<unknown>) => void>();
  readonly errors = new Set<() => void>();

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

const request: OpponentRequestV1 = {
  protocolVersion: 1,
  type: "search",
  matchId: "match-a",
  generation: 1,
  requestId: "request-a",
  positionRevision: 0,
  serializedGame: "serialized",
  positionFingerprint: "a".repeat(64),
  sideToMove: "red",
  tier: "lightweight-easy",
  seed: "seed-a",
  nodeBudget: 10,
  depthCeiling: 1,
  safetyDeadlineMs: 100,
};

describe("LightweightWorkerProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("constructs its default Worker from the bundler URL without a file-scheme base", () => {
    const worker = new FakeWorker();
    let receivedUrl: string | URL | undefined;
    let receivedOptions: WorkerOptions | undefined;
    function WorkerStub(url: string | URL, options?: WorkerOptions) {
      receivedUrl = url;
      receivedOptions = options;
      return worker;
    }
    vi.stubGlobal("Worker", WorkerStub);

    expect(createLightweightWorker()).toBe(worker);
    expect(String(receivedUrl)).toContain("lightweight.worker");
    expect(String(receivedUrl)).not.toMatch(/^file:/);
    expect(receivedOptions).toMatchObject({ type: "module", name: "xiangqi-lightweight-opponent" });
  });

  it("strictly decodes unknown output and resolves only the matching result", async () => {
    const worker = new FakeWorker();
    const provider = new LightweightWorkerProvider(() => worker);
    const outcome = provider.search(request);
    worker.emit({ ...request, type: "result" });
    worker.emit({
      protocolVersion: 1,
      type: "result",
      matchId: "other",
      generation: 1,
      requestId: "request-a",
      positionRevision: 0,
      positionFingerprint: "a".repeat(64),
      sideToMove: "red",
      candidate: { from: { file: 0, rank: 3 }, to: { file: 0, rank: 4 } },
      completedDepth: 1,
      nodes: 10,
      score: 1,
    });
    worker.emit({
      protocolVersion: 1,
      type: "result",
      matchId: "match-a",
      generation: 1,
      requestId: "request-a",
      positionRevision: 0,
      positionFingerprint: "a".repeat(64),
      sideToMove: "red",
      candidate: { from: { file: 0, rank: 3 }, to: { file: 0, rank: 4 } },
      completedDepth: 1,
      nodes: 10,
      score: 1,
    });
    await expect(outcome).resolves.toMatchObject({ ok: true, result: { requestId: "request-a" } });
  });

  it("enforces one search, cooperatively stops, and disposes idempotently", async () => {
    const worker = new FakeWorker();
    const provider = new LightweightWorkerProvider(() => worker);
    const first = provider.search(request);
    await expect(provider.search({ ...request, requestId: "request-b" })).resolves.toMatchObject({
      ok: false,
      failure: { code: "invalid-request" },
    });

    const stopped = provider.stop(request);
    expect(worker.posted.at(-1)).toMatchObject({ type: "stop", requestId: "request-a" });
    worker.emit({
      protocolVersion: 1,
      type: "stopped",
      matchId: "match-a",
      generation: 1,
      requestId: "request-a",
    });
    await expect(stopped).resolves.toBeUndefined();
    await expect(first).resolves.toMatchObject({ ok: false, failure: { code: "cancelled" } });

    provider.dispose();
    provider.dispose();
    expect(worker.terminated).toBe(1);
    expect(worker.messages.size).toBe(0);
  });

  it("shares repeated stop calls and settles them when a terminal result wins the race", async () => {
    const worker = new FakeWorker();
    const provider = new LightweightWorkerProvider(() => worker);
    const search = provider.search(request);
    const firstStop = provider.stop(request);
    const secondStop = provider.stop(request);
    expect(firstStop).toBe(secondStop);
    expect(worker.posted.filter((message) => (message as { type?: string }).type === "stop")).toHaveLength(1);

    worker.emit({
      protocolVersion: 1,
      type: "result",
      matchId: "match-a",
      generation: 1,
      requestId: "request-a",
      positionRevision: 0,
      positionFingerprint: "a".repeat(64),
      sideToMove: "red",
      candidate: { from: { file: 0, rank: 3 }, to: { file: 0, rank: 4 } },
      completedDepth: 1,
      nodes: 10,
      score: 1,
    });

    await expect(search).resolves.toMatchObject({ ok: true });
    await expect(firstStop).resolves.toBeUndefined();
    await expect(secondStop).resolves.toBeUndefined();
  });
});
