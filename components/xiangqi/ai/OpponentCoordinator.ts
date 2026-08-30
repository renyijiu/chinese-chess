import {
  decodeOpponentResultV1,
  type CandidateMove,
  type OpponentIdentityV1,
  type OpponentPositionIdentityV1,
  type OpponentProvider,
  type OpponentProviderFailure,
  type OpponentProviderOutcome,
  type OpponentRequestV1,
  type OpponentResultV1,
  type OpponentTier,
  type PositionDigest,
} from "../../../lib/xiangqi/ai/index";
import type { Side } from "../../../lib/xiangqi/index";

export type OpponentCoordinatorPhase =
  | "booting"
  | "ready"
  | "searching"
  | "candidatePending"
  | "committing"
  | "stopping"
  | "fallback"
  | "hidden"
  | "terminal"
  | "failed"
  | "disposed";

export type OpponentTurnToken = Readonly<OpponentPositionIdentityV1 & {
  positionStatus: "playing";
}>;

export type OpponentCommitReceipt = Readonly<OpponentTurnToken & {
  status: "committed" | "rejected" | "superseded";
}>;

export type OpponentCandidateRelease = Readonly<{
  turn: OpponentTurnToken;
  candidate: CandidateMove;
}>;

export type OpponentCommitGate = (
  release: OpponentCandidateRelease,
) => Promise<OpponentCommitReceipt> | OpponentCommitReceipt;

export type OpponentCoordinatorSnapshot = Readonly<{
  phase: OpponentCoordinatorPhase;
  matchId: string | null;
  generation: number;
  requestedTier: OpponentTier | null;
  effectiveTier: OpponentTier | null;
  visible: boolean;
  turn: OpponentTurnToken | null;
  failure: OpponentProviderFailure | null;
}>;

export type OpponentProviderFactory = (
  tier: OpponentTier,
) => OpponentProvider | Promise<OpponentProvider>;

export type OpponentFallbackResolver = (
  tier: OpponentTier,
  failure: OpponentProviderFailure,
) => OpponentTier | null;

export interface OpponentCoordinatorTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OpponentCoordinatorOptions {
  readonly providerFactory: OpponentProviderFactory;
  readonly digest?: PositionDigest;
  readonly fallbackResolver?: OpponentFallbackResolver;
  readonly onFallback?: (event: Readonly<{
    matchId: string;
    fromTier: OpponentTier;
    toTier: OpponentTier;
    failure: OpponentProviderFailure;
  }>) => void | Promise<void>;
  readonly stopGraceMs?: number;
  readonly searchTimeoutPaddingMs?: number;
  readonly timers?: OpponentCoordinatorTimers;
  readonly createRequestId?: (generation: number, sequence: number) => string;
}

export type OpponentMatchActivation = Readonly<{
  matchId: string;
  seed: string;
  tier: OpponentTier;
}>;

export type OpponentTurnRequest = Readonly<{
  matchId: string;
  serializedGame: string;
  positionRevision: number;
  sideToMove: Side;
  status: "playing" | "terminal";
  nodeBudget: number;
  depthCeiling: number;
  safetyDeadlineMs: number;
}>;

export type OpponentCommitContext = Readonly<{
  matchId: string;
  positionRevision: number;
  positionFingerprint: string;
  sideToMove: Side;
  status: "playing" | "terminal";
}>;

type ActiveMatch = {
  matchId: string;
  seed: string;
  tier: OpponentTier;
  requestedTier: OpponentTier;
};
type PendingCandidate = Readonly<{ request: OpponentRequestV1; result: OpponentResultV1 }>;
type TimeoutRetryState = Readonly<{
  matchId: string;
  positionRevision: number;
  positionFingerprint: string;
  sideToMove: Side;
  timeoutCount: number;
}>;

const MAX_AUTOMATIC_TIMEOUT_RETRIES_PER_POSITION = 1;

