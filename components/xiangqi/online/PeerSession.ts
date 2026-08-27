import {
  MAX_ONLINE_FRAME_BYTES,
  SIGNALING_VERSION,
  decodeSignalingMessageV1,
  encodeSignalingMessageV1,
  isSignalingMessageExpired,
  type OnlineIntentV1,
  type SignalingAnswerV1,
  type SignalingOfferV1,
} from "../../../lib/xiangqi/online";

const CHANNEL_LABEL = "xiangqi-v1";
const MAX_QUEUED_FRAMES = 32;
const MAX_QUEUED_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

export type PeerSessionPhase =
  | "idle"
  | "gathering"
  | "waiting-answer"
  | "answer-ready"
  | "connecting"
  | "open"
  | "disconnected-grace"
  | "failed"
  | "closed";

export type PeerSessionFailure =
  | "gather-timeout"
  | "connect-timeout"
  | "disconnect-timeout"
  | "connection-failed"
  | "channel-closed"
  | "channel-error"
  | "invalid-channel"
  | "signaling-error"
  | "send-error";

export type PeerSessionErrorCode =
  | "invalid-state"
  | "invalid-signal"
  | "identity-mismatch"
  | "signal-expired"
  | "gather-timeout";

export type PeerSessionFrameRejection = "binary" | "message-too-large" | "rate-limit";

export type PeerSessionSendResult =
  | Readonly<{ ok: true; queued: boolean }>
  | Readonly<{ ok: false; reason: "not-open" | "message-too-large" | "queue-full" | "send-error" }>;

export interface PeerSessionSnapshot {
  readonly phase: PeerSessionPhase;
  readonly connectionState: RTCPeerConnectionState | null;
  readonly queuedFrames: number;
  readonly queuedBytes: number;
  readonly failure: PeerSessionFailure | null;
}

export interface PeerSessionIdentity {
  readonly role: "host" | "guest";
  readonly sessionId: string;
  readonly pairingId: string;
  readonly matchId: string;
  readonly localPeerId: string;
  readonly remotePeerId?: string | null;
  readonly intent: OnlineIntentV1;
}

export interface PeerSessionTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DataChannelPort {
  readonly label: string;
  readonly ordered: boolean;
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
}

export interface PeerConnectionPort {
  readonly iceGatheringState: RTCIceGatheringState;
  readonly connectionState: RTCPeerConnectionState;
  readonly localDescription: RTCSessionDescription | null;
  readonly sctp: Readonly<{ maxMessageSize: number }> | null;
  createDataChannel(label: string, options?: RTCDataChannelInit): DataChannelPort;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
}

export interface PeerSessionOptions {
  readonly identity: PeerSessionIdentity;
  readonly peerConnectionFactory: (configuration?: RTCConfiguration) => PeerConnectionPort;
  readonly timers?: PeerSessionTimers;
  readonly now?: () => number;
  readonly rtcConfiguration?: RTCConfiguration;
  readonly signalingTtlMs?: number;
  readonly gatherTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly disconnectGraceMs?: number;
  readonly maxBufferedAmountBytes?: number;
  readonly bufferedAmountLowThreshold?: number;
  readonly inboundRateLimit?: Readonly<{ maximumFrames: number; windowMs: number }>;
  readonly onFrame: (frame: string) => void;
  readonly onFrameRejected?: (reason: PeerSessionFrameRejection) => void;
}

interface QueuedFrame {
  readonly frame: string;
  readonly bytes: number;
}

const defaultTimers: PeerSessionTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class PeerSessionError extends Error {
  constructor(readonly code: PeerSessionErrorCode) {
    super(code);
    this.name = "PeerSessionError";
  }
}

