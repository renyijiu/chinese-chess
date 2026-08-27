import {
  POPULAR_RULESET_ID,
  XIANGQI_SCHEMA_VERSION,
  dispatch,
  serializeGame,
  type GameCommand,
  type GameState,
  type MoveCommand,
  type Side,
} from "../../../lib/xiangqi/index";
import {
  ONLINE_PROTOCOL_VERSION,
  decodeOnlineMessageV1,
  encodeOnlineMessageV1,
  validateSnapshotForFastForwardV1,
  type CommandMessageV1,
  type ErrorMessageV1,
  type HelloMessageV1,
  type OnlineErrorCodeV1,
  type OnlineIntentV1,
  type OnlineMessageV1,
  type OnlineWireFrame,
  type SignalingRole,
  type SnapshotMessageV1,
  type SnapshotRequestMessageV1,
} from "../../../lib/xiangqi/online/index";

export type OnlineMatchCoordinatorPhase =
  | "idle"
  | "handshaking"
  | "awaiting-ready"
  | "playable"
  | "awaiting-ack"
  | "syncing"
  | "terminal"
  | "repair-required"
  | "failed"
  | "disposed";

export interface OnlinePendingCommand {
  readonly commandId: string;
  readonly messageSeq: number;
  readonly expectedRevision: number;
  readonly afterRevision: number;
  readonly afterHash: string;
}

export interface OnlineCoordinatorError {
  readonly code: OnlineErrorCodeV1;
  readonly fatal: boolean;
  readonly relatedSeq: number;
}

export interface OnlineMatchCoordinatorSnapshot {
  readonly phase: OnlineMatchCoordinatorPhase;
  readonly localReady: boolean;
  readonly remoteReady: boolean;
  readonly pending: OnlinePendingCommand | null;
  readonly error: OnlineCoordinatorError | null;
  readonly revision: number;
  readonly hash: string | null;
}

export interface OnlineMatchIdentity {
  readonly pairingId: string;
  readonly sessionId: string;
  readonly matchId: string;
  readonly localPeerId: string;
  readonly remotePeerId: string;
  readonly signalingRole: SignalingRole;
  readonly localSide: Side;
  readonly intent: OnlineIntentV1;
}

export type OnlineCoordinatorSendResult =
  | Readonly<{ ok: true; queued?: boolean }>
  | Readonly<{ ok: false; reason?: string }>;

export type OnlineCommandCommitResult = Readonly<{
  status: "committed" | "rejected" | "superseded";
}>;

export interface OnlineCommitContext {
  readonly origin: "local" | "remote";
  readonly commandId: string;
  readonly senderPeerId: string;
  readonly messageSeq: number | null;
}

export interface OnlineMatchCoordinatorTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OnlineMatchCoordinatorOptions {
  readonly identity: OnlineMatchIdentity;
  readonly send: (frame: string) => OnlineCoordinatorSendResult;
  readonly getGame: () => GameState;
  readonly commitCommand: (
    command: GameCommand,
    context: OnlineCommitContext,
  ) => Promise<OnlineCommandCommitResult>;
  readonly installRecoveredGame: (game: GameState) => Promise<boolean>;
  readonly digest: (canonicalSerializedGame: string) => string | Promise<string>;
  readonly createId: () => string;
  readonly timers: OnlineMatchCoordinatorTimers;
}

export type OnlineCoordinatorActionFailureReason =
  | "already-started"
  | "invalid-phase"
  | "not-local-turn"
  | "invalid-command"
  | "commit-failed"
  | "state-mismatch"
  | "send-failed"
  | "disposed";

export type OnlineCoordinatorActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: OnlineCoordinatorActionFailureReason }>;

type OutgoingPayload = OnlineMessageV1 extends infer Message
  ? Message extends OnlineMessageV1
    ? Omit<Message, "v" | "pairingId" | "sessionId" | "matchId" | "senderPeerId" | "seq">
    : never
  : never;

interface PreparedMessage {
  readonly message: OnlineMessageV1;
  readonly frame: string;
}

interface GameFingerprint {
  readonly game: GameState;
  readonly serialized: string;
  readonly revision: number;
  readonly hash: string;
}

