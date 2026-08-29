import {
  OPPONENT_PROTOCOL_VERSION,
  decodeOpponentOutputV1,
  type OpponentIdentityV1,
  type OpponentProvider,
  type OpponentProviderOutcome,
  type OpponentRequestV1,
} from "../../../lib/xiangqi/ai/index";
import lightweightWorkerUrl from "../../../lib/xiangqi/ai/lightweight.worker.ts?worker&url";

export interface OpponentWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: () => void): void;
  terminate(): void;
}

export type OpponentWorkerFactory = () => OpponentWorkerLike;

type PendingSearch = Readonly<{
  request: OpponentRequestV1;
  resolve: (outcome: OpponentProviderOutcome) => void;
}>;

function sameIdentity(left: OpponentIdentityV1, right: OpponentIdentityV1): boolean {
  return left.matchId === right.matchId
    && left.generation === right.generation
    && left.requestId === right.requestId;
}

function failure(
  code: "invalid-request" | "cancelled" | "failed",
  message: string,
): OpponentProviderOutcome {
  return { ok: false, failure: { code, recoverable: true, message } };
}

export function createLightweightWorker(): OpponentWorkerLike {
  return new Worker(
    lightweightWorkerUrl,
    { type: "module", name: "xiangqi-lightweight-opponent" },
  );
}

export class LightweightWorkerProvider implements OpponentProvider {
  readonly #worker: OpponentWorkerLike;
  #pending: PendingSearch | null = null;
  #stopResolve: (() => void) | null = null;
  #stopPromise: Promise<void> | null = null;
  #disposed = false;

  constructor(factory: OpponentWorkerFactory = createLightweightWorker) {
    this.#worker = factory();
    this.#worker.addEventListener("message", this.handleMessage);
    this.#worker.addEventListener("error", this.handleError);
  }

  search(request: OpponentRequestV1): Promise<OpponentProviderOutcome> {
    if (this.#disposed) {
      return Promise.resolve(failure("failed", "The opponent Worker has been disposed."));
    }
    if (this.#pending) {
      return Promise.resolve(failure("invalid-request", "Only one opponent search may run at a time."));
    }
    return new Promise((resolve) => {
      this.#pending = { request, resolve };
      this.#worker.postMessage(request);
    });
  }

  stop(identity: OpponentIdentityV1): Promise<void> {
    if (this.#disposed || !this.#pending || !sameIdentity(this.#pending.request, identity)) {
      return Promise.resolve();
    }
    if (this.#stopPromise) return this.#stopPromise;
    this.#worker.postMessage({
      protocolVersion: OPPONENT_PROTOCOL_VERSION,
      type: "stop",
      matchId: identity.matchId,
      generation: identity.generation,
      requestId: identity.requestId,
    });
    this.#stopPromise = new Promise((resolve) => {
      this.#stopResolve = resolve;
    });
    return this.#stopPromise;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#worker.removeEventListener("message", this.handleMessage);
    this.#worker.removeEventListener("error", this.handleError);
    this.#worker.terminate();
    this.settle(failure("cancelled", "The opponent Worker was disposed."));
    this.settleStop();
  }

  readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const output = decodeOpponentOutputV1(event.data);
    const pending = this.#pending;
    if (!pending) return;
    if (!output) {
      this.settle(failure("failed", "The opponent Worker returned malformed output."));
      this.settleStop();
      return;
    }
    if (!sameIdentity(output, pending.request)) return;
    if (output.type === "result") {
      this.settle({ ok: true, result: output });
      this.settleStop();
      return;
    }
    if (output.type === "error") {
      this.settle(failure("failed", output.message));
      this.settleStop();
      return;
    }
    this.settle(failure("cancelled", "The opponent search was stopped."));
    this.settleStop();
  };

  readonly handleError = (): void => {
    this.settle(failure("failed", "The opponent Worker failed."));
    this.settleStop();
  };

  private settle(outcome: OpponentProviderOutcome): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    pending.resolve(outcome);
  }

  private settleStop(): void {
    this.#stopResolve?.();
    this.#stopResolve = null;
    this.#stopPromise = null;
  }
}