export class PeerSession {
  private readonly identity: PeerSessionIdentity;
  private readonly peerConnectionFactory: PeerSessionOptions["peerConnectionFactory"];
  private readonly timers: PeerSessionTimers;
  private readonly now: () => number;
  private readonly rtcConfiguration: RTCConfiguration | undefined;
  private readonly signalingTtlMs: number;
  private readonly gatherTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly disconnectGraceMs: number;
  private readonly maxBufferedAmountBytes: number;
  private readonly bufferedAmountLowThreshold: number;
  private readonly inboundRateLimit: Readonly<{ maximumFrames: number; windowMs: number }>;
  private readonly onFrame: (frame: string) => void;
  private readonly onFrameRejected: ((reason: PeerSessionFrameRejection) => void) | undefined;
  private readonly subscribers = new Set<(snapshot: PeerSessionSnapshot) => void>();
  private readonly disposers: Array<() => void> = [];
  private readonly timerHandles = new Set<unknown>();
  private readonly sendQueue: QueuedFrame[] = [];
  private readonly inboundFrameTimes: number[] = [];

  private peerConnection: PeerConnectionPort | null = null;
  private dataChannel: DataChannelPort | null = null;
  private activeOffer: SignalingOfferV1 | null = null;
  private remotePeerId: string | null;
  private phase: PeerSessionPhase = "idle";
  private failure: PeerSessionFailure | null = null;
  private queuedBytes = 0;
  private inboundFrameHead = 0;
  private generation = 1;
  private resourcesReleased = false;
  private connectTimer: unknown | null = null;
  private disconnectTimer: unknown | null = null;
  private snapshot: PeerSessionSnapshot = {
    phase: "idle",
    connectionState: null,
    queuedFrames: 0,
    queuedBytes: 0,
    failure: null,
  };

  constructor(options: PeerSessionOptions) {
    this.identity = options.identity;
    this.remotePeerId = options.identity.remotePeerId ?? null;
    this.peerConnectionFactory = options.peerConnectionFactory;
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? Date.now;
    this.rtcConfiguration = options.rtcConfiguration;
    this.signalingTtlMs = options.signalingTtlMs ?? 10 * 60_000;
    this.gatherTimeoutMs = options.gatherTimeoutMs ?? 15_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 15_000;
    this.maxBufferedAmountBytes = options.maxBufferedAmountBytes ?? 256 * 1024;
    this.bufferedAmountLowThreshold = options.bufferedAmountLowThreshold ?? 64 * 1024;
    this.inboundRateLimit = options.inboundRateLimit ?? { maximumFrames: 120, windowMs: 10_000 };
    this.onFrame = options.onFrame;
    this.onFrameRejected = options.onFrameRejected;
  }

  getSnapshot(): PeerSessionSnapshot {
    return this.snapshot;
  }

  getRemotePeerId(): string | null {
    return this.remotePeerId;
  }