interface RemoteHelloState {
  readonly revision: number;
  readonly hash: string;
  readonly snapshotSupported: boolean;
}

interface ActiveSnapshotRequest {
  readonly requestId: string;
  readonly remoteRevision: number;
  readonly remoteHash: string;
}

interface CachedCommandReceipt {
  readonly signature: string;
  readonly ackFrame: string;
}

const MAX_CACHED_RECEIPTS = 512;

function oppositeSide(side: Side): Side {
  return side === "red" ? "black" : "red";
}

function oppositeRole(role: SignalingRole): SignalingRole {
  return role === "host" ? "guest" : "host";
}

function actionFailure(reason: OnlineCoordinatorActionFailureReason): OnlineCoordinatorActionResult {
  return { ok: false, reason };
}

function commandSignature(message: CommandMessageV1): string {
  return JSON.stringify({
    commandId: message.commandId,
    actorSide: message.actorSide,
    expectedRevision: message.expectedRevision,
    beforeHash: message.beforeHash,
    command: message.command,
    afterRevision: message.afterRevision,
    afterHash: message.afterHash,
  });
}

/**
 * Serializes the online protocol around injected authoritative game callbacks.
 * It owns protocol state and receipts, but never owns transport, React, or the
 * mutable game state itself.
 */
export class OnlineMatchCoordinator {
  readonly #identity: OnlineMatchIdentity;
  readonly #send: OnlineMatchCoordinatorOptions["send"];
  readonly #getGame: OnlineMatchCoordinatorOptions["getGame"];
  readonly #commitCommand: OnlineMatchCoordinatorOptions["commitCommand"];
  readonly #installRecoveredGame: OnlineMatchCoordinatorOptions["installRecoveredGame"];
  readonly #digest: OnlineMatchCoordinatorOptions["digest"];
  readonly #createId: OnlineMatchCoordinatorOptions["createId"];
  readonly #subscribers = new Set<(snapshot: OnlineMatchCoordinatorSnapshot) => void>();
  readonly #receipts = new Map<string, CachedCommandReceipt>();

  #chain: Promise<void> = Promise.resolve();
  #generation = 1;
  #nextLocalSeq = 1;
  #nextRemoteSeq = 1;
  #readySentKey: string | null = null;
  #remoteHello: RemoteHelloState | null = null;
  #activeSnapshotRequest: ActiveSnapshotRequest | null = null;
  #fingerprintCache: GameFingerprint | null = null;
  #snapshot: OnlineMatchCoordinatorSnapshot;

