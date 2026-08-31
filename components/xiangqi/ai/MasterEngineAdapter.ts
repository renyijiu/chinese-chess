import {
  getLegalMoves,
  getPieceAt,
  type GameState,
  type Piece,
  type Square,
} from "../../../lib/xiangqi/index";
import type {
  OpponentIdentityV1,
  OpponentProvider,
  OpponentProviderOutcome,
  OpponentRequestV1,
} from "../../../lib/xiangqi/ai/index";
import { validateOpponentRequestPosition } from "../../../lib/xiangqi/ai/index";
import {
  loadVerifiedMasterAssets,
  type MasterCacheStorageLike,
  type VerifiedMasterAssets,
} from "./engine-cache";

export const MASTER_HOST_WORKER_URL = "/workers/xiangqi-master-v1.worker.js";
const NETWORK_PATH = "/xiangqi-c07e94a5c7cb.nnue";

const ROLE_TO_FEN: Readonly<Record<Piece["role"], string>> = Object.freeze({
  advisor: "a",
  cannon: "c",
  chariot: "r",
  elephant: "b",
  general: "k",
  horse: "n",
  soldier: "p",
});

const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x03, 0x02, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x0c, 0x01, 0x00,
  0x0a, 0x16, 0x02,
  0x0c, 0x00, 0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x0a, 0x00, 0x00, 0x0b,
  0x07, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x1a, 0x0b,
]);

export type MissingMasterCapability =
  | "secure-context"
  | "cross-origin-isolation"
  | "shared-array-buffer"
  | "webassembly"
  | "wasm-simd"
  | "cache-storage";

export type MasterCapabilityResult = Readonly<{
  supported: boolean;
  missing: readonly MissingMasterCapability[];
}>;

export type MasterCapabilityEnvironment = Readonly<{
  isSecureContext: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: typeof SharedArrayBuffer | undefined;
  webAssembly: typeof WebAssembly | undefined;
  validateWasm: (bytes: BufferSource) => boolean;
  cacheStorage: MasterCacheStorageLike | undefined;
}>;

export class MasterCapabilityError extends Error {
  readonly missing: readonly MissingMasterCapability[];

  constructor(missing: readonly MissingMasterCapability[]) {
    super(`Master engine is unavailable: ${missing.join(", ")}.`);
    this.name = "MasterCapabilityError";
    this.missing = missing;
  }
}

export function assessMasterCapabilities(
  environment: MasterCapabilityEnvironment = {
    isSecureContext: globalThis.isSecureContext === true,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: globalThis.SharedArrayBuffer,
    webAssembly: globalThis.WebAssembly,
    validateWasm: (bytes) => globalThis.WebAssembly?.validate(bytes) === true,
    cacheStorage: globalThis.caches,
  },
): MasterCapabilityResult {
  const missing: MissingMasterCapability[] = [];
  if (!environment.isSecureContext) missing.push("secure-context");
  if (!environment.crossOriginIsolated) missing.push("cross-origin-isolation");
  if (typeof environment.sharedArrayBuffer !== "function") missing.push("shared-array-buffer");
  if (!environment.webAssembly) missing.push("webassembly");
  if (!environment.webAssembly || !environment.validateWasm(SIMD_PROBE)) missing.push("wasm-simd");
  if (!environment.cacheStorage) missing.push("cache-storage");
  return Object.freeze({ supported: missing.length === 0, missing: Object.freeze(missing) });
}

export function squareToUci(square: Square): string {
  if (
    !Number.isInteger(square.file)
    || square.file < 0
    || square.file > 8
    || !Number.isInteger(square.rank)
    || square.rank < 0
    || square.rank > 9
  ) throw new Error("Xiangqi square is outside the 9 by 10 board.");
  return `${String.fromCharCode(97 + square.file)}${square.rank + 1}`;
}

export function squareFromUci(value: string): Square {
  const match = /^([a-i])(10|[1-9])$/.exec(value);
  if (!match) throw new Error(`Invalid Xiangqi UCI square: ${value}.`);
  const file = match[1];
  const rank = match[2];
  if (!file || !rank) throw new Error(`Invalid Xiangqi UCI square: ${value}.`);
  return Object.freeze({
    file: file.charCodeAt(0) - 97,
    rank: Number(rank) - 1,
  });
}

function moveFromUci(value: string): Readonly<{ from: Square; to: Square }> {
  const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(value);
  if (!match) throw new Error(`Invalid Xiangqi UCI move: ${value}.`);
  const from = match[1];
  const to = match[2];
  if (!from || !to) throw new Error(`Invalid Xiangqi UCI move: ${value}.`);
  return Object.freeze({ from: squareFromUci(from), to: squareFromUci(to) });
}