  subscribe(listener: (snapshot: PeerSessionSnapshot) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async createOffer(): Promise<string> {
    this.assertRole("host");
    this.assertPhase("idle");
    const generation = this.generation;
    const peerConnection = this.ensurePeerConnection(generation);

    try {
      const channel = peerConnection.createDataChannel(CHANNEL_LABEL, { ordered: true });
      if (!this.attachDataChannel(channel, generation)) {
        throw new PeerSessionError("invalid-state");
      }
      this.publish("gathering");
      const offer = await peerConnection.createOffer();
      this.assertCurrent(generation);
      await peerConnection.setLocalDescription(offer);
      this.assertCurrent(generation);
      await this.waitForIceGathering(generation);
      const description = this.requireLocalDescription("offer");
      const createdAt = this.now();
      const message: SignalingOfferV1 = {
        signalVersion: SIGNALING_VERSION,
        kind: "offer",
        sessionId: this.identity.sessionId,
        pairingId: this.identity.pairingId,
        matchId: this.identity.matchId,
        hostPeerId: this.identity.localPeerId,
        intent: this.identity.intent,
        createdAt,
        expiresAt: createdAt + this.signalingTtlMs,
        description,
      };
      const encoded = encodeSignalingMessageV1(message);
      if (!encoded.ok) throw new PeerSessionError("invalid-signal");
      this.activeOffer = message;
      this.publish("waiting-answer");
      return encoded.value;
    } catch (error) {
      this.failUnexpectedSignaling(error, generation);
      throw this.normalizeError(error);
    }
  }

  async acceptOffer(frame: string): Promise<string> {
    this.assertRole("guest");
    this.assertPhase("idle");
    const offer = this.decodeSignal(frame, "offer");
    if (offer.kind !== "offer") throw new PeerSessionError("invalid-signal");
    this.assertOfferIdentity(offer);
    this.assertSignalFresh(offer);

    const generation = this.generation;
    const peerConnection = this.ensurePeerConnection(generation);
    try {
      this.publish("gathering");
      await peerConnection.setRemoteDescription(offer.description);
      this.assertCurrent(generation);
      const answer = await peerConnection.createAnswer();
      this.assertCurrent(generation);
      await peerConnection.setLocalDescription(answer);
      this.assertCurrent(generation);
      await this.waitForIceGathering(generation);
      const description = this.requireLocalDescription("answer");
      const createdAt = this.now();
      const message: SignalingAnswerV1 = {
        signalVersion: SIGNALING_VERSION,
        kind: "answer",
        sessionId: offer.sessionId,
        pairingId: offer.pairingId,
        matchId: offer.matchId,
        hostPeerId: offer.hostPeerId,
        guestPeerId: this.identity.localPeerId,
        intent: offer.intent,
        createdAt,
        expiresAt: createdAt + this.signalingTtlMs,
        description,
      };
      const encoded = encodeSignalingMessageV1(message);
      if (!encoded.ok) throw new PeerSessionError("invalid-signal");
      if (
        peerConnection.connectionState === "connecting"
        || peerConnection.connectionState === "connected"
      ) {
        this.beginConnecting(generation);
      } else {
        this.publish("answer-ready");
      }
      return encoded.value;
    } catch (error) {
      this.failUnexpectedSignaling(error, generation);
      throw this.normalizeError(error);
    }
  }

  async acceptAnswer(frame: string): Promise<void> {
    this.assertRole("host");
    this.assertPhase("waiting-answer");
    const offer = this.activeOffer;
    if (offer === null) throw new PeerSessionError("invalid-state");
    const answer = this.decodeSignal(frame, "answer");
    if (answer.kind !== "answer") throw new PeerSessionError("invalid-signal");
    this.assertAnswerIdentity(answer, offer);
    this.assertSignalFresh(answer);

    const generation = this.generation;
    const peerConnection = this.peerConnection;
    if (peerConnection === null) throw new PeerSessionError("invalid-state");
    try {
      await peerConnection.setRemoteDescription(answer.description);
      this.assertCurrent(generation);
      this.beginConnecting(generation);
    } catch (error) {
      this.failUnexpectedSignaling(error, generation);
      throw this.normalizeError(error);
    }
  }

  send(frame: string): PeerSessionSendResult {
    const channel = this.dataChannel;
    const peerConnection = this.peerConnection;
    if (this.phase !== "open" || channel?.readyState !== "open" || peerConnection === null) {
      return { ok: false, reason: "not-open" };
    }

    const bytes = this.byteLength(frame);
    const negotiatedMaximum = peerConnection.sctp?.maxMessageSize ?? 0;
    if (bytes > MAX_ONLINE_FRAME_BYTES || (negotiatedMaximum > 0 && bytes > negotiatedMaximum)) {
      return { ok: false, reason: "message-too-large" };
    }

    if (this.sendQueue.length > 0 || channel.bufferedAmount >= this.maxBufferedAmountBytes) {
      if (this.sendQueue.length >= MAX_QUEUED_FRAMES || this.queuedBytes + bytes > MAX_QUEUED_BYTES) {
        return { ok: false, reason: "queue-full" };
      }
      this.sendQueue.push({ frame, bytes });
      this.queuedBytes += bytes;
      if (channel.bufferedAmount < this.maxBufferedAmountBytes) this.drainQueue();
      else this.publish();
      return { ok: true, queued: true };
    }

    return this.sendImmediately(frame);
  }

  close(): void {
    if (this.phase === "closed" || this.phase === "failed") return;
    this.publish("closed");
    this.releaseResources();
  }

  dispose(): void {
    this.close();
  }

  private ensurePeerConnection(generation: number): PeerConnectionPort {
    if (this.peerConnection !== null) return this.peerConnection;
    const peerConnection = this.peerConnectionFactory(this.rtcConfiguration);
    this.peerConnection = peerConnection;

    const onConnectionStateChange: EventListener = () => {
      if (!this.isCurrent(generation)) return;
      this.handleConnectionStateChange(generation);
    };
    peerConnection.addEventListener("connectionstatechange", onConnectionStateChange);
    this.disposers.push(() => {
      peerConnection.removeEventListener("connectionstatechange", onConnectionStateChange);
    });

    if (this.identity.role === "guest") {
      const onDataChannel: EventListener = (event) => {
        if (!this.isCurrent(generation)) return;
        const channel = (event as RTCDataChannelEvent).channel;
        if (this.dataChannel !== null) {
          channel.close();
          this.fail("invalid-channel");
          return;
        }
        this.attachDataChannel(channel, generation);
      };
      peerConnection.addEventListener("datachannel", onDataChannel);
      this.disposers.push(() => peerConnection.removeEventListener("datachannel", onDataChannel));
    }
    this.publish();
    return peerConnection;
  }

  private attachDataChannel(channel: DataChannelPort, generation: number): boolean {
    this.dataChannel = channel;
    if (channel.label !== CHANNEL_LABEL || channel.ordered !== true) {
      this.fail("invalid-channel");
      return false;
    }
    channel.bufferedAmountLowThreshold = this.bufferedAmountLowThreshold;

    const onOpen: EventListener = () => {
      if (!this.isCurrent(generation)) return;
      this.clearConnectTimer();
      this.clearDisconnectTimer();
      this.publish("open");
    };
    const onMessage: EventListener = (event) => {
      if (!this.isCurrent(generation)) return;
      this.handleMessage((event as MessageEvent<unknown>).data);
    };
    const onBufferedAmountLow: EventListener = () => {
      if (!this.isCurrent(generation)) return;
      this.drainQueue();
    };
    const onClose: EventListener = () => {
      if (this.isCurrent(generation)) this.fail("channel-closed");
    };
    const onError: EventListener = () => {
      if (this.isCurrent(generation)) this.fail("channel-error");
    };

    channel.addEventListener("open", onOpen);
    channel.addEventListener("message", onMessage);
    channel.addEventListener("bufferedamountlow", onBufferedAmountLow);
    channel.addEventListener("close", onClose);
    channel.addEventListener("error", onError);
    this.disposers.push(() => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("message", onMessage);
      channel.removeEventListener("bufferedamountlow", onBufferedAmountLow);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
    });

    if (channel.readyState === "open") onOpen({ type: "open" } as Event);
    return true;
  }

