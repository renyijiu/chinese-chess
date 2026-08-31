import type { GameCommand, GameState, MoveCommand, Side } from "../../../lib/xiangqi/index";
import {
  decodeOnlineMessageV1,
  type OnlineIntentV1,
} from "../../../lib/xiangqi/online";
import {
  OnlineMatchCoordinator,
  type OnlineCommitContext,
  type OnlineCommandCommitResult,
  type OnlineCoordinatorActionResult,
  type OnlineMatchCoordinatorSnapshot,
  type OnlineMatchIdentity,
  type OnlineRematchProposal,
} from "./OnlineMatchCoordinator";
import {
  PeerSession,
  type PeerConnectionPort,
  type PeerSessionIdentity,
  type PeerSessionSnapshot,
} from "./PeerSession";
import { onlineSideForRematch } from "../game/match";

export interface OnlineMatchSessionIdentity {
  readonly role: "host" | "guest";
  readonly sessionId: string;
  readonly pairingId: string;
  readonly matchId: string;
  readonly localPeerId: string;
  readonly remotePeerId?: string | null;
  readonly intent: OnlineIntentV1;
  readonly localSide?: Side;
  readonly rematchIndex?: number;
}

export interface BoundOnlineMatchIdentity extends OnlineMatchIdentity {
  readonly intent: OnlineIntentV1;
}

export interface OnlineMatchSessionSnapshot {
  readonly peer: PeerSessionSnapshot;
  readonly coordinator: OnlineMatchCoordinatorSnapshot | null;
  readonly outboundSignal: string | null;
  readonly identity: BoundOnlineMatchIdentity | null;
  readonly error: string | null;
  readonly reconnectRequired: boolean;
  readonly rotatingToMatchId: string | null;
}

export interface OnlineMatchSessionOptions {
  readonly identity: OnlineMatchSessionIdentity;
  readonly rtcConfiguration?: RTCConfiguration;
  readonly peerConnectionFactory: (configuration?: RTCConfiguration) => PeerConnectionPort;
  readonly getGame: () => GameState;
  readonly bindMatch: (identity: BoundOnlineMatchIdentity) => Promise<boolean>;
  readonly commitCommand: (
    command: GameCommand,
    context: OnlineCommitContext,
  ) => Promise<OnlineCommandCommitResult>;
  readonly installRecoveredGame: (game: GameState) => Promise<boolean>;
  readonly installRematch: (
    identity: BoundOnlineMatchIdentity,
    proposal: OnlineRematchProposal,
  ) => Promise<boolean>;
  readonly digest: (canonicalSerializedGame: string) => string | Promise<string>;
  readonly createId: () => string;
}

const EMPTY_COORDINATOR_SNAPSHOT: OnlineMatchCoordinatorSnapshot | null = null;

/**
 * Browser-facing facade for one manual-signaling attempt. SDP/ICE state lives
 * only here and is discarded on refresh; SavedMatch remains game-only state.
 */
export class OnlineMatchSession {
  readonly #options: OnlineMatchSessionOptions;
  readonly #peer: PeerSession;
  readonly #subscribers = new Set<(snapshot: OnlineMatchSessionSnapshot) => void>();
  readonly #earlyFrames: string[] = [];
  readonly #nextMatchFrames: string[] = [];
  readonly #retiredMatchIds = new Set<string>();
  #coordinator: OnlineMatchCoordinator | null = null;
  #unsubscribePeer: (() => void) | null = null;
  #unsubscribeCoordinator: (() => void) | null = null;
  #coordinatorStarted = false;
  #coordinatorIdentity: BoundOnlineMatchIdentity | null = null;
  #rotatingProposalId: string | null = null;
  #expectedNextMatchId: string | null = null;
  #disposed = false;
  #snapshot: OnlineMatchSessionSnapshot;

