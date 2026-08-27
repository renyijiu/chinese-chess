import type { GameCommand, GameState, MoveCommand, Side } from "../../../lib/xiangqi/index";
import type { OnlineIntentV1 } from "../../../lib/xiangqi/online";
import {
  OnlineMatchCoordinator,
  type OnlineCommitContext,
  type OnlineCommandCommitResult,
  type OnlineCoordinatorActionResult,
  type OnlineMatchCoordinatorSnapshot,
  type OnlineMatchIdentity,
} from "./OnlineMatchCoordinator";
import {
  PeerSession,
  type PeerConnectionPort,
  type PeerSessionIdentity,
  type PeerSessionSnapshot,
} from "./PeerSession";

export interface OnlineMatchSessionIdentity {
  readonly role: "host" | "guest";
  readonly sessionId: string;
  readonly pairingId: string;
  readonly matchId: string;
  readonly localPeerId: string;
  readonly remotePeerId?: string | null;
  readonly intent: OnlineIntentV1;
  readonly localSide?: Side;
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
  #coordinator: OnlineMatchCoordinator | null = null;
  #unsubscribePeer: (() => void) | null = null;
  #unsubscribeCoordinator: (() => void) | null = null;
  #coordinatorStarted = false;
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
      remotePeerId: options.identity.remotePeerId,
      intent: options.identity.intent,
    };
    this.#peer = new PeerSession({
      identity,
      rtcConfiguration: options.rtcConfiguration,
      peerConnectionFactory: options.peerConnectionFactory,
      onFrame: (frame) => {
        if (this.#coordinator && this.#coordinatorStarted) {
          void this.#coordinator.handleFrame(frame);
        }
        else if (this.#earlyFrames.length < 32) this.#earlyFrames.push(frame);
      },
      onFrameRejected: (reason) => this.#publish({ error: `frame-${reason}` }),
    });
    this.#snapshot = Object.freeze({
      peer: this.#peer.getSnapshot(),
      coordinator: EMPTY_COORDINATOR_SNAPSHOT,
      outboundSignal: null,
      identity: null,
      error: null,
    });
    this.#unsubscribePeer = this.#peer.subscribe((peer) => {
      this.#publish({ peer });
      if (peer.phase === "open") void this.#startCoordinator();
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
      this.#publish({ error: null });
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
    this.#subscribers.clear();
  }

  async #bindCoordinator(): Promise<void> {
    if (this.#disposed || this.#coordinator) return;
    const remotePeerId = this.#peer.getRemotePeerId();
    if (!remotePeerId) throw new Error("remote-peer-missing");
    const role = this.#options.identity.role;
    const identity: BoundOnlineMatchIdentity = {
      pairingId: this.#options.identity.pairingId,
      sessionId: this.#options.identity.sessionId,
      matchId: this.#options.identity.matchId,
      localPeerId: this.#options.identity.localPeerId,
      remotePeerId,
      signalingRole: role,
      localSide: this.#options.identity.localSide ?? (role === "host" ? "red" : "black"),
      intent: this.#options.identity.intent,
    };
    if (!await this.#options.bindMatch(identity)) throw new Error("match-bind-failed");
    if (this.#disposed) return;

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
    this.#unsubscribeCoordinator = coordinator.subscribe((snapshot) => {
      this.#publish({ coordinator: snapshot });
    });
    this.#publish({ identity, coordinator: coordinator.getSnapshot() });
    if (this.#peer.getSnapshot().phase === "open") await this.#startCoordinator();
  }

  async #startCoordinator(): Promise<void> {
    const coordinator = this.#coordinator;
    if (!coordinator || this.#coordinatorStarted || this.#disposed) return;
    this.#coordinatorStarted = true;
    const result = await coordinator.start();
    if (!result.ok) {
      this.#publish({ error: `coordinator-${result.reason}` });
      return;
    }
    for (const frame of this.#earlyFrames.splice(0)) {
      await coordinator.handleFrame(frame);
    }
  }

  #publish(patch: Partial<OnlineMatchSessionSnapshot>): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
    for (const subscriber of [...this.#subscribers]) subscriber(this.#snapshot);
  }
}
