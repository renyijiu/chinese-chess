import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { serializeGame, createInitialGame } from "../../../lib/xiangqi/index";
import type {
  OpponentIdentityV1,
  OpponentProvider,
  OpponentProviderOutcome,
  OpponentRequestV1,
  OpponentTier,
} from "../../../lib/xiangqi/ai/index";
import {
  OpponentCoordinator,
  type OpponentCommitContext,
  type OpponentCommitReceipt,
  type OpponentCoordinatorSnapshot,
} from "../../../components/xiangqi/ai/OpponentCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class FakeProvider implements OpponentProvider {
  readonly searches: OpponentRequestV1[] = [];
  readonly stops: OpponentIdentityV1[] = [];
  readonly outcomes: Array<ReturnType<typeof deferred<OpponentProviderOutcome>>> = [];
  stopResult: Promise<void> = Promise.resolve();
  disposed = 0;
  onStop: (() => void) | null = null;

  search(request: OpponentRequestV1): Promise<OpponentProviderOutcome> {
    this.searches.push(request);
    const outcome = deferred<OpponentProviderOutcome>();
    this.outcomes.push(outcome);
    return outcome.promise;
  }

  stop(identity: OpponentIdentityV1): Promise<void> {
    this.stops.push(identity);
    this.onStop?.();
    return this.stopResult;
  }

  dispose(): void {
    this.disposed += 1;
  }

  resolveResult(index = 0, overrides: Partial<OpponentRequestV1> = {}): void {
    const search = this.searches[index];
    const outcome = this.outcomes[index];
    if (!search || !outcome) throw new Error(`Missing fake provider search ${index}`);
    const request = { ...search, ...overrides };
    outcome.resolve({
      ok: true,
      result: {
        protocolVersion: 1,
        type: "result",
        matchId: request.matchId,
        generation: request.generation,
        requestId: request.requestId,
        positionRevision: request.positionRevision,
        positionFingerprint: request.positionFingerprint,
        sideToMove: request.sideToMove,
        candidate: { from: { file: 0, rank: 3 }, to: { file: 0, rank: 4 } },
        completedDepth: 2,
        nodes: 24,
        score: 10,
      },
    });
  }
}

const serializedGame = serializeGame(createInitialGame());
const fingerprint = createHash("sha256").update(serializedGame).digest("hex");

function turn(overrides: Record<string, unknown> = {}) {
  return {
    matchId: "match-a",
    serializedGame,
    positionRevision: 0,
    sideToMove: "red" as const,
    status: "playing" as const,
    nodeBudget: 50,
    depthCeiling: 2,
    safetyDeadlineMs: 100,
    ...overrides,
  };
}