function fenPiece(piece: Piece): string {
  const letter = ROLE_TO_FEN[piece.role];
  return piece.side === "red" ? letter.toUpperCase() : letter;
}

export function gameToXiangqiFen(game: GameState): string {
  const ranks: string[] = [];
  for (let rank = 9; rank >= 0; rank -= 1) {
    let empty = 0;
    let fenRank = "";
    for (let file = 0; file < 9; file += 1) {
      const piece = game.board[(rank * 9) + file];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        fenRank += String(empty);
        empty = 0;
      }
      fenRank += fenPiece(piece);
    }
    if (empty > 0) fenRank += String(empty);
    ranks.push(fenRank);
  }
  const side = game.sideToMove === "red" ? "w" : "b";
  return `${ranks.join("/")} ${side} - - ${game.noCapturePlies} ${Math.floor(game.revision / 2) + 1}`;
}

export interface MasterHostWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: () => void): void;
  terminate(): void;
}

export type MasterHostWorkerFactory = () => MasterHostWorkerLike;

export interface MasterEngineTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type MasterEngineAdapterOptions = Readonly<{
  assetLoader?: () => Promise<VerifiedMasterAssets>;
  handshakeTimeoutMs?: number;
  stopGraceMs?: number;
  timers?: MasterEngineTimers;
  workerFactory?: MasterHostWorkerFactory;
}>;

type LineWaiter = {
  predicate: (line: string) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: unknown;
  quietTimer: unknown;
};

type BootWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: unknown;
};

type ActiveSearch = {
  request: OpponentRequestV1;
  game: GameState;
  resolve: (outcome: OpponentProviderOutcome) => void;
  mode: "searching" | "cancelled" | "timeout";
  depth: number;
  nodes: number;
  score: number;
  deadlineTimer: unknown;
  graceTimer: unknown;
  stopPromise: Promise<void> | null;
  stopResolve: (() => void) | null;
};

const browserTimers: MasterEngineTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function createMasterHostWorker(): MasterHostWorkerLike {
  return new Worker(MASTER_HOST_WORKER_URL, {
    name: "xiangqi-master-engine",
    type: "classic",
  });
}

function sameIdentity(left: OpponentIdentityV1, right: OpponentIdentityV1): boolean {
  return left.matchId === right.matchId
    && left.generation === right.generation
    && left.requestId === right.requestId;
}

function failure(
  code: "unavailable" | "invalid-request" | "cancelled" | "timeout" | "failed",
  message: string,
): OpponentProviderOutcome {
  return Object.freeze({ ok: false, failure: Object.freeze({ code, recoverable: true, message }) });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseInfo(line: string): Readonly<{ depth?: number; nodes?: number; score?: number }> {
  if (!line.startsWith("info ")) return Object.freeze({});
  const depth = /(?:^|\s)depth (\d+)(?:\s|$)/.exec(line);
  const nodes = /(?:^|\s)nodes (\d+)(?:\s|$)/.exec(line);
  const cp = /(?:^|\s)score cp (-?\d+)(?:\s|$)/.exec(line);
  const mate = /(?:^|\s)score mate (-?\d+)(?:\s|$)/.exec(line);
  return Object.freeze({
    ...(depth?.[1] ? { depth: Number(depth[1]) } : {}),
    ...(nodes?.[1] ? { nodes: Number(nodes[1]) } : {}),
    ...(cp?.[1]
      ? { score: Number(cp[1]) }
      : mate?.[1] ? { score: Math.sign(Number(mate[1])) * 100_000 } : {}),
  });
}

function parseHostMessage(value: unknown):
  | Readonly<{ type: "booted" }>
  | Readonly<{ type: "boot-error"; message: string }>
  | Readonly<{ type: "line"; line: string }>
  | Readonly<{ type: "exit"; code: number }>
  | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "booted" && Object.keys(message).length === 1) return { type: "booted" };
  if (message.type === "boot-error" && typeof message.message === "string") {
    return { type: "boot-error", message: message.message };
  }
  if (message.type === "line" && typeof message.line === "string") return { type: "line", line: message.line };
  if (message.type === "exit" && typeof message.code === "number") return { type: "exit", code: message.code };
  return null;
}