  private waitForIceGathering(generation: number): Promise<void> {
    const peerConnection = this.peerConnection;
    if (peerConnection === null) return Promise.reject(new PeerSessionError("invalid-state"));
    if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: PeerSessionError) => {
        if (settled) return;
        settled = true;
        peerConnection.removeEventListener("icegatheringstatechange", onGatheringChange);
        this.clearTimer(timeout);
        if (error) reject(error);
        else resolve();
      };
      const onGatheringChange: EventListener = () => {
        if (!this.isCurrent(generation)) return;
        if (peerConnection.iceGatheringState === "complete") finish();
      };
      peerConnection.addEventListener("icegatheringstatechange", onGatheringChange);
      const timeout = this.schedule(() => {
        const error = new PeerSessionError("gather-timeout");
        finish(error);
        this.fail("gather-timeout");
      }, this.gatherTimeoutMs);
      this.disposers.push(() => finish(new PeerSessionError("invalid-state")));
      if (peerConnection.iceGatheringState === "complete") finish();
    });
  }

  private beginConnecting(generation: number): void {
    if (!this.isCurrent(generation)) return;
    if (this.dataChannel?.readyState === "open") {
      this.clearConnectTimer();
      this.publish("open");
      return;
    }
    this.publish("connecting");
    this.clearConnectTimer();
    this.connectTimer = this.schedule(() => {
      this.connectTimer = null;
      if (this.isCurrent(generation) && this.phase !== "open") this.fail("connect-timeout");
    }, this.connectTimeoutMs);
  }

  private handleConnectionStateChange(generation: number): void {
    const state = this.peerConnection?.connectionState;
    if (state === "failed" || state === "closed") {
      this.fail("connection-failed");
      return;
    }
    if (state === "disconnected") {
      this.clearConnectTimer();
      this.clearDisconnectTimer();
      this.publish("disconnected-grace");
      this.disconnectTimer = this.schedule(() => {
        this.disconnectTimer = null;
        if (this.isCurrent(generation) && this.phase === "disconnected-grace") {
          this.fail("disconnect-timeout");
        }
      }, this.disconnectGraceMs);
      return;
    }
    if (
      this.phase === "answer-ready"
      && (state === "connecting" || state === "connected")
    ) {
      this.beginConnecting(generation);
      return;
    }
    if (this.phase === "disconnected-grace") {
      this.clearDisconnectTimer();
      if (this.dataChannel?.readyState === "open") {
        this.publish("open");
      } else {
        this.beginConnecting(generation);
      }
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      this.onFrameRejected?.("binary");
      return;
    }
    if (this.byteLength(data) > MAX_ONLINE_FRAME_BYTES) {
      this.onFrameRejected?.("message-too-large");
      return;
    }

    const now = this.now();
    const oldestAllowed = now - this.inboundRateLimit.windowMs;
    while (
      this.inboundFrameHead < this.inboundFrameTimes.length
      && this.inboundFrameTimes[this.inboundFrameHead] <= oldestAllowed
    ) {
      this.inboundFrameHead += 1;
    }
    if (
      this.inboundFrameHead > 0
      && (this.inboundFrameHead >= 64 || this.inboundFrameHead * 2 >= this.inboundFrameTimes.length)
    ) {
      this.inboundFrameTimes.splice(0, this.inboundFrameHead);
      this.inboundFrameHead = 0;
    }
    if (
      this.inboundFrameTimes.length - this.inboundFrameHead
      >= this.inboundRateLimit.maximumFrames
    ) {
      this.onFrameRejected?.("rate-limit");
      return;
    }
    this.inboundFrameTimes.push(now);
    this.onFrame(data);
  }

  private drainQueue(): void {
    const channel = this.dataChannel;
    if (this.phase !== "open" || channel?.readyState !== "open") return;
    let changed = false;
    while (this.sendQueue.length > 0 && channel.bufferedAmount < this.maxBufferedAmountBytes) {
      const queued = this.sendQueue.shift();
      if (!queued) break;
      changed = true;
      this.queuedBytes -= queued.bytes;
      try {
        channel.send(queued.frame);
      } catch {
        this.publish();
        this.fail("send-error");
        return;
      }
    }
    if (changed) this.publish();
  }

  private sendImmediately(frame: string): PeerSessionSendResult {
    try {
      this.dataChannel?.send(frame);
      return { ok: true, queued: false };
    } catch {
      this.fail("send-error");
      return { ok: false, reason: "send-error" };
    }
  }

  private decodeSignal(frame: string, kind: "offer" | "answer") {
    const decoded = decodeSignalingMessageV1(frame, kind);
    if (!decoded.ok) throw new PeerSessionError("invalid-signal");
    return decoded.value;
  }

  private assertOfferIdentity(offer: SignalingOfferV1): void {
    if (
      offer.sessionId !== this.identity.sessionId
      || offer.pairingId !== this.identity.pairingId
      || offer.matchId !== this.identity.matchId
      || (this.remotePeerId !== null && offer.hostPeerId !== this.remotePeerId)
      || offer.intent !== this.identity.intent
      || offer.hostPeerId === this.identity.localPeerId
    ) {
      throw new PeerSessionError("identity-mismatch");
    }
    this.remotePeerId = offer.hostPeerId;
  }

  private assertAnswerIdentity(answer: SignalingAnswerV1, offer: SignalingOfferV1): void {
    if (
      answer.sessionId !== offer.sessionId
      || answer.pairingId !== offer.pairingId
      || answer.matchId !== offer.matchId
      || answer.hostPeerId !== offer.hostPeerId
      || answer.hostPeerId !== this.identity.localPeerId
      || (this.remotePeerId !== null && answer.guestPeerId !== this.remotePeerId)
      || answer.intent !== offer.intent
    ) {
      throw new PeerSessionError("identity-mismatch");
    }
    this.remotePeerId = answer.guestPeerId;
  }

  private assertSignalFresh(signal: SignalingOfferV1 | SignalingAnswerV1): void {
    if (isSignalingMessageExpired(signal, this.now())) {
      throw new PeerSessionError("signal-expired");
    }
  }

  private requireLocalDescription<Kind extends "offer" | "answer">(
    kind: Kind,
  ): Readonly<{ type: Kind; sdp: string }> {
    const description = this.peerConnection?.localDescription;
    if (description?.type !== kind || typeof description.sdp !== "string") {
      throw new PeerSessionError("invalid-signal");
    }
    return { type: kind, sdp: description.sdp };
  }

  private assertRole(role: PeerSessionIdentity["role"]): void {
    if (this.identity.role !== role) throw new PeerSessionError("invalid-state");
  }

  private assertPhase(phase: PeerSessionPhase): void {
    if (this.phase !== phase) throw new PeerSessionError("invalid-state");
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new PeerSessionError("invalid-state");
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.phase !== "closed" && this.phase !== "failed";
  }

  private failUnexpectedSignaling(error: unknown, generation: number): void {
    if (this.isCurrent(generation)) this.fail("signaling-error");
  }

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new PeerSessionError("invalid-state");
  }

  private fail(reason: PeerSessionFailure): void {
    if (this.phase === "closed" || this.phase === "failed") return;
    this.failure = reason;
    this.publish("failed");
    this.releaseResources();
  }

  private publish(phase: PeerSessionPhase = this.phase): void {
    this.phase = phase;
    this.snapshot = {
      phase,
      connectionState: this.peerConnection?.connectionState ?? null,
      queuedFrames: this.sendQueue.length,
      queuedBytes: this.queuedBytes,
      failure: this.failure,
    };
    for (const subscriber of [...this.subscribers]) subscriber(this.snapshot);
  }

  private schedule(callback: () => void, delayMs: number): unknown {
    const handle = this.timers.setTimeout(() => {
      this.timerHandles.delete(handle);
      callback();
    }, delayMs);
    this.timerHandles.add(handle);
    return handle;
  }

  private clearTimer(handle: unknown | null): void {
    if (handle === null || !this.timerHandles.delete(handle)) return;
    this.timers.clearTimeout(handle);
  }

  private clearConnectTimer(): void {
    this.clearTimer(this.connectTimer);
    this.connectTimer = null;
  }

  private clearDisconnectTimer(): void {
    this.clearTimer(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private releaseResources(): void {
    if (this.resourcesReleased) return;
    this.resourcesReleased = true;
    this.generation += 1;
    for (const handle of this.timerHandles) this.timers.clearTimeout(handle);
    this.timerHandles.clear();
    this.connectTimer = null;
    this.disconnectTimer = null;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.sendQueue.length = 0;
    this.queuedBytes = 0;
    this.inboundFrameTimes.length = 0;
    this.inboundFrameHead = 0;
    this.activeOffer = null;
    this.subscribers.clear();

    const channel = this.dataChannel;
    const peerConnection = this.peerConnection;
    this.dataChannel = null;
    this.peerConnection = null;
    channel?.close();
    peerConnection?.close();
    this.snapshot = {
      ...this.snapshot,
      connectionState: null,
      queuedFrames: 0,
      queuedBytes: 0,
    };
  }

  private byteLength(frame: string): number {
    return textEncoder.encode(frame).byteLength;
  }
}