  constructor(options: OnlineMatchSessionOptions) {
    this.#options = options;
    const identity: PeerSessionIdentity = {
      role: options.identity.role,
      sessionId: options.identity.sessionId,
      pairingId: options.identity.pairingId,
      matchId: options.identity.matchId,
      localPeerId: options.identity.localPeerId,
      intent: options.identity.intent,
      ...(options.identity.remotePeerId === undefined
        ? {}
        : { remotePeerId: options.identity.remotePeerId }),
    };
    this.#peer = new PeerSession({
      identity,
      peerConnectionFactory: options.peerConnectionFactory,
      onFrame: (frame) => this.#routeFrame(frame),
      onFrameRejected: (reason) => this.#publish({ error: `frame-${reason}` }),
      ...(options.rtcConfiguration === undefined
        ? {}
        : { rtcConfiguration: options.rtcConfiguration }),
    });
    this.#snapshot = Object.freeze({
      peer: this.#peer.getSnapshot(),
      coordinator: EMPTY_COORDINATOR_SNAPSHOT,
      outboundSignal: null,
      identity: null,
      error: null,
      reconnectRequired: false,
      rotatingToMatchId: null,
    });
    this.#unsubscribePeer = this.#peer.subscribe((peer) => {
      const unavailable = peer.phase === "disconnected-grace"
        || peer.phase === "failed"
        || peer.phase === "closed";
      this.#publish({
        peer,
        outboundSignal: peer.phase === "open" ? null : this.#snapshot.outboundSignal,
        reconnectRequired: peer.phase === "failed" || peer.phase === "closed",
      });
      if (unavailable) void this.#coordinator?.setTransportAvailable(false);
      if (peer.phase === "open") {
        void this.#coordinator?.setTransportAvailable(true);
        void this.#startCoordinator();
      }
    });
  }

  getSnapshot(): OnlineMatchSessionSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: OnlineMatchSessionSnapshot) => void): () => void {
    this.#subscribers.add(listener);
    listener(this.#snapshot);
    return () => this.#subscribers.delete(listener);
  }

  async createOffer(): Promise<string> {
    try {
      const signal = await this.#peer.createOffer();
      this.#publish({ outboundSignal: signal, error: null });
      return signal;
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : "signaling-error" });
      throw error;
    }
  }

  async acceptOffer(frame: string): Promise<string> {
    try {
      const signal = await this.#peer.acceptOffer(frame);
      await this.#bindCoordinator();
      this.#publish({ outboundSignal: signal, error: null });
      return signal;
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : "signaling-error" });
      throw error;
    }
  }

  async acceptAnswer(frame: string): Promise<void> {
    try {
      await this.#peer.acceptAnswer(frame);
      await this.#bindCoordinator();
      this.#publish({ outboundSignal: null, error: null });
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : "signaling-error" });
      throw error;
    }
  }

  setLocalReady(): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.setLocalReady()
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  submitLocalMove(command: MoveCommand): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.submitLocalMove(command)
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  submitLocalResign(): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.submitLocalResign()
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  requestRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.requestRematch()
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  acceptRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.acceptRematch()
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  declineRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.declineRematch()
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  cancelRematch(): Promise<OnlineCoordinatorActionResult> {
    return this.#coordinator?.cancelRematch()
      ?? Promise.resolve({ ok: false, reason: "invalid-phase" });
  }

  setVisible(visible: boolean): Promise<void> {
    return this.#coordinator?.setVisible(visible) ?? Promise.resolve();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribePeer?.();
    this.#unsubscribePeer = null;
    this.#unsubscribeCoordinator?.();
    this.#unsubscribeCoordinator = null;
    this.#coordinator?.dispose();
    this.#coordinator = null;
    this.#peer.dispose();
    this.#earlyFrames.length = 0;
    this.#nextMatchFrames.length = 0;
    this.#subscribers.clear();
  }

  async #bindCoordinator(): Promise<void> {
    if (this.#disposed || this.#coordinator) return;
    const remotePeerId = this.#peer.getRemotePeerId();
    if (!remotePeerId) throw new Error("remote-peer-missing");
    const role = this.#options.identity.role;
    const rematchIndex = this.#options.identity.rematchIndex ?? 0;
    const identity: BoundOnlineMatchIdentity = {
      pairingId: this.#options.identity.pairingId,
      sessionId: this.#options.identity.sessionId,
      matchId: this.#options.identity.matchId,
      localPeerId: this.#options.identity.localPeerId,
      remotePeerId,
      signalingRole: role,
      localSide: this.#options.identity.localSide ?? onlineSideForRematch(rematchIndex, role),
      intent: this.#options.identity.intent,
      rematchIndex,
    };
    if (!await this.#options.bindMatch(identity)) throw new Error("match-bind-failed");
    if (this.#disposed) return;

    this.#installCoordinator(identity);
    if (this.#peer.getSnapshot().phase === "open") await this.#startCoordinator();
  }

  #installCoordinator(identity: BoundOnlineMatchIdentity): void {
    const coordinator = new OnlineMatchCoordinator({
      identity,
      send: (frame) => this.#peer.send(frame),
      getGame: this.#options.getGame,
      commitCommand: this.#options.commitCommand,
      installRecoveredGame: this.#options.installRecoveredGame,
      digest: this.#options.digest,
      createId: this.#options.createId,
      timers: {
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
    this.#coordinator = coordinator;
    this.#coordinatorIdentity = identity;
    this.#coordinatorStarted = false;
    this.#unsubscribeCoordinator = coordinator.subscribe((snapshot) => {
      this.#publish({ coordinator: snapshot });
      const proposal = snapshot.rematch.agreedProposal;
      if (proposal) void this.#rotateCoordinator(proposal);
    });
    this.#publish({ identity, coordinator: coordinator.getSnapshot() });
  }

  async #startCoordinator(): Promise<void> {
    const coordinator = this.#coordinator;
    if (
      !coordinator
      || this.#coordinatorStarted
      || this.#disposed
      || this.#peer.getSnapshot().phase !== "open"
    ) return;
    this.#coordinatorStarted = true;
    const result = await coordinator.start();
    if (!result.ok) {
      this.#publish({ error: `coordinator-${result.reason}` });
      return;
    }
    for (const frame of this.#earlyFrames.splice(0)) {
      this.#routeFrame(frame);
    }
    if (this.#expectedNextMatchId === this.#coordinatorIdentity?.matchId) {
      this.#expectedNextMatchId = null;
      for (const frame of this.#nextMatchFrames.splice(0)) {
        await coordinator.handleFrame(frame);
      }
    }
  }

  #routeFrame(frame: string): void {
    if (this.#disposed) return;
    const coordinator = this.#coordinator;
    const identity = this.#coordinatorIdentity;
    if (!coordinator || !this.#coordinatorStarted || !identity) {
      if (this.#earlyFrames.length < 32) this.#earlyFrames.push(frame);
      return;
    }
    const decoded = decodeOnlineMessageV1(frame);
    if (!decoded.ok) {
      void coordinator.handleFrame(frame);
      return;
    }
    const matchId = decoded.value.matchId;
    if (matchId === identity.matchId) {
      void coordinator.handleFrame(frame);
      return;
    }
    if (matchId === this.#expectedNextMatchId) {
      if (this.#nextMatchFrames.length < 32) this.#nextMatchFrames.push(frame);
      return;
    }
    // A reliable channel can still contain frames queued by the retired
    // coordinator. They must never reach the new match state.
    if (this.#retiredMatchIds.has(matchId)) return;
    // Any other match identity is a protocol violation. Let the coordinator
    // apply its normal fatal identity handling instead of silently accepting
    // an unbounded set of unrelated frames.
    void coordinator.handleFrame(frame);
  }

  async #rotateCoordinator(proposal: OnlineRematchProposal): Promise<void> {
    if (this.#disposed || this.#rotatingProposalId === proposal.proposalId) return;
    const previousIdentity = this.#coordinatorIdentity;
    const previousCoordinator = this.#coordinator;
    if (!previousIdentity || !previousCoordinator) return;
    this.#rotatingProposalId = proposal.proposalId;
    this.#expectedNextMatchId = proposal.nextMatchId;
    this.#publish({ rotatingToMatchId: proposal.nextMatchId, error: null });

    const identity: BoundOnlineMatchIdentity = Object.freeze({
      ...previousIdentity,
      matchId: proposal.nextMatchId,
      rematchIndex: proposal.nextRematchIndex,
      localSide: onlineSideForRematch(proposal.nextRematchIndex, previousIdentity.signalingRole),
    });

    let installed = false;
    try {
      installed = await this.#options.installRematch(identity, proposal);
    } catch {
      installed = false;
    }
    if (this.#disposed) return;
    if (!installed) {
      this.#expectedNextMatchId = null;
      this.#nextMatchFrames.length = 0;
      this.#rotatingProposalId = null;
      this.#publish({
        rotatingToMatchId: null,
        error: "rematch-install-failed",
        reconnectRequired: true,
      });
      return;
    }

    this.#unsubscribeCoordinator?.();
    this.#unsubscribeCoordinator = null;
    previousCoordinator.dispose();
    this.#retiredMatchIds.add(previousIdentity.matchId);
    this.#installCoordinator(identity);
    const replacementCoordinator = this.#coordinator;
    if (replacementCoordinator && this.#peer.getSnapshot().phase !== "open") {
      await replacementCoordinator.setTransportAvailable(false);
    }
    this.#publish({ rotatingToMatchId: null, error: null, reconnectRequired: false });
    if (this.#peer.getSnapshot().phase === "open") await this.#startCoordinator();
    this.#rotatingProposalId = null;
  }

  #publish(patch: Partial<OnlineMatchSessionSnapshot>): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
    for (const subscriber of [...this.#subscribers]) subscriber(this.#snapshot);
  }
}