  constructor(options: OnlineMatchCoordinatorOptions) {
    this.#identity = options.identity;
    this.#send = options.send;
    this.#getGame = options.getGame;
    this.#commitCommand = options.commitCommand;
    this.#installRecoveredGame = options.installRecoveredGame;
    this.#digest = options.digest;
    this.#createId = options.createId;
    const game = options.getGame();
    this.#snapshot = Object.freeze({
      phase: "idle",
      localReady: false,
      remoteReady: false,
      pending: null,
      error: null,
      revision: game.revision,
      hash: null,
    });
  }

  getSnapshot(): OnlineMatchCoordinatorSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: OnlineMatchCoordinatorSnapshot) => void): () => void {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  whenIdle(): Promise<void> {
    return this.#chain;
  }

  start(): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      if (this.#snapshot.phase !== "idle") return actionFailure("already-started");
      this.#publish({ phase: "handshaking", error: null });
      try {
        const current = await this.#fingerprint();
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        this.#publishFingerprint(current);
        return this.#sendHello(current, generation)
          ? { ok: true }
          : actionFailure("send-failed");
      } catch {
        if (this.#isCurrent(generation)) this.#lock("failed", "internal-error", true, 0, generation);
        return this.#isCurrent(generation)
          ? actionFailure("send-failed")
          : actionFailure("disposed");
      }
    });
  }

  handleFrame(frame: OnlineWireFrame): Promise<void> {
    return this.#enqueueVoid(async (generation) => {
      const decoded = decodeOnlineMessageV1(frame);
      if (!decoded.ok) {
        const code: OnlineErrorCodeV1 = decoded.error.code === "version"
          ? "unsupported-version"
          : decoded.error.code === "size"
            ? "message-too-large"
            : "invalid-message";
        this.#lock("failed", code, true, 0, generation);
        return;
      }
      const message = decoded.value;
      if (!this.#hasRemoteIdentity(message)) {
        this.#lock("failed", "identity-mismatch", true, message.seq, generation);
        return;
      }
      if (message.seq < this.#nextRemoteSeq) {
        if (message.type === "command") {
          if (this.#receipts.has(message.commandId)) {
            this.#replayCachedReceipt(message, generation);
          } else {
            this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
          }
        }
        return;
      }
      if (message.seq > this.#nextRemoteSeq) {
        this.#lock("repair-required", "sequence-gap", true, message.seq, generation);
        return;
      }
      this.#nextRemoteSeq += 1;

      switch (message.type) {
        case "hello":
          await this.#handleHello(message, generation);
          return;
        case "ready":
          await this.#handleReady(message, generation);
          return;
        case "command":
          await this.#handleRemoteCommand(message, generation);
          return;
        case "ack":
          await this.#handleAck(message, generation);
          return;
        case "snapshot-request":
          await this.#handleSnapshotRequest(message, generation);
          return;
        case "snapshot":
          await this.#handleSnapshot(message, generation);
          return;
        case "ping":
          await this.#handlePing(message, generation);
          return;
        case "pong":
          await this.#handlePong(message, generation);
          return;
        case "error":
          this.#handleRemoteError(message);
          return;
        case "resign":
        case "rematch":
          this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
          return;
      }
    });
  }

  setLocalReady(): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      if (this.#snapshot.phase !== "awaiting-ready" && this.#snapshot.phase !== "playable") {
        return actionFailure("invalid-phase");
      }
      this.#publish({ localReady: true });
      try {
        const current = await this.#fingerprint();
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        if (!this.#readyMatches(current)) {
          this.#lock("repair-required", "position-mismatch", true, 0, generation);
          return actionFailure("state-mismatch");
        }
        if (!this.#sendReady(current, generation)) return actionFailure("send-failed");
        this.#publishPlayableIfReady(current.game);
        return { ok: true };
      } catch {
        if (this.#isCurrent(generation)) this.#lock("failed", "internal-error", true, 0, generation);
        return this.#isCurrent(generation)
          ? actionFailure("send-failed")
          : actionFailure("disposed");
      }
    });
  }

  submitLocalMove(command: MoveCommand): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      if (this.#snapshot.phase !== "playable" || this.#snapshot.pending !== null) {
        return actionFailure("invalid-phase");
      }

      try {
        const before = await this.#fingerprint();
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        if (before.game.status.kind !== "playing" || before.game.sideToMove !== this.#identity.localSide) {
          return actionFailure("not-local-turn");
        }
        if (!this.#snapshotMatches(before)) {
          this.#lock("repair-required", "position-mismatch", true, 0, generation);
          return actionFailure("state-mismatch");
        }

        const preview = dispatch(before.game, command);
        if (preview.error) return actionFailure("invalid-command");
        const previewFingerprint = await this.#fingerprint(preview.state);
        const afterHash = previewFingerprint.hash;
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        const commandId = this.#createId();
        const receipt = await this.#commitCommand(command, {
          origin: "local",
          commandId,
          senderPeerId: this.#identity.localPeerId,
          messageSeq: null,
        });
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        if (receipt.status !== "committed") {
          this.#lock("failed", "internal-error", true, 0, generation);
          return actionFailure("commit-failed");
        }

        const actual = await this.#fingerprint();
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        if (actual.revision !== preview.state.revision || actual.hash !== afterHash) {
          this.#publishFingerprint(actual);
          this.#lock("repair-required", "position-mismatch", true, 0, generation);
          return actionFailure("state-mismatch");
        }
        this.#publishFingerprint(actual);

        const prepared = this.#prepareMessage({
          type: "command",
          commandId,
          actorSide: this.#identity.localSide,
          expectedRevision: before.revision,
          beforeHash: before.hash,
          command: { type: "move", from: command.from, to: command.to },
          afterRevision: actual.revision,
          afterHash: actual.hash,
        });
        if (!prepared || !this.#transmit(prepared, generation)) return actionFailure("send-failed");
        this.#publish({
          phase: "awaiting-ack",
          pending: Object.freeze({
            commandId,
            messageSeq: prepared.message.seq,
            expectedRevision: before.revision,
            afterRevision: actual.revision,
            afterHash: actual.hash,
          }),
          error: null,
        });
        return { ok: true };
      } catch {
        if (this.#isCurrent(generation)) this.#lock("failed", "internal-error", true, 0, generation);
        return this.#isCurrent(generation)
          ? actionFailure("commit-failed")
          : actionFailure("disposed");
      }
    });
  }

  dispose(): void {
    if (this.#snapshot.phase === "disposed") return;
    this.#generation += 1;
    this.#activeSnapshotRequest = null;
    this.#fingerprintCache = null;
    this.#receipts.clear();
    this.#publish({
      phase: "disposed",
      pending: null,
      error: null,
    });
    this.#subscribers.clear();
  }

  #enqueueAction(
    work: (generation: number) => Promise<OnlineCoordinatorActionResult>,
  ): Promise<OnlineCoordinatorActionResult> {
    const generation = this.#generation;
    const pending = this.#chain.then(() => this.#isCurrent(generation)
      ? work(generation)
      : actionFailure("disposed"));
    this.#chain = pending.then(() => undefined, () => undefined);
    return pending;
  }

  #enqueueVoid(work: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.#generation;
    const pending = this.#chain.then(async () => {
      if (!this.#isCurrent(generation)) return;
      try {
        await work(generation);
      } catch {
        if (this.#isCurrent(generation)) this.#lock("failed", "internal-error", true, 0, generation);
      }
    });
    this.#chain = pending.then(() => undefined, () => undefined);
    return pending;
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#snapshot.phase !== "disposed";
  }

  async #fingerprint(game = this.#getGame()): Promise<GameFingerprint> {
    if (this.#fingerprintCache?.game === game) return this.#fingerprintCache;
    const serialized = serializeGame(game);
    const hash = await this.#digest(serialized);
    const fingerprint = { game, serialized, revision: game.revision, hash };
    this.#fingerprintCache = fingerprint;
    return fingerprint;
  }

  #publish(patch: Partial<OnlineMatchCoordinatorSnapshot>): void {
    const changed = (Object.keys(patch) as Array<keyof OnlineMatchCoordinatorSnapshot>)
      .some((key) => !Object.is(this.#snapshot[key], patch[key]));
    if (!changed) return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
    for (const listener of [...this.#subscribers]) {
      try {
        listener(this.#snapshot);
      } catch {
        continue;
      }
    }
  }

  #publishFingerprint(current: GameFingerprint): void {
    this.#publish({ revision: current.revision, hash: current.hash });
  }

  #snapshotMatches(current: GameFingerprint): boolean {
    return this.#snapshot.revision === current.revision && this.#snapshot.hash === current.hash;
  }

  #readyMatches(current: GameFingerprint): boolean {
    return this.#remoteHello !== null
      && this.#remoteHello.revision === current.revision
      && this.#remoteHello.hash === current.hash;
  }

  #prepareMessage(payload: OutgoingPayload): PreparedMessage | null {
    const message = {
      ...payload,
      v: ONLINE_PROTOCOL_VERSION,
      pairingId: this.#identity.pairingId,
      sessionId: this.#identity.sessionId,
      matchId: this.#identity.matchId,
      senderPeerId: this.#identity.localPeerId,
      seq: this.#nextLocalSeq,
    } as OnlineMessageV1;
    const encoded = encodeOnlineMessageV1(message);
    return encoded.ok ? { message, frame: encoded.value } : null;
  }

  #transmit(prepared: PreparedMessage, generation: number): boolean {
    if (!this.#isCurrent(generation)) return false;
    let result: OnlineCoordinatorSendResult;
    try {
      result = this.#send(prepared.frame);
    } catch {
      result = { ok: false, reason: "send-error" };
    }
    if (!result.ok) {
      this.#lock("failed", "internal-error", true, prepared.message.seq, generation, false);
      return false;
    }
    this.#nextLocalSeq += 1;
    return true;
  }

  #sendPayload(payload: OutgoingPayload, generation: number): PreparedMessage | null {
    const prepared = this.#prepareMessage(payload);
    if (!prepared) {
      this.#lock("failed", "internal-error", true, 0, generation);
      return null;
    }
    return this.#transmit(prepared, generation) ? prepared : null;
  }

  #sendHello(current: GameFingerprint, generation: number): boolean {
    return this.#sendPayload({
      type: "hello",
      intent: this.#identity.intent,
      signalingRole: this.#identity.signalingRole,
      side: this.#identity.localSide,
      gameSchemaVersion: XIANGQI_SCHEMA_VERSION,
      ruleset: POPULAR_RULESET_ID,
      revision: current.revision,
      positionHash: current.hash,
      features: ["snapshot-v1"],
    }, generation) !== null;
  }

  #sendReady(current: GameFingerprint, generation: number): boolean {
    const key = `${current.revision}:${current.hash}`;
    if (this.#readySentKey === key) return true;
    const sent = this.#sendPayload({
      type: "ready",
      revision: current.revision,
      positionHash: current.hash,
    }, generation);
    if (!sent) return false;
    this.#readySentKey = key;
    return true;
  }

  #trySendError(
    code: OnlineErrorCodeV1,
    fatal: boolean,
    relatedSeq: number,
    generation: number,
  ): void {
    if (!this.#isCurrent(generation)) return;
    const prepared = this.#prepareMessage({ type: "error", code, fatal, relatedSeq });
    if (!prepared) return;
    try {
      const result = this.#send(prepared.frame);
      if (result.ok) this.#nextLocalSeq += 1;
    } catch {
      return;
    }
  }

  #lock(
    phase: "repair-required" | "failed",
    code: OnlineErrorCodeV1,
    fatal: boolean,
    relatedSeq: number,
    generation: number,
    emit = true,
  ): void {
    if (!this.#isCurrent(generation)) return;
    this.#activeSnapshotRequest = null;
    this.#publish({
      phase,
      pending: null,
      error: Object.freeze({ code, fatal, relatedSeq }),
    });
    if (emit) this.#trySendError(code, fatal, relatedSeq, generation);
  }

  #rejectWithoutMutation(
    code: OnlineErrorCodeV1,
    relatedSeq: number,
    generation: number,
  ): void {
    this.#publish({ error: Object.freeze({ code, fatal: false, relatedSeq }) });
    this.#trySendError(code, false, relatedSeq, generation);
  }

  #hasRemoteIdentity(message: OnlineMessageV1): boolean {
    return message.pairingId === this.#identity.pairingId
      && message.sessionId === this.#identity.sessionId
      && message.matchId === this.#identity.matchId
      && message.senderPeerId === this.#identity.remotePeerId
      && message.senderPeerId !== this.#identity.localPeerId;
  }

  async #handleHello(message: HelloMessageV1, generation: number): Promise<void> {
    if (message.signalingRole !== oppositeRole(this.#identity.signalingRole)
      || message.side !== oppositeSide(this.#identity.localSide)
      || message.intent !== this.#identity.intent
      || message.gameSchemaVersion !== XIANGQI_SCHEMA_VERSION
      || message.ruleset !== POPULAR_RULESET_ID) {
      this.#lock("failed", "identity-mismatch", true, message.seq, generation);
      return;
    }

    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    this.#publishFingerprint(current);
    const snapshotSupported = message.features.includes("snapshot-v1");
    this.#remoteHello = {
      revision: message.revision,
      hash: message.positionHash,
      snapshotSupported,
    };
    this.#readySentKey = null;
    this.#publish({ remoteReady: false, error: null });

    if (message.revision === current.revision) {
      if (message.positionHash !== current.hash) {
        this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
        return;
      }
      this.#activeSnapshotRequest = null;
      this.#publish({ phase: "awaiting-ready" });
      if (this.#snapshot.localReady && !this.#sendReady(current, generation)) return;
      this.#publishPlayableIfReady(current.game);
      return;
    }

    if (!snapshotSupported) {
      this.#lock("repair-required", "recovery-conflict", true, message.seq, generation);
      return;
    }

    this.#publish({ phase: "syncing" });
    if (message.revision < current.revision) {
      this.#activeSnapshotRequest = null;
      return;
    }

    const requestId = this.#createId();
    this.#activeSnapshotRequest = {
      requestId,
      remoteRevision: message.revision,
      remoteHash: message.positionHash,
    };
    this.#sendPayload({
      type: "snapshot-request",
      requestId,
      reason: "snapshot-required",
      knownRevision: current.revision,
      knownHash: current.hash,
    }, generation);
  }

  async #handleReady(
    message: Extract<OnlineMessageV1, { type: "ready" }>,
    generation: number,
  ): Promise<void> {
    if (this.#snapshot.phase !== "awaiting-ready" && this.#snapshot.phase !== "playable") {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (!this.#readyMatches(current)
      || message.revision !== current.revision
      || message.positionHash !== current.hash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#publish({ remoteReady: true, revision: current.revision, hash: current.hash, error: null });
    this.#publishPlayableIfReady(current.game);
  }

  #publishPlayableIfReady(game: GameState): void {
    if (!this.#snapshot.localReady || !this.#snapshot.remoteReady) return;
    this.#publish({ phase: game.status.kind === "ended" ? "terminal" : "playable" });
  }

  async #handleRemoteCommand(message: CommandMessageV1, generation: number): Promise<void> {
    const cached = this.#receipts.get(message.commandId);
    if (cached) {
      this.#replayCachedReceipt(message, generation);
      return;
    }
    if (this.#snapshot.phase !== "playable" || this.#snapshot.pending !== null) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const remoteSide = oppositeSide(this.#identity.localSide);
    const before = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (message.actorSide !== remoteSide || before.game.sideToMove !== remoteSide) {
      this.#lock("repair-required", "invalid-command", true, message.seq, generation);
      return;
    }
    if (message.expectedRevision !== before.revision || message.beforeHash !== before.hash) {
      const code = message.expectedRevision !== before.revision ? "stale-revision" : "position-mismatch";
      this.#lock("repair-required", code, true, message.seq, generation);
      return;
    }

    const command: MoveCommand = {
      type: "move",
      expectedRevision: message.expectedRevision,
      from: message.command.from,
      to: message.command.to,
    };
    const preview = dispatch(before.game, command);
    if (preview.error) {
      this.#lock("repair-required", "invalid-command", true, message.seq, generation);
      return;
    }
    const previewHash = (await this.#fingerprint(preview.state)).hash;
    if (!this.#isCurrent(generation)) return;
    if (message.afterRevision !== preview.state.revision || message.afterHash !== previewHash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }

    const receipt = await this.#commitCommand(command, {
      origin: "remote",
      commandId: message.commandId,
      senderPeerId: message.senderPeerId,
      messageSeq: message.seq,
    });
    if (!this.#isCurrent(generation)) return;
    if (receipt.status !== "committed") {
      this.#lock("failed", "internal-error", true, message.seq, generation);
      return;
    }
    const actual = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (actual.revision !== message.afterRevision || actual.hash !== message.afterHash) {
      this.#publishFingerprint(actual);
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#publish({
      phase: actual.game.status.kind === "ended" ? "terminal" : "playable",
      revision: actual.revision,
      hash: actual.hash,
      error: null,
    });

    const ack = this.#prepareMessage({
      type: "ack",
      ackedMessageId: message.commandId,
      ackedSeq: message.seq,
      status: "applied",
      revision: actual.revision,
      positionHash: actual.hash,
    });
    if (!ack) {
      this.#lock("failed", "internal-error", true, message.seq, generation);
      return;
    }
    this.#cacheReceipt(message, ack.frame);
    this.#transmit(ack, generation);
  }

  #cacheReceipt(message: CommandMessageV1, ackFrame: string): void {
    this.#receipts.set(message.commandId, {
      signature: commandSignature(message),
      ackFrame,
    });
    if (this.#receipts.size <= MAX_CACHED_RECEIPTS) return;
    const oldest = this.#receipts.keys().next().value as string | undefined;
    if (oldest) this.#receipts.delete(oldest);
  }

  #replayCachedReceipt(message: CommandMessageV1, generation: number): void {
    const cached = this.#receipts.get(message.commandId);
    if (!cached) return;
    if (cached.signature !== commandSignature(message)) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    try {
      const result = this.#send(cached.ackFrame);
      if (!result.ok) this.#lock("failed", "internal-error", true, message.seq, generation, false);
    } catch {
      this.#lock("failed", "internal-error", true, message.seq, generation, false);
    }
  }

  async #handleAck(
    message: Extract<OnlineMessageV1, { type: "ack" }>,
    generation: number,
  ): Promise<void> {
    const pending = this.#snapshot.pending;
    if (this.#snapshot.phase !== "awaiting-ack" || pending === null
      || message.ackedMessageId !== pending.commandId
      || message.ackedSeq !== pending.messageSeq
      || message.revision !== pending.afterRevision
      || message.positionHash !== pending.afterHash) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (current.revision !== pending.afterRevision || current.hash !== pending.afterHash) {
      this.#publishFingerprint(current);
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#publish({
      phase: current.game.status.kind === "ended" ? "terminal" : "playable",
      pending: null,
      error: null,
      revision: current.revision,
      hash: current.hash,
    });
  }

  async #handleSnapshotRequest(
    message: SnapshotRequestMessageV1,
    generation: number,
  ): Promise<void> {
    if (this.#snapshot.phase !== "syncing"
      || this.#activeSnapshotRequest !== null
      || this.#remoteHello === null
      || message.knownRevision !== this.#remoteHello.revision
      || message.knownHash !== this.#remoteHello.hash) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (current.revision <= message.knownRevision) {
      this.#lock("repair-required", "recovery-conflict", true, message.seq, generation);
      return;
    }
    this.#publishFingerprint(current);
    const sent = this.#sendPayload({
      type: "snapshot",
      requestId: message.requestId,
      revision: current.revision,
      positionHash: current.hash,
      serializedGame: current.serialized,
    }, generation);
    if (sent) this.#publish({ phase: "handshaking" });
  }

  async #handleSnapshot(message: SnapshotMessageV1, generation: number): Promise<void> {
    const request = this.#activeSnapshotRequest;
    if (this.#snapshot.phase !== "syncing"
      || request === null
      || message.requestId !== request.requestId
      || message.revision !== request.remoteRevision
      || message.positionHash !== request.remoteHash) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const local = this.#getGame();
    const validated = await validateSnapshotForFastForwardV1(local, message, this.#digest);
    if (!this.#isCurrent(generation)) return;
    if (!validated.ok || validated.status !== "fast-forward") {
      this.#lock("repair-required", "recovery-conflict", true, message.seq, generation);
      return;
    }
    const installed = await this.#installRecoveredGame(validated.game);
    if (!this.#isCurrent(generation)) return;
    if (!installed) {
      this.#lock("failed", "internal-error", true, message.seq, generation);
      return;
    }
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (current.revision !== message.revision || current.hash !== message.positionHash) {
      this.#publishFingerprint(current);
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }

    this.#activeSnapshotRequest = null;
    this.#readySentKey = null;
    this.#publish({
      phase: "handshaking",
      remoteReady: false,
      revision: current.revision,
      hash: current.hash,
      error: null,
    });
    if (!this.#sendHello(current, generation)) return;
    this.#publish({ phase: "awaiting-ready" });
    if (this.#snapshot.localReady) this.#sendReady(current, generation);
  }

  async #handlePing(
    message: Extract<OnlineMessageV1, { type: "ping" }>,
    generation: number,
  ): Promise<void> {
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    this.#publishFingerprint(current);
    this.#sendPayload({
      type: "pong",
      nonce: message.nonce,
      revision: current.revision,
      positionHash: current.hash,
    }, generation);
  }

  async #handlePong(
    message: Extract<OnlineMessageV1, { type: "pong" }>,
    generation: number,
  ): Promise<void> {
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    this.#publishFingerprint(current);
    if (message.revision !== current.revision || message.positionHash !== current.hash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#publish({ error: null });
  }

  #handleRemoteError(message: ErrorMessageV1): void {
    const preserveRepair = this.#snapshot.phase === "repair-required";
    this.#publish({
      phase: message.fatal && !preserveRepair ? "failed" : this.#snapshot.phase,
      pending: message.fatal && !preserveRepair ? null : this.#snapshot.pending,
      error: Object.freeze({
        code: message.code,
        fatal: message.fatal,
        relatedSeq: message.relatedSeq,
      }),
    });
  }
}