export class MasterEngineAdapter implements OpponentProvider {
  readonly #assetLoader: () => Promise<VerifiedMasterAssets>;
  readonly #handshakeTimeoutMs: number;
  readonly #stopGraceMs: number;
  readonly #timers: MasterEngineTimers;
  readonly #workerFactory: MasterHostWorkerFactory;
  #worker: MasterHostWorkerLike | null = null;
  #initialization: Promise<void> | null = null;
  #initialized = false;
  #disposed = false;
  #bootWaiter: BootWaiter | null = null;
  #lineWaiter: LineWaiter | null = null;
  #activeSearch: ActiveSearch | null = null;
  #startingRequest: OpponentRequestV1 | null = null;
  #cancelledStartingRequest: OpponentRequestV1 | null = null;
  #currentMatchId: string | null = null;
  #advertisesVariant = false;
  #advertisesEvalFile = false;

  constructor(options: MasterEngineAdapterOptions = {}) {
    this.#assetLoader = options.assetLoader ?? loadVerifiedMasterAssets;
    this.#handshakeTimeoutMs = Math.max(1, options.handshakeTimeoutMs ?? 15_000);
    this.#stopGraceMs = Math.max(0, options.stopGraceMs ?? 300);
    this.#timers = options.timers ?? browserTimers;
    this.#workerFactory = options.workerFactory ?? createMasterHostWorker;
  }

  initialize(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("Master engine adapter is disposed."));
    if (this.#initialized) return Promise.resolve();
    if (this.#initialization) return this.#initialization;
    this.#initialization = this.boot().catch((error) => {
      this.destroyWorker();
      throw error;
    }).finally(() => {
      if (!this.#initialized) this.#initialization = null;
    });
    return this.#initialization;
  }