const defaultTimers: OpponentCoordinatorTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function providerFailure(
  code: OpponentProviderFailure["code"],
  message: string,
): OpponentProviderFailure {
  return Object.freeze({ code, recoverable: true, message });
}

function defaultFallback(tier: OpponentTier): OpponentTier | null {
  return tier === "fairy-master" ? "lightweight-hard" : null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameIdentity(left: OpponentIdentityV1, right: OpponentIdentityV1): boolean {
  return left.matchId === right.matchId
    && left.generation === right.generation
    && left.requestId === right.requestId;
}

function samePositionIdentity(
  left: OpponentPositionIdentityV1,
  right: OpponentPositionIdentityV1,
): boolean {
  return sameIdentity(left, right)
    && left.positionRevision === right.positionRevision
    && left.positionFingerprint === right.positionFingerprint
    && left.sideToMove === right.sideToMove;
}

function freezeTurn(request: OpponentRequestV1): OpponentTurnToken {
  return Object.freeze({
    matchId: request.matchId,
    generation: request.generation,
    requestId: request.requestId,
    positionRevision: request.positionRevision,
    positionFingerprint: request.positionFingerprint,
    sideToMove: request.sideToMove,
    positionStatus: "playing" as const,
  });
}

export class OpponentCoordinator {
  readonly #providerFactory: OpponentProviderFactory;
  readonly #digest: PositionDigest;
  readonly #fallbackResolver: OpponentFallbackResolver;
  readonly #onFallback?: OpponentCoordinatorOptions["onFallback"];
  readonly #stopGraceMs: number;
  readonly #searchTimeoutPaddingMs: number;
  readonly #timers: OpponentCoordinatorTimers;
  readonly #createRequestId: (generation: number, sequence: number) => string;
  readonly #listeners = new Set<(snapshot: OpponentCoordinatorSnapshot) => void>();

  #provider: OpponentProvider | null = null;
  #match: ActiveMatch | null = null;
  #phase: OpponentCoordinatorPhase = "booting";
  #generation = 0;
  #requestSequence = 0;
  #visible = true;
  #terminal = false;
  #activeRequest: OpponentRequestV1 | null = null;
  #pending: PendingCandidate | null = null;
  #failure: OpponentProviderFailure | null = null;
  #searchTimeout: unknown = null;
  #timeoutRetryState: TimeoutRetryState | null = null;
  #disposed = false;

  constructor(options: OpponentCoordinatorOptions) {
    this.#providerFactory = options.providerFactory;
    this.#digest = options.digest ?? sha256;
    this.#fallbackResolver = options.fallbackResolver
      ?? ((tier) => defaultFallback(tier));
    this.#onFallback = options.onFallback;
    this.#stopGraceMs = Math.max(0, options.stopGraceMs ?? 250);
    this.#searchTimeoutPaddingMs = Math.max(0, options.searchTimeoutPaddingMs ?? 250);
    this.#timers = options.timers ?? defaultTimers;
    this.#createRequestId = options.createRequestId
      ?? ((generation, sequence) => `request-${generation}-${sequence}`);
  }

  getSnapshot(): OpponentCoordinatorSnapshot {
    const turn = this.#activeRequest ? freezeTurn(this.#activeRequest) : null;
    return Object.freeze({
      phase: this.#phase,
      matchId: this.#match?.matchId ?? null,
      generation: this.#generation,
      requestedTier: this.#match?.requestedTier ?? null,
      effectiveTier: this.#match?.tier ?? null,
      visible: this.#visible,
      turn,
      failure: this.#failure ? Object.freeze({ ...this.#failure }) : null,
    });
  }

  subscribe(listener: (snapshot: OpponentCoordinatorSnapshot) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  async activateMatch(activation: OpponentMatchActivation): Promise<void> {
    if (this.#disposed) return;
    const oldProvider = this.#provider;
    const oldIdentity = this.#activeRequest;
    this.invalidateSynchronously();
    this.#timeoutRetryState = null;
    this.#match = { ...activation, requestedTier: activation.tier };
    this.#terminal = false;
    this.#failure = null;
    const generation = this.#generation;
    this.#phase = oldProvider ? "stopping" : "booting";
    this.emit();

    if (oldProvider) {
      await this.stopWithinGrace(oldProvider, oldIdentity);
      oldProvider.dispose();
      if (this.#provider === oldProvider) this.#provider = null;
    }
    if (!this.isCurrent(generation, activation.matchId)) return;
    await this.bootProvider(generation, activation.tier);
  }

  async requestTurn(input: OpponentTurnRequest): Promise<boolean> {
    if (
      this.#disposed
      || !this.#visible
      || this.#terminal
      || input.status !== "playing"
      || this.#phase !== "ready"
      || !this.#provider
      || !this.#match
      || input.matchId !== this.#match.matchId
    ) return false;

    const generation = this.#generation;
    const match = this.#match;
    const provider = this.#provider;
    const requestId = this.#createRequestId(generation, ++this.#requestSequence);
    this.#phase = "searching";
    this.#failure = null;
    this.emit();

    let positionFingerprint: string;
    try {
      positionFingerprint = await this.#digest(input.serializedGame);
    } catch {
      if (this.isCurrent(generation, match.matchId) && this.#phase === "searching") {
        this.fail(providerFailure("invalid-request", "The position fingerprint could not be created."));
      }
      return false;
    }
    if (
      !this.isCurrent(generation, match.matchId)
      || this.#provider !== provider
      || this.#phase !== "searching"
    ) return false;

    const request: OpponentRequestV1 = Object.freeze({
      protocolVersion: 1,
      type: "search",
      matchId: match.matchId,
      generation,
      requestId,
      positionRevision: input.positionRevision,
      serializedGame: input.serializedGame,
      positionFingerprint,
      sideToMove: input.sideToMove,
      tier: match.tier,
      seed: match.seed,
      nodeBudget: input.nodeBudget,
      depthCeiling: input.depthCeiling,
      safetyDeadlineMs: input.safetyDeadlineMs,
    });
    this.resetTimeoutRetryBudgetForDifferentPosition(request);
    this.#activeRequest = request;
    this.emit();
    this.#searchTimeout = this.#timers.setTimeout(
      () => { void this.handleSearchTimeout(request, provider); },
      input.safetyDeadlineMs + this.#searchTimeoutPaddingMs,
    );
    void provider.search(request).then(
      (outcome) => this.handleOutcome(request, provider, outcome),
      () => this.handleOutcome(request, provider, {
        ok: false,
        failure: providerFailure("failed", "The opponent provider rejected its search."),
      }),
    );
    return true;
  }

  async commitPending(
    context: OpponentCommitContext,
    gate: OpponentCommitGate,
  ): Promise<OpponentCommitReceipt["status"]> {
    const pending = this.#pending;
    const request = this.#activeRequest;
    if (!pending || !request || this.#phase !== "candidatePending") return "superseded";
    if (!this.contextMatches(context, request)) {
      this.clearTurn("ready");
      return "superseded";
    }

    const generation = this.#generation;
    const release = Object.freeze({
      turn: freezeTurn(request),
      candidate: Object.freeze({
        from: Object.freeze({ ...pending.result.candidate.from }),
        to: Object.freeze({ ...pending.result.candidate.to }),
      }),
    });
    this.#phase = "committing";
    this.emit();

    let receipt: OpponentCommitReceipt;
    try {
      receipt = await gate(release);
    } catch {
      if (this.isPending(generation, pending)) this.clearTurn("ready");
      return "rejected";
    }
    if (!this.isPending(generation, pending)) return "superseded";
    if (!samePositionIdentity(receipt, request)) {
      this.clearTurn("ready");
      return "superseded";
    }
    this.clearTurn("ready");
    return receipt.status;
  }

  setVisible(visible: boolean): void {
    if (this.#disposed || visible === this.#visible) return;
    this.#visible = visible;
    if (visible) {
      this.#generation += 1;
      this.#failure = null;
      if (this.#terminal) this.#phase = "terminal";
      else if (this.#provider) this.#phase = "ready";
      else if (this.#match) {
        this.#phase = "booting";
        void this.bootProvider(this.#generation, this.#match.tier);
      }
      this.emit();
      return;
    }
    const identity = this.#activeRequest;
    const provider = this.#provider;
    const bootingProvider = !identity && this.#phase === "booting" ? provider : null;
    this.invalidateSynchronously();
    if (bootingProvider) {
      bootingProvider.dispose();
      if (this.#provider === bootingProvider) this.#provider = null;
    }
    const generation = this.#generation;
    this.#phase = identity && provider ? "stopping" : "hidden";
    this.emit();
    if (identity && provider) {
      void this.stopWithinGrace(provider, identity).then((cooperative) => {
        if (!cooperative) {
          provider.dispose();
          if (this.#provider === provider) this.#provider = null;
        }
        if (this.#generation === generation && !this.#visible && !this.#disposed) {
          this.#phase = "hidden";
          this.emit();
        }
      });
    }
  }

  setTerminal(): void {
    if (this.#disposed || this.#terminal) return;
    this.#terminal = true;
    const identity = this.#activeRequest;
    const provider = this.#provider;
    const bootingProvider = !identity && this.#phase === "booting" ? provider : null;
    this.invalidateSynchronously();
    if (bootingProvider) {
      bootingProvider.dispose();
      if (this.#provider === bootingProvider) this.#provider = null;
    }
    const generation = this.#generation;
    this.#phase = identity && provider ? "stopping" : "terminal";
    this.emit();
    if (identity && provider) {
      void this.stopWithinGrace(provider, identity).then((cooperative) => {
        if (!cooperative) {
          provider.dispose();
          if (this.#provider === provider) this.#provider = null;
        }
        if (this.#generation === generation && this.#terminal && !this.#disposed) {
          this.#phase = "terminal";
          this.emit();
        }
      });
    }
  }

  invalidate(): void {
    if (this.#disposed) return;
    const identity = this.#activeRequest;
    const provider = this.#provider;
    const bootingProvider = !identity && this.#phase === "booting" ? provider : null;
    this.invalidateSynchronously();
    if (bootingProvider) {
      bootingProvider.dispose();
      if (this.#provider === bootingProvider) this.#provider = null;
    }
    this.#timeoutRetryState = null;
    const generation = this.#generation;
    this.#phase = identity && provider ? "stopping" : this.restingPhase();
    this.emit();
    if (identity && provider) {
      void this.stopWithinGrace(provider, identity).then((cooperative) => {
        if (!cooperative) {
          provider.dispose();
          if (this.#provider === provider) this.#provider = null;
        }
        if (!this.isCurrent(generation, this.#match?.matchId ?? "")) return;
        if (!this.#provider && this.#visible && !this.#terminal && this.#match) {
          void this.bootProvider(generation, this.#match.tier);
        } else {
          this.#phase = this.restingPhase();
          this.emit();
        }
      });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    const identity = this.#activeRequest;
    const provider = this.#provider;
    this.#disposed = true;
    this.invalidateSynchronously();
    this.#provider = null;
    this.#phase = "disposed";
    this.emit();
    this.#listeners.clear();
    if (!provider) return;
    if (!identity) {
      provider.dispose();
      return;
    }
    void this.stopWithinGrace(provider, identity).finally(() => provider.dispose());
  }

  private async bootProvider(generation: number, tier: OpponentTier): Promise<void> {
    const matchId = this.#match?.matchId;
    if (!matchId || !this.isCurrent(generation, matchId)) return;
    this.#phase = "booting";
    this.emit();
    let provider: OpponentProvider | null = null;
    try {
      provider = await this.#providerFactory(tier);
      if (!this.isCurrent(generation, matchId)) {
        provider.dispose();
        return;
      }
      this.#provider = provider;
      await provider.prepare?.();
      if (!this.isCurrent(generation, matchId) || this.#provider !== provider) {
        provider.dispose();
        return;
      }
      this.#failure = null;
      this.#phase = this.restingPhase();
      this.emit();
    } catch {
      provider?.dispose();
      if (this.#provider === provider) this.#provider = null;
      if (!this.isCurrent(generation, matchId)) return;
      await this.fallbackOrFail(
        tier,
        providerFailure("unavailable", `The ${tier} opponent provider is unavailable.`),
        generation,
      );
    }
  }

  private handleOutcome(
    request: OpponentRequestV1,
    provider: OpponentProvider,
    outcome: OpponentProviderOutcome,
  ): void {
    if (!this.isActive(request, provider) || this.#phase !== "searching") return;
    this.clearSearchTimeout();
    if (!outcome.ok) {
      this.#activeRequest = null;
      if (outcome.failure.code === "cancelled") {
        this.#phase = this.restingPhase();
        this.emit();
        return;
      }
      void this.fallbackOrFail(request.tier, outcome.failure, request.generation);
      return;
    }
    const result = decodeOpponentResultV1(outcome.result);
    if (!result || !samePositionIdentity(result, request)) {
      this.clearTurn("ready");
      return;
    }
    this.#pending = Object.freeze({ request, result });
    this.#phase = "candidatePending";
    this.emit();
  }

  private async handleSearchTimeout(
    request: OpponentRequestV1,
    provider: OpponentProvider,
  ): Promise<void> {
    if (!this.isActive(request, provider) || this.#phase !== "searching") return;
    this.invalidateSynchronously();
    const generation = this.#generation;
    const matchId = this.#match?.matchId;
    const failure = providerFailure("timeout", "The opponent search timed out.");
    const canRetry = this.consumeTimeoutRetry(request);
    this.#failure = failure;
    this.#phase = "stopping";
    this.emit();
    const cooperative = await this.stopWithinGrace(provider, request);
    if (!matchId || !this.isCurrent(generation, matchId)) return;
    if (cooperative) {
      if (canRetry) {
        this.#phase = this.restingPhase();
        this.emit();
      } else {
        this.fail(failure);
      }
      return;
    }
    provider.dispose();
    if (this.#provider === provider) this.#provider = null;
    if (!canRetry) {
      this.fail(failure);
      return;
    }
    if (this.#visible && !this.#terminal && this.#match) {
      await this.bootProvider(generation, this.#match.tier);
    }
  }

  private consumeTimeoutRetry(request: OpponentRequestV1): boolean {
    const timeoutCount = this.sameTimeoutRetryPosition(request)
      ? (this.#timeoutRetryState?.timeoutCount ?? 0) + 1
      : 1;
    this.#timeoutRetryState = Object.freeze({
      matchId: request.matchId,
      positionRevision: request.positionRevision,
      positionFingerprint: request.positionFingerprint,
      sideToMove: request.sideToMove,
      timeoutCount,
    });
    return timeoutCount <= MAX_AUTOMATIC_TIMEOUT_RETRIES_PER_POSITION;
  }

  private resetTimeoutRetryBudgetForDifferentPosition(request: OpponentRequestV1): void {
    if (this.#timeoutRetryState && !this.sameTimeoutRetryPosition(request)) {
      this.#timeoutRetryState = null;
    }
  }

  private sameTimeoutRetryPosition(request: OpponentRequestV1): boolean {
    const state = this.#timeoutRetryState;
    return state !== null
      && state.matchId === request.matchId
      && state.positionRevision === request.positionRevision
      && state.positionFingerprint === request.positionFingerprint
      && state.sideToMove === request.sideToMove;
  }

  private async fallbackOrFail(
    fromTier: OpponentTier,
    failure: OpponentProviderFailure,
    expectedGeneration: number,
  ): Promise<void> {
    const match = this.#match;
    if (!match || !this.isCurrent(expectedGeneration, match.matchId)) return;
    const toTier = this.#fallbackResolver(fromTier, failure);
    if (!toTier || toTier === fromTier) {
      this.fail(failure);
      return;
    }
    const oldProvider = this.#provider;
    this.invalidateSynchronously();
    this.#provider = null;
    match.tier = toTier;
    const generation = this.#generation;
    this.#phase = "fallback";
    this.#failure = failure;
    this.emit();
    try {
      await this.#onFallback?.({
        matchId: match.matchId,
        fromTier,
        toTier,
        failure,
      });
    } catch {
      oldProvider?.dispose();
      if (this.isCurrent(generation, match.matchId)) {
        this.fail(providerFailure("failed", "The opponent fallback could not be persisted."));
      }
      return;
    }
    oldProvider?.dispose();
    if (!this.isCurrent(generation, match.matchId)) return;
    await this.bootProvider(generation, toTier);
  }

  private invalidateSynchronously(): void {
    this.#generation += 1;
    this.clearSearchTimeout();
    this.#activeRequest = null;
    this.#pending = null;
  }

  private clearTurn(phase: OpponentCoordinatorPhase): void {
    this.clearSearchTimeout();
    this.#activeRequest = null;
    this.#pending = null;
    this.#phase = this.#visible && !this.#terminal ? phase : this.restingPhase();
    this.emit();
  }

  private clearSearchTimeout(): void {
    if (this.#searchTimeout === null) return;
    this.#timers.clearTimeout(this.#searchTimeout);
    this.#searchTimeout = null;
  }

  private contextMatches(context: OpponentCommitContext, request: OpponentRequestV1): boolean {
    return context.status === "playing"
      && context.matchId === request.matchId
      && context.positionRevision === request.positionRevision
      && context.positionFingerprint === request.positionFingerprint
      && context.sideToMove === request.sideToMove
      && this.#match?.matchId === request.matchId
      && this.#generation === request.generation
      && !this.#terminal
      && this.#visible;
  }

  private isActive(request: OpponentRequestV1, provider: OpponentProvider): boolean {
    return !this.#disposed
      && this.#provider === provider
      && this.#activeRequest !== null
      && samePositionIdentity(this.#activeRequest, request)
      && this.#generation === request.generation;
  }

  private isPending(generation: number, pending: PendingCandidate): boolean {
    return !this.#disposed
      && this.#generation === generation
      && this.#pending === pending
      && this.#activeRequest === pending.request;
  }

  private isCurrent(generation: number, matchId: string): boolean {
    return !this.#disposed
      && this.#generation === generation
      && this.#match?.matchId === matchId;
  }

  private fail(failure: OpponentProviderFailure): void {
    this.clearSearchTimeout();
    this.#activeRequest = null;
    this.#pending = null;
    this.#failure = failure;
    this.#phase = "failed";
    this.emit();
  }

  private restingPhase(): OpponentCoordinatorPhase {
    if (this.#disposed) return "disposed";
    if (!this.#visible) return "hidden";
    if (this.#terminal) return "terminal";
    return this.#provider ? "ready" : "booting";
  }

  private stopWithinGrace(
    provider: OpponentProvider,
    identity: OpponentIdentityV1 | null,
  ): Promise<boolean> {
    if (!identity) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (cooperative: boolean) => {
        if (settled) return;
        settled = true;
        this.#timers.clearTimeout(timer);
        resolve(cooperative);
      };
      const timer = this.#timers.setTimeout(() => finish(false), this.#stopGraceMs);
      try {
        Promise.resolve(provider.stop(identity)).then(
          () => finish(true),
          () => finish(false),
        );
      } catch {
        finish(false);
      }
    });
  }

  private emit(): void {
    if (this.#listeners.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