function commitContext(overrides: Partial<OpponentCommitContext> = {}): OpponentCommitContext {
  return {
    matchId: "match-a",
    positionRevision: 0,
    positionFingerprint: fingerprint,
    sideToMove: "red",
    status: "playing",
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  options: {
    providers?: FakeProvider[];
    factory?: (tier: OpponentTier) => OpponentProvider | Promise<OpponentProvider>;
    onFallback?: (from: OpponentTier, to: OpponentTier) => void | Promise<void>;
  } = {},
) {
  const providers = options.providers ?? [new FakeProvider()];
  let factoryCalls = 0;
  const coordinator = new OpponentCoordinator({
    providerFactory: async (tier) => {
      factoryCalls += 1;
      const provider =
        options.factory?.(tier) ?? providers[Math.min(factoryCalls - 1, providers.length - 1)];
      if (!provider) throw new Error("Opponent provider fixture is empty");
      return provider;
    },
    digest: async () => fingerprint,
    stopGraceMs: 25,
    searchTimeoutPaddingMs: 10,
    timers: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    onFallback: ({ fromTier, toTier }) => options.onFallback?.(fromTier, toTier),
  });
  return { coordinator, providers, factoryCalls: () => factoryCalls };
}

async function activateAndSearch(
  coordinator: OpponentCoordinator,
  tier: OpponentTier = "lightweight-normal",
): Promise<void> {
  await coordinator.activateMatch({ matchId: "match-a", seed: "seed-a", tier });
  await coordinator.requestTurn(turn());
}

function matchingReceipt(
  snapshot: OpponentCoordinatorSnapshot,
  status: OpponentCommitReceipt["status"],
): OpponentCommitReceipt {
  if (!snapshot.turn) throw new Error("Expected an active turn token.");
  return { status, ...snapshot.turn };
}

describe("OpponentCoordinator", () => {
  it("holds exactly one request through candidatePending and committing until a matching receipt", async () => {
    const provider = new FakeProvider();
    const { coordinator } = createHarness({ providers: [provider] });
    await activateAndSearch(coordinator);

    await expect(coordinator.requestTurn(turn())).resolves.toBe(false);
    expect(provider.searches).toHaveLength(1);
    provider.resolveResult();
    await flush();
    expect(coordinator.getSnapshot().phase).toBe("candidatePending");
    await expect(coordinator.requestTurn(turn())).resolves.toBe(false);

    const receipt = deferred<OpponentCommitReceipt>();
    const commit = coordinator.commitPending(commitContext(), async () => receipt.promise);
    expect(coordinator.getSnapshot().phase).toBe("committing");
    await expect(coordinator.requestTurn(turn())).resolves.toBe(false);
    receipt.resolve(matchingReceipt(coordinator.getSnapshot(), "committed"));
    await expect(commit).resolves.toBe("committed");
    expect(coordinator.getSnapshot().phase).toBe("ready");
    expect(provider.searches).toHaveLength(1);
  });

  it("invalidates identities synchronously before stop can re-enter with a late result", async () => {
    const provider = new FakeProvider();
    const { coordinator } = createHarness({ providers: [provider] });
    await activateAndSearch(coordinator);
    const oldGeneration = coordinator.getSnapshot().generation;
    provider.onStop = () => provider.resolveResult();

    coordinator.setVisible(false);
    const hidden = coordinator.getSnapshot();
    expect(hidden.generation).toBe(oldGeneration + 1);
    expect(hidden.turn).toBeNull();
    expect(hidden.visible).toBe(false);
    await flush();
    expect(coordinator.getSnapshot().phase).toBe("hidden");
    expect(coordinator.getSnapshot().turn).toBeNull();
  });

  it("clears a pending or committing candidate when the match is replaced and ignores the old receipt", async () => {
    const first = new FakeProvider();
    const second = new FakeProvider();
    const { coordinator } = createHarness({ providers: [first, second] });
    await activateAndSearch(coordinator);
    first.resolveResult();
    await flush();
    const receipt = deferred<OpponentCommitReceipt>();
    const committing = coordinator.commitPending(commitContext(), async () => receipt.promise);
    expect(coordinator.getSnapshot().phase).toBe("committing");

    const replacement = coordinator.activateMatch({
      matchId: "match-b",
      seed: "seed-b",
      tier: "lightweight-hard",
    });
    expect(coordinator.getSnapshot().matchId).toBe("match-b");
    expect(coordinator.getSnapshot().turn).toBeNull();
    receipt.resolve({
      status: "committed",
      matchId: "match-a",
      generation: 1,
      requestId: "request-1-1",
      positionRevision: 0,
      positionFingerprint: fingerprint,
      sideToMove: "red",
      positionStatus: "playing",
    });
    await expect(committing).resolves.toBe("superseded");
    await replacement;
    expect(coordinator.getSnapshot()).toMatchObject({ matchId: "match-b", phase: "ready" });
  });

  it("discards full-identity and fingerprint mismatches without a stale auto-retry", async () => {
    const provider = new FakeProvider();
    const { coordinator } = createHarness({ providers: [provider] });
    await activateAndSearch(coordinator);
    provider.resolveResult(0, { positionRevision: 1 });
    await flush();
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "ready", turn: null });
    expect(provider.searches).toHaveLength(1);

    await coordinator.requestTurn(turn());
    provider.resolveResult(1);
    await flush();
    const gate = vi.fn();
    await expect(
      coordinator.commitPending(commitContext({ positionFingerprint: "f".repeat(64) }), gate),
    ).resolves.toBe("superseded");
    expect(gate).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "ready", turn: null });
    expect(provider.searches).toHaveLength(2);
  });

  it("restores visibility without starting work until the controller supplies one current turn", async () => {
    const provider = new FakeProvider();
    const { coordinator } = createHarness({ providers: [provider] });
    await coordinator.activateMatch({
      matchId: "match-a",
      seed: "seed-a",
      tier: "lightweight-normal",
    });
    coordinator.setVisible(false);
    await flush();
    await expect(coordinator.requestTurn(turn())).resolves.toBe(false);
    coordinator.setVisible(true);
    expect(provider.searches).toHaveLength(0);
    await expect(coordinator.requestTurn(turn())).resolves.toBe(true);
    await expect(coordinator.requestTurn(turn())).resolves.toBe(false);
    expect(provider.searches).toHaveLength(1);
  });

  it("times out, waits for stop grace, disposes, and recreates an unresponsive provider", async () => {
    vi.useFakeTimers();
    try {
      const first = new FakeProvider();
      first.stopResult = new Promise(() => undefined);
      const second = new FakeProvider();
      const { coordinator, factoryCalls } = createHarness({ providers: [first, second] });
      await activateAndSearch(coordinator);

      await vi.advanceTimersByTimeAsync(111);
      expect(coordinator.getSnapshot().phase).toBe("stopping");
      expect(first.stops).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(25);
      await flush();
      expect(first.disposed).toBe(1);
      expect(factoryCalls()).toBe(2);
      expect(coordinator.getSnapshot().phase).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back from any failed Master provider to Hard through the injected seam", async () => {
    const hard = new FakeProvider();
    const fallback = vi.fn();
    const { coordinator } = createHarness({
      factory: (tier) => {
        if (tier === "fairy-master") throw new Error("master unavailable");
        return hard;
      },
      onFallback: fallback,
    });

    await coordinator.activateMatch({ matchId: "match-a", seed: "seed-a", tier: "fairy-master" });
    expect(fallback).toHaveBeenCalledWith("fairy-master", "lightweight-hard");
    expect(coordinator.getSnapshot()).toMatchObject({
      phase: "ready",
      requestedTier: "fairy-master",
      effectiveTier: "lightweight-hard",
    });
  });

  it("settles rejected candidates without retry and ignores duplicate or out-of-order receipts", async () => {
    const provider = new FakeProvider();
    const { coordinator } = createHarness({ providers: [provider] });
    await activateAndSearch(coordinator);
    provider.resolveResult();
    await flush();
    const snapshot = coordinator.getSnapshot();
    const wrong = matchingReceipt(snapshot, "committed");
    const rejected = await coordinator.commitPending(commitContext(), async () => ({
      ...wrong,
      requestId: "older-request",
    }));
    expect(rejected).toBe("superseded");
    expect(coordinator.getSnapshot().phase).toBe("ready");

    await coordinator.requestTurn(turn());
    provider.resolveResult(1);
    await flush();
    const result = await coordinator.commitPending(commitContext(), async (release) => ({
      status: "rejected",
      ...release.turn,
    }));
    expect(result).toBe("rejected");
    expect(provider.searches).toHaveLength(2);
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "ready", turn: null });
  });

  it("awaits fallback persistence before making the Hard provider ready", async () => {
    const hard = new FakeProvider();
    const persisted = deferred<void>();
    let persistedTier = false;
    const factoryOrder: string[] = [];
    const { coordinator } = createHarness({
      factory: (tier) => {
        factoryOrder.push(`${tier}:${persistedTier}`);
        if (tier === "fairy-master") throw new Error("master unavailable");
        return hard;
      },
      onFallback: async () => {
        await persisted.promise;
        persistedTier = true;
      },
    });

    const activation = coordinator.activateMatch({
      matchId: "match-a",
      seed: "seed-a",
      tier: "fairy-master",
    });
    await flush();
    expect(coordinator.getSnapshot().phase).toBe("fallback");
    expect(factoryOrder).toEqual(["fairy-master:false"]);
    persisted.resolve();
    await activation;
    expect(factoryOrder).toEqual(["fairy-master:false", "lightweight-hard:true"]);
    expect(coordinator.getSnapshot().phase).toBe("ready");
  });

  it("terminates an unresponsive provider after terminal invalidation grace expires", async () => {
    vi.useFakeTimers();
    try {
      const provider = new FakeProvider();
      provider.stopResult = new Promise(() => undefined);
      const { coordinator } = createHarness({ providers: [provider] });
      await activateAndSearch(coordinator);
      coordinator.setTerminal();
      expect(coordinator.getSnapshot()).toMatchObject({ phase: "stopping", turn: null });
      await vi.advanceTimersByTimeAsync(25);
      expect(provider.disposed).toBe(1);
      expect(coordinator.getSnapshot().phase).toBe("terminal");
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes frozen diagnostics and disposes idempotently", async () => {
    const provider = new FakeProvider();
    const { coordinator } = createHarness({ providers: [provider] });
    const observed: OpponentCoordinatorSnapshot[] = [];
    const unsubscribe = coordinator.subscribe((snapshot) => observed.push(snapshot));
    await coordinator.activateMatch({
      matchId: "match-a",
      seed: "seed-a",
      tier: "lightweight-easy",
    });
    expect(Object.isFrozen(coordinator.getSnapshot())).toBe(true);
    expect(observed.length).toBeGreaterThan(0);
    unsubscribe();

    coordinator.dispose();
    coordinator.dispose();
    await flush();
    expect(provider.disposed).toBe(1);
    expect(coordinator.getSnapshot().phase).toBe("disposed");
  });
});
