import {
  POPULAR_RULESET_ID,
  XIANGQI_SCHEMA_VERSION,
  createInitialGame,
  dispatch,
  serializeGame,
  type GameCommand,
  type GameState,
  type MoveCommand,
  type ReplayCommand,
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
  type OnlineLivenessPurposeV1,
  type OnlineMessageV1,
  type OnlineWireFrame,
  type RematchMessageV1,
  type ResignCommitMessageV1,
  type ResignMessageV1,
  type ResignRequestMessageV1,
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
  | "stalled"
  | "revalidating"
  | "repair-required"
  | "failed"
  | "disposed";

export interface OnlinePendingCommand {
  readonly kind: "move";
  readonly commandId: string;
  readonly messageSeq: number;
  readonly expectedRevision: number;
  readonly afterRevision: number;
  readonly afterHash: string;
}

export interface OnlinePendingResign {
  readonly kind: "resign";
  readonly stage: "request" | "commit";
  readonly proposalId: string;
  readonly commandId: string | null;
  readonly messageSeq: number;
  readonly resigningSide: Side;
  readonly expectedRevision: number;
  readonly afterRevision: number | null;
  readonly afterHash: string | null;
}

export type OnlinePendingOperation = OnlinePendingCommand | OnlinePendingResign;

export type OnlineCoordinatorIssue =
  | Readonly<{ kind: "ack-timeout"; relatedId: string }>
  | Readonly<{ kind: "pong-timeout"; relatedId: string }>
  | Readonly<{ kind: "transport-unavailable"; relatedId: null }>
  | Readonly<{ kind: "hidden"; relatedId: null }>;

export interface OnlineRematchProposal {
  readonly proposalId: string;
  readonly nextMatchId: string;
  readonly nextRematchIndex: number;
  readonly hostSide: Side;
  readonly terminalRevision: number;
  readonly terminalHash: string;
  readonly owner: "local" | "remote";
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
  readonly pending: OnlinePendingOperation | null;
  readonly control: Readonly<{
    transportAvailable: boolean;
    visible: boolean;
    outstandingPingNonce: string | null;
  }>;
  readonly rematch: Readonly<{
    supported: boolean;
    status: "idle" | "requested" | "received" | "agreed" | "declined" | "cancelled";
    proposal: OnlineRematchProposal | null;
    agreedProposal: OnlineRematchProposal | null;
  }>;
  readonly issue: OnlineCoordinatorIssue | null;
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
  readonly rematchIndex?: number;
}

export type OnlineCoordinatorSendResult =
  | Readonly<{ ok: true; queued?: boolean }>
  | Readonly<{ ok: false; reason?: string }>;

export type OnlineCommandCommitResult = Readonly<{
  status: "committed" | "rejected" | "superseded";
}>;

export interface OnlineCommitContext {
  readonly origin: "local" | "remote";
  /** Side whose rule command is being committed; transport direction is not sufficient for resign. */
  readonly actorSide: Side;
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
  readonly ackTimeoutMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly pongTimeoutMs?: number | undefined;
}

export type OnlineCoordinatorActionFailureReason =
  | "already-started"
  | "invalid-phase"
  | "not-local-turn"
  | "unsupported"
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
  readonly rematchSupported: boolean;
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

interface AckExpectation {
  readonly kind: "move" | "resign-commit";
  readonly messageId: string;
  readonly messageSeq: number;
  readonly expectedRevision: number;
  readonly afterRevision: number;
  readonly afterHash: string;
  readonly proposalId: string | null;
  readonly resigningSide: Side | null;
  timer: unknown;
  timedOut: boolean;
}

interface LocalResignProposal {
  readonly proposalId: string;
  readonly messageSeq: number;
  readonly resigningSide: Side;
  readonly knownRevision: number;
  readonly knownHash: string;
  timer: unknown;
  timedOut: boolean;
}

interface OutstandingPing {
  readonly nonce: string;
  readonly purpose: OnlineLivenessPurposeV1;
  readonly revision: number;
  readonly hash: string;
  timer: unknown;
  timedOut: boolean;
}

interface ActiveRematchProposal extends OnlineRematchProposal {
  readonly ownerRole: SignalingRole;
}

const MAX_CACHED_RECEIPTS = 512;
const DEFAULT_ACK_TIMEOUT_MS = 12_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_PONG_TIMEOUT_MS = 20_000;

function oppositeSide(side: Side): Side {
  return side === "red" ? "black" : "red";
}

function oppositeRole(role: SignalingRole): SignalingRole {
  return role === "host" ? "guest" : "host";
}

function actionFailure(
  reason: OnlineCoordinatorActionFailureReason,
): OnlineCoordinatorActionResult {
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

function resignSignature(message: ResignCommitMessageV1): string {
  return JSON.stringify({
    proposalId: message.proposalId,
    commandId: message.commandId,
    resigningSide: message.resigningSide,
    expectedRevision: message.expectedRevision,
    beforeHash: message.beforeHash,
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
  readonly #timers: OnlineMatchCoordinatorTimers;
  readonly #ackTimeoutMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #pongTimeoutMs: number;
  readonly #subscribers = new Set<(snapshot: OnlineMatchCoordinatorSnapshot) => void>();
  readonly #receipts = new Map<string, CachedCommandReceipt>();
  readonly #pendingAcks = new Map<string, AckExpectation>();
  readonly #processedResignProposals = new Set<string>();
  readonly #authoritativeOutbox: PreparedMessage[] = [];

  #chain: Promise<void> = Promise.resolve();
  #generation = 1;
  #nextLocalSeq = 1;
  #nextRemoteSeq = 1;
  #readySentKey: string | null = null;
  #remoteHello: RemoteHelloState | null = null;
  #activeSnapshotRequest: ActiveSnapshotRequest | null = null;
  #fingerprintCache: GameFingerprint | null = null;
  #localResign: LocalResignProposal | null = null;
  #activeRematch: ActiveRematchProposal | null = null;
  #heartbeatTimer: unknown = null;
  #outstandingPing: OutstandingPing | null = null;
  #transportAvailable = true;
  #visible = true;
  #resumePhase: OnlineMatchCoordinatorPhase | null = null;
  #snapshot: OnlineMatchCoordinatorSnapshot;

  constructor(options: OnlineMatchCoordinatorOptions) {
    this.#identity = options.identity;
    this.#send = options.send;
    this.#getGame = options.getGame;
    this.#commitCommand = options.commitCommand;
    this.#installRecoveredGame = options.installRecoveredGame;
    this.#digest = options.digest;
    this.#createId = options.createId;
    this.#timers = options.timers;
    this.#ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.#pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    const game = options.getGame();
    this.#snapshot = Object.freeze({
      phase: "idle",
      localReady: false,
      remoteReady: false,
      pending: null,
      control: Object.freeze({
        transportAvailable: true,
        visible: true,
        outstandingPingNonce: null,
      }),
      rematch: Object.freeze({
        supported: false,
        status: "idle",
        proposal: null,
        agreedProposal: null,
      }),
      issue: null,
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
        return this.#sendHello(current, generation) ? { ok: true } : actionFailure("send-failed");
      } catch {
        if (this.#isCurrent(generation))
          this.#lock("failed", "internal-error", true, 0, generation);
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
        const code: OnlineErrorCodeV1 =
          decoded.error.code === "version"
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
        } else if (message.type === "resign" && message.action === "commit") {
          this.#replayCachedResignReceipt(message, generation);
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
          await this.#handleResign(message, generation);
          return;
        case "rematch":
          await this.#handleRematch(message, generation);
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
        if (this.#isCurrent(generation))
          this.#lock("failed", "internal-error", true, 0, generation);
        return this.#isCurrent(generation)
          ? actionFailure("send-failed")
          : actionFailure("disposed");
      }
    });
  }

  submitLocalMove(command: MoveCommand): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      if (this.#snapshot.phase !== "playable" || this.#hasPendingWork() || !this.#canInteract()) {
        return actionFailure("invalid-phase");
      }

      try {
        const before = await this.#fingerprint();
        if (!this.#isCurrent(generation)) return actionFailure("disposed");
        if (
          before.game.status.kind !== "playing" ||
          before.game.sideToMove !== this.#identity.localSide
        ) {
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
          actorSide: this.#identity.localSide,
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
        if (!prepared) {
          this.#lock("failed", "internal-error", true, 0, generation);
          return actionFailure("send-failed");
        }
        this.#addAckExpectation(
          {
            kind: "move",
            messageId: commandId,
            messageSeq: prepared.message.seq,
            expectedRevision: before.revision,
            afterRevision: actual.revision,
            afterHash: actual.hash,
            proposalId: null,
            resigningSide: null,
            timer: null,
            timedOut: false,
          },
          generation,
        );
        if (!this.#transmitAuthoritative(prepared, generation)) {
          return actionFailure("send-failed");
        }
        return { ok: true };
      } catch {
        if (this.#isCurrent(generation))
          this.#lock("failed", "internal-error", true, 0, generation);
        return this.#isCurrent(generation)
          ? actionFailure("commit-failed")
          : actionFailure("disposed");
      }
    });
  }

  submitLocalResign(): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      if (
        !this.#canInteract() ||
        (this.#snapshot.phase !== "playable" && this.#snapshot.phase !== "awaiting-ack") ||
        this.#localResign !== null
      ) {
        return actionFailure("invalid-phase");
      }
      const current = await this.#fingerprint();
      if (!this.#isCurrent(generation)) return actionFailure("disposed");
      if (current.game.status.kind !== "playing" || !this.#snapshotMatches(current)) {
        return actionFailure("invalid-phase");
      }
      const proposalId = this.#createId();
      const prepared = this.#prepareMessage({
        type: "resign",
        action: "request",
        proposalId,
        resigningSide: this.#identity.localSide,
        knownRevision: current.revision,
        knownHash: current.hash,
      });
      if (!prepared || !this.#transmit(prepared, generation)) return actionFailure("send-failed");
      const proposal: LocalResignProposal = {
        proposalId,
        messageSeq: prepared.message.seq,
        resigningSide: this.#identity.localSide,
        knownRevision: current.revision,
        knownHash: current.hash,
        timer: null,
        timedOut: false,
      };
      this.#localResign = proposal;
      this.#scheduleResignRequestTimeout(proposal, generation);
      this.#publishPending();
      return { ok: true };
    });
  }

  requestRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      if (!this.#canUseRematch() || !this.#canInteract()) return actionFailure("unsupported");
      if (this.#activeRematch) {
        const hostMayOverrideRemote =
          this.#identity.signalingRole === "host" && this.#activeRematch.owner === "remote";
        if (!hostMayOverrideRemote) return actionFailure("invalid-phase");
      }
      const current = await this.#fingerprint();
      if (!this.#isCurrent(generation)) return actionFailure("disposed");
      const proposal = this.#createRematchProposal(current, "local");
      if (!this.#sendRematch("request", proposal, generation)) return actionFailure("send-failed");
      this.#activeRematch = proposal;
      this.#publishRematch("requested", proposal, null);
      return { ok: true };
    });
  }

  acceptRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#respondToRematch("accept");
  }

  declineRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#respondToRematch("decline");
  }

  cancelRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      const proposal = this.#activeRematch;
      if (
        !this.#canUseRematch() ||
        !proposal ||
        proposal.owner !== "local" ||
        !this.#canInteract()
      ) {
        return actionFailure("invalid-phase");
      }
      if (!this.#sendRematch("cancel", proposal, generation)) return actionFailure("send-failed");
      this.#activeRematch = null;
      this.#publishRematch("cancelled", null, null);
      return { ok: true };
    });
  }

  setTransportAvailable(available: boolean): Promise<void> {
    if (this.#snapshot.phase === "disposed" || this.#transportAvailable === available) {
      return this.#chain;
    }
    this.#transportAvailable = available;
    this.#publishControl();
    if (this.#hasStickyPhase()) return this.#chain;
    if (!available) this.#pauseForLifecycle("transport-unavailable");
    return available ? this.#resumeAfterLifecycle() : this.#chain;
  }

  setVisible(visible: boolean): Promise<void> {
    if (this.#snapshot.phase === "disposed" || this.#visible === visible) return this.#chain;
    this.#visible = visible;
    this.#publishControl();
    if (this.#hasStickyPhase()) return this.#chain;
    if (!visible) this.#pauseForLifecycle("hidden");
    return visible ? this.#resumeAfterLifecycle() : this.#chain;
  }

  dispose(): void {
    if (this.#snapshot.phase === "disposed") return;
    this.#generation += 1;
    this.#clearAllTimers();
    this.#activeSnapshotRequest = null;
    this.#fingerprintCache = null;
    this.#receipts.clear();
    this.#pendingAcks.clear();
    this.#authoritativeOutbox.length = 0;
    this.#localResign = null;
    this.#activeRematch = null;
    this.#publish({
      phase: "disposed",
      pending: null,
      issue: null,
      error: null,
    });
    this.#subscribers.clear();
  }

  #enqueueAction(
    work: (generation: number) => Promise<OnlineCoordinatorActionResult>,
  ): Promise<OnlineCoordinatorActionResult> {
    const generation = this.#generation;
    const pending = this.#chain.then(() =>
      this.#isCurrent(generation) ? work(generation) : actionFailure("disposed"),
    );
    this.#chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  #enqueueVoid(work: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.#generation;
    const pending = this.#chain.then(async () => {
      if (!this.#isCurrent(generation)) return;
      try {
        await work(generation);
      } catch {
        if (this.#isCurrent(generation))
          this.#lock("failed", "internal-error", true, 0, generation);
      }
    });
    this.#chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#snapshot.phase !== "disposed";
  }

  #canSend(): boolean {
    return this.#transportAvailable;
  }

  #canInteract(): boolean {
    return this.#transportAvailable && this.#visible;
  }

  #isHiddenLifecyclePause(): boolean {
    return this.#snapshot.phase === "stalled" && this.#snapshot.issue?.kind === "hidden";
  }

  #hasStickyPhase(): boolean {
    return (
      this.#snapshot.phase === "failed" ||
      this.#snapshot.phase === "repair-required" ||
      this.#snapshot.phase === "disposed"
    );
  }

  #hasPendingWork(): boolean {
    return this.#pendingAcks.size > 0 || this.#localResign !== null;
  }

  async #fingerprint(game = this.#getGame()): Promise<GameFingerprint> {
    if (this.#fingerprintCache?.game === game) return this.#fingerprintCache;
    const serialized = serializeGame(game);
    const hash = await this.#digest(serialized);
    const fingerprint = { game, serialized, revision: game.revision, hash };
    this.#fingerprintCache = fingerprint;
    return fingerprint;
  }

  async #fingerprintAtRevision(game: GameState, revision: number): Promise<GameFingerprint | null> {
    if (revision === game.revision) return this.#fingerprint(game);
    if (revision > game.revision || revision > game.commandLog.length) return null;
    let replayed = createInitialGame();
    for (const replay of game.commandLog.slice(0, revision) as ReadonlyArray<ReplayCommand>) {
      const result = dispatch(replayed, { ...replay, expectedRevision: replayed.revision });
      if (result.error) return null;
      replayed = result.state;
    }
    return this.#fingerprint(replayed);
  }

  #publish(patch: Partial<OnlineMatchCoordinatorSnapshot>): void {
    const changed = (Object.keys(patch) as Array<keyof OnlineMatchCoordinatorSnapshot>).some(
      (key) => !Object.is(this.#snapshot[key], patch[key]),
    );
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

  #publishControl(): void {
    this.#publish({
      control: Object.freeze({
        transportAvailable: this.#transportAvailable,
        visible: this.#visible,
        outstandingPingNonce: this.#outstandingPing?.nonce ?? null,
      }),
    });
  }

  #activePhaseForGame(game: GameState): OnlineMatchCoordinatorPhase {
    if (!this.#canInteract()) return "stalled";
    if (this.#hasPendingWork()) return "awaiting-ack";
    return game.status.kind === "ended" ? "terminal" : "playable";
  }

  #publishPending(): void {
    let pending: OnlinePendingOperation | null = null;
    if (this.#localResign) {
      pending = Object.freeze({
        kind: "resign",
        stage: "request",
        proposalId: this.#localResign.proposalId,
        commandId: null,
        messageSeq: this.#localResign.messageSeq,
        resigningSide: this.#localResign.resigningSide,
        expectedRevision: this.#localResign.knownRevision,
        afterRevision: null,
        afterHash: null,
      });
    } else {
      const expectation = this.#pendingAcks.values().next().value;
      if (expectation?.kind === "move") {
        pending = Object.freeze({
          kind: "move",
          commandId: expectation.messageId,
          messageSeq: expectation.messageSeq,
          expectedRevision: expectation.expectedRevision,
          afterRevision: expectation.afterRevision,
          afterHash: expectation.afterHash,
        });
      } else if (expectation) {
        pending = Object.freeze({
          kind: "resign",
          stage: "commit",
          proposalId: expectation.proposalId!,
          commandId: expectation.messageId,
          messageSeq: expectation.messageSeq,
          resigningSide: expectation.resigningSide!,
          expectedRevision: expectation.expectedRevision,
          afterRevision: expectation.afterRevision,
          afterHash: expectation.afterHash,
        });
      }
    }
    const preserveLivenessPhase =
      (this.#snapshot.phase === "stalled" && this.#snapshot.issue !== null) ||
      (this.#snapshot.phase === "revalidating" && this.#outstandingPing !== null);
    const phase = preserveLivenessPhase
      ? this.#snapshot.phase
      : pending
        ? "awaiting-ack"
        : this.#activePhaseForGame(this.#getGame());
    this.#publish({ pending, phase, error: null });
    this.#refreshHeartbeat();
  }

  #snapshotMatches(current: GameFingerprint): boolean {
    return this.#snapshot.revision === current.revision && this.#snapshot.hash === current.hash;
  }

  #readyMatches(current: GameFingerprint): boolean {
    return (
      this.#remoteHello !== null &&
      this.#remoteHello.revision === current.revision &&
      this.#remoteHello.hash === current.hash
    );
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
    if (!this.#isCurrent(generation) || !this.#canSend()) return false;
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

  #transmitAuthoritative(prepared: PreparedMessage, generation: number): boolean {
    if (!this.#isCurrent(generation)) return false;
    if (!this.#canSend()) {
      this.#authoritativeOutbox.push(prepared);
      this.#nextLocalSeq += 1;
      return true;
    }
    return this.#transmit(prepared, generation);
  }

  #flushAuthoritativeOutbox(generation: number): boolean {
    if (!this.#isCurrent(generation) || !this.#canSend()) return false;
    while (this.#authoritativeOutbox.length > 0) {
      const prepared = this.#authoritativeOutbox[0];
      if (!prepared) break;
      try {
        const result = this.#send(prepared.frame);
        if (!result.ok) {
          this.#lock("failed", "internal-error", true, prepared.message.seq, generation, false);
          return false;
        }
      } catch {
        this.#lock("failed", "internal-error", true, prepared.message.seq, generation, false);
        return false;
      }
      this.#authoritativeOutbox.shift();
    }
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
    return (
      this.#sendPayload(
        {
          type: "hello",
          intent: this.#identity.intent,
          signalingRole: this.#identity.signalingRole,
          side: this.#identity.localSide,
          gameSchemaVersion: XIANGQI_SCHEMA_VERSION,
          ruleset: POPULAR_RULESET_ID,
          revision: current.revision,
          positionHash: current.hash,
          features: ["rematch-v1", "snapshot-v1"],
        },
        generation,
      ) !== null
    );
  }

  #sendReady(current: GameFingerprint, generation: number): boolean {
    const key = `${current.revision}:${current.hash}`;
    if (this.#readySentKey === key) return true;
    const sent = this.#sendPayload(
      {
        type: "ready",
        revision: current.revision,
        positionHash: current.hash,
      },
      generation,
    );
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
    if (!this.#isCurrent(generation) || !this.#canSend()) return;
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
    this.#clearAllTimers();
    this.#pendingAcks.clear();
    this.#authoritativeOutbox.length = 0;
    this.#localResign = null;
    this.#publish({
      phase,
      pending: null,
      issue: null,
      error: Object.freeze({ code, fatal, relatedSeq }),
    });
    if (emit) this.#trySendError(code, fatal, relatedSeq, generation);
  }

  #rejectWithoutMutation(code: OnlineErrorCodeV1, relatedSeq: number, generation: number): void {
    this.#publish({ error: Object.freeze({ code, fatal: false, relatedSeq }) });
    this.#trySendError(code, false, relatedSeq, generation);
  }

  #hasRemoteIdentity(message: OnlineMessageV1): boolean {
    return (
      message.pairingId === this.#identity.pairingId &&
      message.sessionId === this.#identity.sessionId &&
      message.matchId === this.#identity.matchId &&
      message.senderPeerId === this.#identity.remotePeerId &&
      message.senderPeerId !== this.#identity.localPeerId
    );
  }

  async #handleHello(message: HelloMessageV1, generation: number): Promise<void> {
    if (
      message.signalingRole !== oppositeRole(this.#identity.signalingRole) ||
      message.side !== oppositeSide(this.#identity.localSide) ||
      message.intent !== this.#identity.intent ||
      message.gameSchemaVersion !== XIANGQI_SCHEMA_VERSION ||
      message.ruleset !== POPULAR_RULESET_ID
    ) {
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
      rematchSupported: message.features.includes("rematch-v1"),
    };
    this.#readySentKey = null;
    this.#publish({
      remoteReady: false,
      error: null,
      rematch: Object.freeze({
        ...this.#snapshot.rematch,
        supported: message.features.includes("rematch-v1"),
      }),
    });

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
    this.#sendPayload(
      {
        type: "snapshot-request",
        requestId,
        reason: "snapshot-required",
        knownRevision: current.revision,
        knownHash: current.hash,
      },
      generation,
    );
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
    if (
      !this.#readyMatches(current) ||
      message.revision !== current.revision ||
      message.positionHash !== current.hash
    ) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#publish({
      remoteReady: true,
      revision: current.revision,
      hash: current.hash,
      error: null,
    });
    this.#publishPlayableIfReady(current.game);
  }

  #publishPlayableIfReady(game: GameState): void {
    if (!this.#snapshot.localReady || !this.#snapshot.remoteReady) return;
    this.#publish({ phase: this.#activePhaseForGame(game) });
    this.#refreshHeartbeat();
  }

  async #handleRemoteCommand(message: CommandMessageV1, generation: number): Promise<void> {
    const cached = this.#receipts.get(message.commandId);
    if (cached) {
      this.#replayCachedReceipt(message, generation);
      return;
    }
    if (
      (this.#snapshot.phase !== "playable" &&
        !this.#isHiddenLifecyclePause() &&
        this.#localResign === null) ||
      this.#snapshot.phase === "revalidating" ||
      !this.#canSend()
    ) {
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
      const code =
        message.expectedRevision !== before.revision ? "stale-revision" : "position-mismatch";
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
      actorSide: message.actorSide,
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
    this.#publishFingerprint(actual);

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
    if (this.#transmitAuthoritative(ack, generation)) this.#publishPending();
  }

  #cacheReceipt(message: CommandMessageV1, ackFrame: string): void {
    this.#receipts.set(message.commandId, {
      signature: commandSignature(message),
      ackFrame,
    });
    if (this.#receipts.size <= MAX_CACHED_RECEIPTS) return;
    const oldest = this.#receipts.keys().next().value;
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
    const pending = this.#pendingAcks.get(message.ackedMessageId);
    if (
      !pending ||
      message.ackedSeq !== pending.messageSeq ||
      message.revision !== pending.afterRevision ||
      message.positionHash !== pending.afterHash
    ) {
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
    if (pending.timer !== null) this.#timers.clearTimeout(pending.timer);
    this.#pendingAcks.delete(pending.messageId);
    if (
      this.#snapshot.issue?.kind === "ack-timeout" &&
      this.#snapshot.issue.relatedId === pending.messageId
    ) {
      this.#publish({ issue: null });
    }
    this.#publishFingerprint(current);
    this.#publishPending();
  }

  async #handleResign(message: ResignMessageV1, generation: number): Promise<void> {
    if (message.action === "request") {
      await this.#handleResignRequest(message, generation);
    } else {
      await this.#handleResignCommit(message, generation);
    }
  }

  async #handleResignRequest(message: ResignRequestMessageV1, generation: number): Promise<void> {
    if (message.resigningSide !== oppositeSide(this.#identity.localSide)) {
      this.#lock("repair-required", "invalid-command", true, message.seq, generation);
      return;
    }
    if (this.#processedResignProposals.has(message.proposalId)) return;
    if (
      !this.#canSend() ||
      (this.#snapshot.phase !== "playable" &&
        this.#snapshot.phase !== "awaiting-ack" &&
        !this.#isHiddenLifecyclePause())
    ) {
      this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
      return;
    }
    if (this.#localResign) {
      if (this.#identity.signalingRole === "host") {
        // When both sides request concurrently, the host's proposal wins.
        return;
      }
      this.#clearLocalResign();
    }
    const before = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (before.game.status.kind !== "playing" || message.knownRevision > before.revision) {
      this.#rejectWithoutMutation("stale-revision", message.seq, generation);
      return;
    }
    const known = await this.#fingerprintAtRevision(before.game, message.knownRevision);
    if (!this.#isCurrent(generation)) return;
    if (!known || known.hash !== message.knownHash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    const commandId = this.#createId();
    const command: GameCommand = {
      type: "resign",
      side: message.resigningSide,
      expectedRevision: before.revision,
    };
    const preview = dispatch(before.game, command);
    if (preview.error) {
      this.#lock("repair-required", "invalid-command", true, message.seq, generation);
      return;
    }
    const expected = await this.#fingerprint(preview.state);
    const receipt = await this.#commitCommand(command, {
      origin: "remote",
      actorSide: message.resigningSide,
      commandId,
      senderPeerId: message.senderPeerId,
      messageSeq: message.seq,
    });
    if (!this.#isCurrent(generation)) return;
    if (receipt.status !== "committed") {
      this.#lock("failed", "internal-error", true, message.seq, generation);
      return;
    }
    const actual = await this.#fingerprint();
    if (actual.revision !== expected.revision || actual.hash !== expected.hash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#publishFingerprint(actual);
    const prepared = this.#prepareMessage({
      type: "resign",
      action: "commit",
      proposalId: message.proposalId,
      commandId,
      resigningSide: message.resigningSide,
      expectedRevision: before.revision,
      beforeHash: before.hash,
      afterRevision: actual.revision,
      afterHash: actual.hash,
    });
    if (!prepared) {
      this.#lock("failed", "internal-error", true, message.seq, generation);
      return;
    }
    this.#processedResignProposals.add(message.proposalId);
    this.#addAckExpectation(
      {
        kind: "resign-commit",
        messageId: commandId,
        messageSeq: prepared.message.seq,
        expectedRevision: before.revision,
        afterRevision: actual.revision,
        afterHash: actual.hash,
        proposalId: message.proposalId,
        resigningSide: message.resigningSide,
        timer: null,
        timedOut: false,
      },
      generation,
    );
    this.#transmitAuthoritative(prepared, generation);
  }

  async #handleResignCommit(message: ResignCommitMessageV1, generation: number): Promise<void> {
    if (this.#receipts.has(message.commandId)) {
      this.#replayCachedResignReceipt(message, generation);
      return;
    }
    const proposal = this.#localResign;
    if (
      !proposal ||
      proposal.proposalId !== message.proposalId ||
      message.resigningSide !== this.#identity.localSide
    ) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const before = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    if (
      before.game.status.kind !== "playing" ||
      message.expectedRevision !== before.revision ||
      message.beforeHash !== before.hash
    ) {
      this.#lock(
        "repair-required",
        message.expectedRevision !== before.revision ? "stale-revision" : "position-mismatch",
        true,
        message.seq,
        generation,
      );
      return;
    }
    const command: GameCommand = {
      type: "resign",
      side: message.resigningSide,
      expectedRevision: message.expectedRevision,
    };
    const preview = dispatch(before.game, command);
    if (preview.error) {
      this.#lock("repair-required", "invalid-command", true, message.seq, generation);
      return;
    }
    const expected = await this.#fingerprint(preview.state);
    if (message.afterRevision !== expected.revision || message.afterHash !== expected.hash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    const receipt = await this.#commitCommand(command, {
      origin: "remote",
      actorSide: message.resigningSide,
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
    if (actual.revision !== message.afterRevision || actual.hash !== message.afterHash) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    this.#clearLocalResign();
    if (
      this.#snapshot.issue?.kind === "ack-timeout" &&
      this.#snapshot.issue.relatedId === message.proposalId
    ) {
      this.#publish({ issue: null });
    }
    this.#processedResignProposals.add(message.proposalId);
    this.#publishFingerprint(actual);
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
    this.#receipts.set(message.commandId, {
      signature: resignSignature(message),
      ackFrame: ack.frame,
    });
    if (this.#transmitAuthoritative(ack, generation)) this.#publishPending();
  }

  #replayCachedResignReceipt(message: ResignCommitMessageV1, generation: number): void {
    const cached = this.#receipts.get(message.commandId);
    if (!cached) return;
    if (cached.signature !== resignSignature(message)) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    if (!this.#canSend()) return;
    try {
      const result = this.#send(cached.ackFrame);
      if (!result.ok) this.#lock("failed", "internal-error", true, message.seq, generation, false);
    } catch {
      this.#lock("failed", "internal-error", true, message.seq, generation, false);
    }
  }

  async #handleSnapshotRequest(
    message: SnapshotRequestMessageV1,
    generation: number,
  ): Promise<void> {
    if (
      this.#snapshot.phase !== "syncing" ||
      this.#activeSnapshotRequest !== null ||
      this.#remoteHello === null ||
      message.knownRevision !== this.#remoteHello.revision ||
      message.knownHash !== this.#remoteHello.hash
    ) {
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
    const sent = this.#sendPayload(
      {
        type: "snapshot",
        requestId: message.requestId,
        revision: current.revision,
        positionHash: current.hash,
        serializedGame: current.serialized,
      },
      generation,
    );
    if (sent) this.#publish({ phase: "handshaking" });
  }

  async #handleSnapshot(message: SnapshotMessageV1, generation: number): Promise<void> {
    const request = this.#activeSnapshotRequest;
    if (
      this.#snapshot.phase !== "syncing" ||
      request === null ||
      message.requestId !== request.requestId ||
      message.revision !== request.remoteRevision ||
      message.positionHash !== request.remoteHash
    ) {
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
    const advertised =
      message.purpose === "revalidation"
        ? current
        : await this.#fingerprintAtRevision(current.game, message.revision);
    if (!this.#isCurrent(generation)) return;
    if (
      !advertised ||
      message.revision !== advertised.revision ||
      message.positionHash !== advertised.hash
    ) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    if (!this.#canSend()) return;
    this.#sendPayload(
      {
        type: "pong",
        nonce: message.nonce,
        purpose: message.purpose,
        revision: advertised.revision,
        positionHash: advertised.hash,
      },
      generation,
    );
  }

  async #handlePong(
    message: Extract<OnlineMessageV1, { type: "pong" }>,
    generation: number,
  ): Promise<void> {
    const outstanding = this.#outstandingPing;
    if (
      !outstanding ||
      message.nonce !== outstanding.nonce ||
      message.purpose !== outstanding.purpose ||
      message.revision !== outstanding.revision ||
      message.positionHash !== outstanding.hash
    ) {
      this.#lock("repair-required", "protocol-violation", true, message.seq, generation);
      return;
    }
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    this.#publishFingerprint(current);
    if (
      outstanding.purpose === "revalidation" &&
      (current.revision !== outstanding.revision || current.hash !== outstanding.hash)
    ) {
      this.#lock("repair-required", "position-mismatch", true, message.seq, generation);
      return;
    }
    if (outstanding.timer !== null) this.#timers.clearTimeout(outstanding.timer);
    this.#outstandingPing = null;
    this.#publishControl();
    if (this.#snapshot.issue?.kind === "pong-timeout" || this.#snapshot.phase === "revalidating") {
      this.#publish({ issue: null, error: null });
      this.#publishPending();
      this.#restartAckTimers(generation);
    }
    this.#refreshHeartbeat();
  }

  #addAckExpectation(expectation: AckExpectation, generation: number): void {
    this.#pendingAcks.set(expectation.messageId, expectation);
    this.#scheduleAckTimeout(expectation, generation);
    this.#publishPending();
  }

  #scheduleAckTimeout(expectation: AckExpectation, generation: number): void {
    if (!this.#canInteract() || expectation.timer !== null) return;
    expectation.timer = this.#timers.setTimeout(() => {
      void this.#enqueueVoid(async (currentGeneration) => {
        if (
          currentGeneration !== generation ||
          this.#pendingAcks.get(expectation.messageId) !== expectation
        )
          return;
        expectation.timer = null;
        expectation.timedOut = true;
        this.#publish({
          phase: "stalled",
          issue: Object.freeze({ kind: "ack-timeout", relatedId: expectation.messageId }),
        });
      });
    }, this.#ackTimeoutMs);
  }

  #scheduleResignRequestTimeout(proposal: LocalResignProposal, generation: number): void {
    if (!this.#canInteract() || proposal.timer !== null) return;
    proposal.timer = this.#timers.setTimeout(() => {
      void this.#enqueueVoid(async (currentGeneration) => {
        if (currentGeneration !== generation || this.#localResign !== proposal) return;
        proposal.timer = null;
        proposal.timedOut = true;
        this.#publish({
          phase: "stalled",
          issue: Object.freeze({ kind: "ack-timeout", relatedId: proposal.proposalId }),
        });
      });
    }, this.#ackTimeoutMs);
  }

  #clearLocalResign(): void {
    const proposal = this.#localResign;
    if (proposal?.timer != null) this.#timers.clearTimeout(proposal.timer);
    this.#localResign = null;
  }

  #restartAckTimers(generation: number): void {
    if (!this.#canInteract()) return;
    for (const expectation of this.#pendingAcks.values()) {
      expectation.timedOut = false;
      this.#scheduleAckTimeout(expectation, generation);
    }
    if (this.#localResign) {
      this.#localResign.timedOut = false;
      this.#scheduleResignRequestTimeout(this.#localResign, generation);
    }
  }

  #refreshHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      this.#timers.clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (
      !this.#canInteract() ||
      !this.#snapshot.localReady ||
      !this.#snapshot.remoteReady ||
      this.#outstandingPing ||
      this.#snapshot.phase === "failed" ||
      this.#snapshot.phase === "repair-required" ||
      this.#snapshot.phase === "disposed"
    )
      return;
    const generation = this.#generation;
    this.#heartbeatTimer = this.#timers.setTimeout(() => {
      this.#heartbeatTimer = null;
      void this.#enqueueVoid(async (currentGeneration) => {
        if (currentGeneration === generation) await this.#sendHeartbeat(currentGeneration);
      });
    }, this.#heartbeatIntervalMs);
  }

  async #sendHeartbeat(generation: number): Promise<void> {
    if (!this.#canInteract() || this.#outstandingPing) return;
    const current = await this.#fingerprint();
    if (!this.#isCurrent(generation)) return;
    const nonce = this.#createId();
    const purpose: OnlineLivenessPurposeV1 =
      this.#snapshot.phase === "revalidating" ? "revalidation" : "heartbeat";
    const sent = this.#sendPayload(
      {
        type: "ping",
        nonce,
        purpose,
        revision: current.revision,
        positionHash: current.hash,
      },
      generation,
    );
    if (!sent) return;
    const outstanding: OutstandingPing = {
      nonce,
      purpose,
      revision: current.revision,
      hash: current.hash,
      timer: null,
      timedOut: false,
    };
    this.#outstandingPing = outstanding;
    this.#publishControl();
    outstanding.timer = this.#timers.setTimeout(() => {
      void this.#enqueueVoid(async (currentGeneration) => {
        if (currentGeneration !== generation || this.#outstandingPing !== outstanding) return;
        outstanding.timer = null;
        outstanding.timedOut = true;
        this.#publish({
          phase: "stalled",
          issue: Object.freeze({ kind: "pong-timeout", relatedId: nonce }),
        });
      });
    }, this.#pongTimeoutMs);
  }

  #pauseForLifecycle(kind: "transport-unavailable" | "hidden"): void {
    if (this.#hasStickyPhase()) return;
    if (this.#snapshot.phase !== "stalled" && this.#snapshot.phase !== "revalidating") {
      this.#resumePhase = this.#snapshot.phase;
    }
    this.#clearLivenessTimers(false);
    for (const expectation of this.#pendingAcks.values()) {
      if (expectation.timer !== null) this.#timers.clearTimeout(expectation.timer);
      expectation.timer = null;
    }
    const proposal = this.#localResign;
    if (proposal?.timer != null) this.#timers.clearTimeout(proposal.timer);
    if (proposal) proposal.timer = null;
    this.#publish({
      phase: "stalled",
      issue: Object.freeze({ kind, relatedId: null }),
    });
  }

  #resumeAfterLifecycle(): Promise<void> {
    if (!this.#canInteract() || this.#hasStickyPhase()) return this.#chain;
    return this.#enqueueVoid(async (generation) => {
      if (this.#hasStickyPhase()) return;
      if (!this.#snapshot.localReady || !this.#snapshot.remoteReady) {
        this.#publish({ phase: this.#resumePhase ?? "handshaking", issue: null });
        this.#resumePhase = null;
        return;
      }
      if (!this.#flushAuthoritativeOutbox(generation)) return;
      this.#publish({ phase: "revalidating", issue: null });
      const outstanding = this.#outstandingPing;
      if (outstanding?.timer != null) {
        this.#timers.clearTimeout(outstanding.timer);
      }
      this.#outstandingPing = null;
      this.#publishControl();
      await this.#sendHeartbeat(generation);
    });
  }

  #clearLivenessTimers(clearOutstanding: boolean): void {
    if (this.#heartbeatTimer !== null) this.#timers.clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    const outstanding = this.#outstandingPing;
    if (outstanding?.timer != null) this.#timers.clearTimeout(outstanding.timer);
    if (outstanding) outstanding.timer = null;
    if (clearOutstanding) this.#outstandingPing = null;
    this.#publishControl();
  }

  #clearAllTimers(): void {
    this.#clearLivenessTimers(true);
    for (const expectation of this.#pendingAcks.values()) {
      if (expectation.timer !== null) this.#timers.clearTimeout(expectation.timer);
      expectation.timer = null;
    }
    const proposal = this.#localResign;
    if (proposal?.timer != null) this.#timers.clearTimeout(proposal.timer);
    if (proposal) proposal.timer = null;
  }

  async #handleRematch(message: RematchMessageV1, generation: number): Promise<void> {
    if (!this.#canUseRematch() || !this.#matchesExpectedRematch(message)) {
      this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
      return;
    }
    const incoming = this.#proposalFromMessage(message, "remote");
    if (message.action === "request") {
      const active = this.#activeRematch;
      if (active) {
        if (active.proposalId === incoming.proposalId) {
          if (!this.#sameRematchProposal(active, incoming)) {
            this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
          }
          return;
        }
        if (active.ownerRole === "host") return;
        if (incoming.ownerRole !== "host") {
          this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
          return;
        }
      }
      this.#activeRematch = incoming;
      this.#publishRematch("received", incoming, null);
      return;
    }
    const active = this.#activeRematch;
    if (
      !active ||
      active.proposalId !== message.proposalId ||
      !this.#sameRematchProposal(active, incoming)
    ) {
      this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
      return;
    }
    if (message.action === "accept") {
      if (active.owner !== "local") {
        this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
        return;
      }
      this.#publishRematch("agreed", active, active);
      return;
    }
    if (message.action === "decline") {
      if (active.owner !== "local") {
        this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
        return;
      }
      this.#activeRematch = null;
      this.#publishRematch("declined", null, null);
      return;
    }
    if (active.owner !== "remote") {
      this.#rejectWithoutMutation("protocol-violation", message.seq, generation);
      return;
    }
    this.#activeRematch = null;
    this.#publishRematch("cancelled", null, null);
  }

  #respondToRematch(action: "accept" | "decline"): Promise<OnlineCoordinatorActionResult> {
    return this.#enqueueAction(async (generation) => {
      const proposal = this.#activeRematch;
      if (
        !this.#canUseRematch() ||
        !proposal ||
        proposal.owner !== "remote" ||
        !this.#canInteract()
      ) {
        return actionFailure("invalid-phase");
      }
      if (!this.#sendRematch(action, proposal, generation)) return actionFailure("send-failed");
      if (action === "accept") {
        this.#publishRematch("agreed", proposal, proposal);
      } else {
        this.#activeRematch = null;
        this.#publishRematch("declined", null, null);
      }
      return { ok: true };
    });
  }

  #canUseRematch(): boolean {
    return (
      this.#snapshot.phase === "terminal" &&
      this.#remoteHello?.rematchSupported === true &&
      this.#getGame().status.kind === "ended"
    );
  }

  #currentHostSide(): Side {
    return this.#identity.signalingRole === "host"
      ? this.#identity.localSide
      : oppositeSide(this.#identity.localSide);
  }

  #createRematchProposal(
    current: GameFingerprint,
    owner: "local" | "remote",
  ): ActiveRematchProposal {
    return Object.freeze({
      proposalId: this.#createId(),
      nextMatchId: this.#createId(),
      nextRematchIndex: (this.#identity.rematchIndex ?? 0) + 1,
      hostSide: oppositeSide(this.#currentHostSide()),
      terminalRevision: current.revision,
      terminalHash: current.hash,
      owner,
      ownerRole:
        owner === "local"
          ? this.#identity.signalingRole
          : oppositeRole(this.#identity.signalingRole),
    });
  }

  #proposalFromMessage(
    message: RematchMessageV1,
    owner: "local" | "remote",
  ): ActiveRematchProposal {
    return Object.freeze({
      proposalId: message.proposalId,
      nextMatchId: message.nextMatchId,
      nextRematchIndex: message.nextRematchIndex,
      hostSide: message.hostSide,
      terminalRevision: message.terminalRevision,
      terminalHash: message.terminalHash,
      owner,
      ownerRole:
        owner === "local"
          ? this.#identity.signalingRole
          : oppositeRole(this.#identity.signalingRole),
    });
  }

  #matchesExpectedRematch(message: RematchMessageV1): boolean {
    return (
      message.nextRematchIndex === (this.#identity.rematchIndex ?? 0) + 1 &&
      message.nextMatchId !== this.#identity.matchId &&
      message.hostSide === oppositeSide(this.#currentHostSide()) &&
      message.terminalRevision === this.#snapshot.revision &&
      message.terminalHash === this.#snapshot.hash
    );
  }

  #sameRematchProposal(left: OnlineRematchProposal, right: OnlineRematchProposal): boolean {
    return (
      left.proposalId === right.proposalId &&
      left.nextMatchId === right.nextMatchId &&
      left.nextRematchIndex === right.nextRematchIndex &&
      left.hostSide === right.hostSide &&
      left.terminalRevision === right.terminalRevision &&
      left.terminalHash === right.terminalHash
    );
  }

  #sendRematch(
    action: RematchMessageV1["action"],
    proposal: OnlineRematchProposal,
    generation: number,
  ): boolean {
    return (
      this.#sendPayload(
        {
          type: "rematch",
          action,
          proposalId: proposal.proposalId,
          nextMatchId: proposal.nextMatchId,
          nextRematchIndex: proposal.nextRematchIndex,
          hostSide: proposal.hostSide,
          terminalRevision: proposal.terminalRevision,
          terminalHash: proposal.terminalHash,
        },
        generation,
      ) !== null
    );
  }

  #publishRematch(
    status: OnlineMatchCoordinatorSnapshot["rematch"]["status"],
    proposal: OnlineRematchProposal | null,
    agreedProposal: OnlineRematchProposal | null,
  ): void {
    this.#publish({
      rematch: Object.freeze({
        supported: this.#remoteHello?.rematchSupported === true,
        status,
        proposal,
        agreedProposal,
      }),
    });
  }

  #handleRemoteError(message: ErrorMessageV1): void {
    const preserveRepair = this.#snapshot.phase === "repair-required";
    if (message.fatal) {
      this.#clearAllTimers();
      this.#pendingAcks.clear();
      this.#localResign = null;
    }
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