  async search(request: OpponentRequestV1): Promise<OpponentProviderOutcome> {
    if (this.#disposed) return failure("failed", "The Master engine adapter is disposed.");
    if (this.#activeSearch || this.#startingRequest) {
      return failure("invalid-request", "Only one Master search may run at a time.");
    }
    if (request.tier !== "fairy-master") return failure("invalid-request", "Master received a non-Master request.");

    this.#startingRequest = request;
    try {
      const validated = await validateOpponentRequestPosition(request, sha256);
      if (this.#disposed) return failure("cancelled", "The Master engine adapter was disposed.");
      if (this.#cancelledStartingRequest && sameIdentity(this.#cancelledStartingRequest, request)) {
        return failure("cancelled", "The Master search was stopped before it began.");
      }
      if (!validated.ok || validated.game.status.kind !== "playing") {
        return failure("invalid-request", "Master request identity does not match its canonical position.");
      }
      const game = validated.game;

      await this.initialize();
      if (this.#disposed) return failure("cancelled", "The Master engine adapter was disposed.");
      if (this.#cancelledStartingRequest && sameIdentity(this.#cancelledStartingRequest, request)) {
        return failure("cancelled", "The Master search was stopped before it began.");
      }
      if (this.#currentMatchId !== request.matchId) {
        this.command("ucinewgame");
        await this.commandAndWait("isready", (line) => line === "readyok", "readyok after ucinewgame");
        this.#currentMatchId = request.matchId;
      }
      if (this.#cancelledStartingRequest && sameIdentity(this.#cancelledStartingRequest, request)) {
        return failure("cancelled", "The Master search was stopped before it began.");
      }
      const fen = gameToXiangqiFen(game);
      return await new Promise<OpponentProviderOutcome>((resolve) => {
        const deadlineTimer = this.#timers.setTimeout(
          () => this.beginStop("timeout"),
          Math.max(1, request.safetyDeadlineMs),
        );
        this.#activeSearch = {
          request,
          game,
          resolve,
          mode: "searching",
          depth: 0,
          nodes: 0,
          score: 0,
          deadlineTimer,
          graceTimer: null,
          stopPromise: null,
          stopResolve: null,
        };
        this.command(`position fen ${fen}`);
        this.command(`go depth ${request.depthCeiling} nodes ${request.nodeBudget}`);
      });
    } catch (error) {
      return failure("unavailable", error instanceof Error ? error.message : "Master initialization failed.");
    } finally {
      if (this.#startingRequest === request) this.#startingRequest = null;
      if (this.#cancelledStartingRequest === request) this.#cancelledStartingRequest = null;
    }
  }

  stop(identity: OpponentIdentityV1): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const active = this.#activeSearch;
    if (active && sameIdentity(active.request, identity)) {
      if (active.stopPromise) return active.stopPromise;
      active.stopPromise = new Promise<void>((resolve) => { active.stopResolve = resolve; });
      this.beginStop("cancelled");
      return active.stopPromise;
    }
    if (this.#startingRequest && sameIdentity(this.#startingRequest, identity)) {
      this.#cancelledStartingRequest = this.#startingRequest;
    }
    return Promise.resolve();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.rejectWaiters(new Error("Master engine adapter is disposed."));
    this.settleSearch(failure("cancelled", "The Master engine adapter was disposed."));
    if (this.#worker) {
      try {
        this.#worker.postMessage({ type: "dispose" });
      } finally {
        this.destroyWorker();
      }
    }
  }

  private async boot(): Promise<void> {
    const assets = await this.#assetLoader();
    if (this.#disposed) throw new Error("Master engine adapter is disposed.");
    const worker = this.#workerFactory();
    this.#worker = worker;
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleError);
    const booted = this.waitForBoot();
    const glue = assets.files["stockfish.js"];
    const wasm = assets.files["stockfish.wasm"];
    const pthread = assets.files["stockfish.worker.js"];
    const network = assets.files["xiangqi-c07e94a5c7cb.nnue"];
    worker.postMessage({
      type: "boot",
      networkPath: NETWORK_PATH,
      assets: { glue, wasm, pthread, network },
    }, [glue, wasm, pthread, network]);
    await booted;

    this.#advertisesVariant = false;
    this.#advertisesEvalFile = false;
    await this.commandAndWait("uci", (line) => line === "uciok", "uciok");
    if (!this.#advertisesVariant || !this.#advertisesEvalFile) {
      throw new Error("Master UCI options do not advertise Xiangqi and EvalFile.");
    }
    this.command("setoption name UCI_Variant value xiangqi");
    this.command(`setoption name EvalFile value ${NETWORK_PATH}`);
    await this.commandAndWait("isready", (line) => line === "readyok", "readyok after NNUE load");
    this.#initialized = true;
  }

  private command(line: string): void {
    if (!this.#worker) throw new Error("Master engine Worker is unavailable.");
    this.#worker.postMessage({ type: "command", line });
  }

  private commandAndWait(
    command: string,
    predicate: (line: string) => boolean,
    label: string,
  ): Promise<void> {
    const pending = this.waitForLine(predicate, label);
    this.command(command);
    return pending;
  }

  private waitForBoot(): Promise<void> {
    if (this.#bootWaiter) return Promise.reject(new Error("Master boot waiter is already active."));
    return new Promise((resolve, reject) => {
      const timer = this.#timers.setTimeout(() => {
        if (this.#bootWaiter?.timer !== timer) return;
        this.#bootWaiter = null;
        reject(new Error("Timed out waiting for Master Worker boot."));
      }, this.#handshakeTimeoutMs);
      this.#bootWaiter = { resolve, reject, timer };
    });
  }

  private waitForLine(predicate: (line: string) => boolean, label: string): Promise<void> {
    if (this.#lineWaiter) return Promise.reject(new Error("Master UCI waiter is already active."));
    return new Promise((resolve, reject) => {
      const timer = this.#timers.setTimeout(() => {
        if (this.#lineWaiter?.timer !== timer) return;
        this.#lineWaiter = null;
        reject(new Error(`Timed out waiting for ${label}.`));
      }, this.#handshakeTimeoutMs);
      this.#lineWaiter = { predicate, resolve, reject, timer, quietTimer: null };
    });
  }

  private beginStop(mode: "cancelled" | "timeout"): void {
    const active = this.#activeSearch;
    if (!active) return;
    if (active.mode === "searching") active.mode = mode;
    if (active.graceTimer !== null) return;
    try {
      this.command("stop");
    } catch {
      this.forceTerminateSearch();
      return;
    }
    active.graceTimer = this.#timers.setTimeout(() => this.forceTerminateSearch(), this.#stopGraceMs);
  }

  private forceTerminateSearch(): void {
    const active = this.#activeSearch;
    if (!active) return;
    const outcome = active.mode === "timeout"
      ? failure("timeout", "The Master search timed out.")
      : failure("cancelled", "The Master search was stopped.");
    this.destroyWorker();
    this.settleSearch(outcome);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const message = parseHostMessage(event.data);
    if (!message) return;
    if (message.type === "booted") {
      const waiter = this.#bootWaiter;
      if (!waiter) return;
      this.#bootWaiter = null;
      this.#timers.clearTimeout(waiter.timer);
      waiter.resolve();
      return;
    }
    if (message.type === "boot-error") {
      this.rejectWaiters(new Error(`Master Worker boot failed: ${message.message}`));
      return;
    }
    if (message.type === "exit") {
      if (!this.#disposed && message.code !== 0) this.handleError();
      return;
    }
    this.handleLine(message.line.trim());
  };

  private handleLine(line: string): void {
    if (/^option name UCI_Variant .*(?:^|\s)var xiangqi(?:\s|$)/.test(line)) {
      this.#advertisesVariant = true;
    }
    if (line.startsWith("option name EvalFile ")) this.#advertisesEvalFile = true;
    const waiter = this.#lineWaiter;
    if (waiter && waiter.predicate(line)) {
      // UCI has no request IDs. Waiting for one quiet task before advancing
      // drains duplicate tokens from this state instead of letting a trailing
      // readyok satisfy the next isready transition.
      if (waiter.quietTimer !== null) this.#timers.clearTimeout(waiter.quietTimer);
      waiter.quietTimer = this.#timers.setTimeout(() => {
        if (this.#lineWaiter !== waiter) return;
        this.#lineWaiter = null;
        this.#timers.clearTimeout(waiter.timer);
        waiter.resolve();
      }, 0);
      return;
    }

    const active = this.#activeSearch;
    if (!active) return;
    const info = parseInfo(line);
    if (info.depth !== undefined) active.depth = info.depth;
    if (info.nodes !== undefined) active.nodes = info.nodes;
    if (info.score !== undefined) active.score = info.score;
    const bestmove = /^bestmove (\S+)(?:\s|$)/.exec(line);
    if (!bestmove) return;
    const bestmoveUci = bestmove[1];
    if (!bestmoveUci) return;
    if (active.mode !== "searching") {
      this.settleSearch(active.mode === "timeout"
        ? failure("timeout", "The Master search timed out.")
        : failure("cancelled", "The Master search was stopped."));
      return;
    }
    try {
      const candidate = moveFromUci(bestmoveUci);
      const piece = getPieceAt(active.game, candidate.from);
      const legal = piece?.side === active.game.sideToMove
        && getLegalMoves(active.game, piece.id).some(
          (square) => square.file === candidate.to.file && square.rank === candidate.to.rank,
        );
      if (!legal) throw new Error("Master bestmove is illegal in the authoritative position.");
      this.settleSearch(Object.freeze({
        ok: true,
        result: Object.freeze({
          protocolVersion: 1,
          type: "result",
          matchId: active.request.matchId,
          generation: active.request.generation,
          requestId: active.request.requestId,
          positionRevision: active.request.positionRevision,
          positionFingerprint: active.request.positionFingerprint,
          sideToMove: active.request.sideToMove,
          candidate,
          completedDepth: active.depth,
          nodes: active.nodes,
          score: active.score,
        }),
      }));
    } catch {
      this.settleSearch(failure("failed", "Master returned a malformed bestmove."));
    }
  }

  private readonly handleError = (): void => {
    if (this.#disposed) return;
    const error = new Error("The Master engine Worker failed.");
    this.rejectWaiters(error);
    this.destroyWorker();
    this.settleSearch(failure("failed", error.message));
  };

  private settleSearch(outcome: OpponentProviderOutcome): void {
    const active = this.#activeSearch;
    if (!active) return;
    this.#activeSearch = null;
    this.#timers.clearTimeout(active.deadlineTimer);
    if (active.graceTimer !== null) this.#timers.clearTimeout(active.graceTimer);
    active.stopResolve?.();
    active.resolve(outcome);
  }

  private rejectWaiters(error: Error): void {
    const boot = this.#bootWaiter;
    this.#bootWaiter = null;
    if (boot) {
      this.#timers.clearTimeout(boot.timer);
      boot.reject(error);
    }
    const line = this.#lineWaiter;
    this.#lineWaiter = null;
    if (line) {
      this.#timers.clearTimeout(line.timer);
      if (line.quietTimer !== null) this.#timers.clearTimeout(line.quietTimer);
      line.reject(error);
    }
  }

  private destroyWorker(): void {
    const worker = this.#worker;
    this.#worker = null;
    this.#initialized = false;
    this.#initialization = null;
    this.#currentMatchId = null;
    if (!worker) return;
    worker.removeEventListener("message", this.handleMessage);
    worker.removeEventListener("error", this.handleError);
    worker.terminate();
  }
}

export async function createMasterEngineProvider(): Promise<MasterEngineAdapter> {
  const capabilities = assessMasterCapabilities();
  if (!capabilities.supported) throw new MasterCapabilityError(capabilities.missing);
  const provider = new MasterEngineAdapter();
  try {
    await provider.initialize();
    return provider;
  } catch (error) {
    provider.dispose();
    throw error;
  }
}
