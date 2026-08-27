import { describe, expect, it, vi } from "vitest";

import {
  PeerSession,
  PeerSessionError,
  type PeerConnectionPort,
  type PeerSessionOptions,
  type PeerSessionTimers,
} from "../../../components/xiangqi/online/PeerSession";
import {
  SIGNALING_VERSION,
  decodeSignalingMessageV1,
  encodeSignalingMessageV1,
  type SignalingAnswerV1,
  type SignalingOfferV1,
} from "../../../lib/xiangqi/online";

const APPLICATION_SDP = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=sctp-port:5000",
  "",
].join("\r\n");

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null || typeof listener !== "function") return;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === "function") this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event = { type } as Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeDataChannel extends FakeEventTarget {
  readonly label = "xiangqi-v1";
  readonly ordered = true;
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readonly sent: string[] = [];
  closeCalls = 0;
  onClose?: () => void;

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closeCalls += 1;
    this.onClose?.();
    this.readyState = "closed";
  }

  open(): void {
    this.readyState = "open";
    this.emit("open");
  }

  message(data: unknown): void {
    this.emit("message", { type: "message", data } as unknown as MessageEvent);
  }
}

class FakePeerConnection extends FakeEventTarget implements PeerConnectionPort {
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  readonly sctp = { maxMessageSize: 256 * 1024 };
  readonly channel = new FakeDataChannel();
  readonly calls: string[] = [];
  closeCalls = 0;
  onClose?: () => void;

  createDataChannel(label: string, options?: RTCDataChannelInit): FakeDataChannel {
    this.calls.push(`createDataChannel:${label}:${String(options?.ordered)}`);
    return this.channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.calls.push("createOffer");
    return { type: "offer", sdp: APPLICATION_SDP };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.calls.push("createAnswer");
    return { type: "answer", sdp: APPLICATION_SDP };
  }

  async setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void> {
    this.calls.push(`setLocal:${description?.type}`);
    this.localDescription = description as RTCSessionDescription;
    this.iceGatheringState = "gathering";
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.calls.push(`setRemote:${description.type}`);
  }

  completeIce(sdp = `${APPLICATION_SDP}a=candidate:final\r\n`): void {
    const type = this.localDescription?.type ?? "offer";
    this.localDescription = { type, sdp, toJSON: () => ({ type, sdp }) } as RTCSessionDescription;
    this.iceGatheringState = "complete";
    this.emit("icegatheringstatechange");
  }

  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.emit("connectionstatechange");
  }

  receiveDataChannel(channel = this.channel): void {
    this.emit("datachannel", { type: "datachannel", channel } as unknown as RTCDataChannelEvent);
  }

  close(): void {
    this.closeCalls += 1;
    this.onClose?.();
    this.connectionState = "closed";
  }
}

class ManualTimers implements PeerSessionTimers {
  private nextId = 1;
  private nowMs = 0;
  private readonly entries = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.entries.set(id, { at: this.nowMs + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.entries.delete(handle as number);
  }

  advance(delayMs: number): void {
    this.nowMs += delayMs;
    for (;;) {
      const due = [...this.entries.entries()]
        .filter(([, entry]) => entry.at <= this.nowMs)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.entries.delete(due[0]);
      due[1].callback();
    }
  }

  size(): number {
    return this.entries.size;
  }
}

const hostIdentity = {
  role: "host",
  sessionId: "session-1",
  pairingId: "pairing-1",
  matchId: "match-1",
  localPeerId: "peer-host",
  remotePeerId: "peer-guest",
  intent: "new",
} as const;

const guestIdentity = {
  role: "guest",
  sessionId: "session-1",
  pairingId: "pairing-1",
  matchId: "match-1",
  localPeerId: "peer-guest",
  remotePeerId: "peer-host",
  intent: "new",
} as const;

function makeHarness(
  identity: PeerSessionOptions["identity"] = hostIdentity,
  overrides: Partial<Omit<PeerSessionOptions, "identity" | "peerConnectionFactory">> = {},
) {
  const pc = new FakePeerConnection();
  const timers = new ManualTimers();
  let now = 1_000;
  const factory = vi.fn(() => pc);
  const rejected: string[] = [];
  const frames: string[] = [];
  const session = new PeerSession({
    identity,
    peerConnectionFactory: factory,
    timers,
    now: () => now,
    signalingTtlMs: 60_000,
    gatherTimeoutMs: 1_000,
    connectTimeoutMs: 2_000,
    disconnectGraceMs: 500,
    maxBufferedAmountBytes: 64,
    bufferedAmountLowThreshold: 16,
    inboundRateLimit: { maximumFrames: 2, windowMs: 100 },
    onFrame: (frame) => frames.push(frame),
    onFrameRejected: (reason) => rejected.push(reason),
    ...overrides,
  });
  return { pc, timers, factory, session, frames, rejected, setNow: (value: number) => { now = value; } };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function createHostOffer(harness = makeHarness()): Promise<{
  encoded: string;
  offer: SignalingOfferV1;
}> {
  const pending = harness.session.createOffer();
  await flushMicrotasks();
  harness.pc.completeIce();
  const encoded = await pending;
  const decoded = decodeSignalingMessageV1(encoded, "offer");
  if (!decoded.ok || decoded.value.kind !== "offer") throw new Error("bad offer fixture");
  return { encoded, offer: decoded.value };
}

function encodeAnswer(
  offer: SignalingOfferV1,
  overrides: Partial<SignalingAnswerV1> = {},
): string {
  const encoded = encodeSignalingMessageV1({
    signalVersion: SIGNALING_VERSION,
    kind: "answer",
    sessionId: offer.sessionId,
    pairingId: offer.pairingId,
    matchId: offer.matchId,
    hostPeerId: offer.hostPeerId,
    guestPeerId: "peer-guest",
    intent: offer.intent,
    createdAt: 1_100,
    expiresAt: 61_100,
    description: { type: "answer", sdp: APPLICATION_SDP },
    ...overrides,
  });
  if (!encoded.ok) throw new Error(encoded.error.code);
  return encoded.value;
}

describe("PeerSession signaling and lifecycle", () => {
  it("creates the ordered host channel before the offer and encodes the final gathered SDP", async () => {
    const rtcConfiguration: RTCConfiguration = { iceServers: [] };
    const harness = makeHarness(hostIdentity, { rtcConfiguration });
    const snapshots: string[] = [];
    harness.session.subscribe(() => snapshots.push(harness.session.getSnapshot().phase));

    const pending = harness.session.createOffer();
    await flushMicrotasks();
    expect(harness.pc.calls).toEqual([
      "createDataChannel:xiangqi-v1:true",
      "createOffer",
      "setLocal:offer",
    ]);
    expect(harness.factory).toHaveBeenCalledWith(rtcConfiguration);
    expect(harness.pc.channel.bufferedAmountLowThreshold).toBe(16);
    expect(harness.session.getSnapshot().phase).toBe("gathering");

    const finalSdp = `${APPLICATION_SDP}a=candidate:host-final\r\n`;
    harness.pc.completeIce(finalSdp);
    const encoded = await pending;
    const decoded = decodeSignalingMessageV1(encoded, "offer");
    expect(decoded.ok && decoded.value.description.sdp).toBe(finalSdp);
    expect(harness.session.getSnapshot().phase).toBe("waiting-answer");

    harness.pc.channel.open();
    expect(harness.session.getSnapshot().phase).toBe("open");
    expect(snapshots).toContain("open");
  });

  it("strictly validates and identity-checks an offer before creating the guest peer", async () => {
    const harness = makeHarness(guestIdentity);

    await expect(harness.session.acceptOffer("not-json")).rejects.toMatchObject({
      name: "PeerSessionError",
      code: "invalid-signal",
    });
    expect(harness.factory).not.toHaveBeenCalled();

    const foreignOffer = encodeSignalingMessageV1({
      signalVersion: SIGNALING_VERSION,
      kind: "offer",
      sessionId: "another-session",
      pairingId: guestIdentity.pairingId,
      matchId: guestIdentity.matchId,
      hostPeerId: guestIdentity.remotePeerId,
      intent: guestIdentity.intent,
      createdAt: 900,
      expiresAt: 10_000,
      description: { type: "offer", sdp: APPLICATION_SDP },
    });
    if (!foreignOffer.ok) throw new Error(foreignOffer.error.code);
    await expect(harness.session.acceptOffer(foreignOffer.value)).rejects.toMatchObject({
      code: "identity-mismatch",
    });
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it("sets a valid guest offer before answering and encodes the final local description", async () => {
    const harness = makeHarness(guestIdentity);
    const offer = encodeSignalingMessageV1({
      signalVersion: SIGNALING_VERSION,
      kind: "offer",
      sessionId: guestIdentity.sessionId,
      pairingId: guestIdentity.pairingId,
      matchId: guestIdentity.matchId,
      hostPeerId: guestIdentity.remotePeerId,
      intent: guestIdentity.intent,
      createdAt: 900,
      expiresAt: 10_000,
      description: { type: "offer", sdp: APPLICATION_SDP },
    });
    if (!offer.ok) throw new Error(offer.error.code);

    const pending = harness.session.acceptOffer(offer.value);
    await flushMicrotasks();
    expect(harness.pc.calls).toEqual(["setRemote:offer", "createAnswer", "setLocal:answer"]);

    const finalSdp = `${APPLICATION_SDP}a=candidate:guest-final\r\n`;
    harness.pc.completeIce(finalSdp);
    const answer = await pending;
    const decoded = decodeSignalingMessageV1(answer, "answer");
    expect(decoded.ok && decoded.value.description.sdp).toBe(finalSdp);
    expect(decoded.ok && decoded.value.kind === "answer" && decoded.value.guestPeerId)
      .toBe(guestIdentity.localPeerId);
    expect(harness.session.getSnapshot().phase).toBe("answer-ready");

    harness.pc.receiveDataChannel();
    harness.pc.channel.open();
    expect(harness.session.getSnapshot().phase).toBe("open");
  });

  it("rejects every answer identity mismatch without applying remote SDP", async () => {
    const harness = makeHarness();
    const { offer } = await createHostOffer(harness);
    const mismatches: Array<Partial<SignalingAnswerV1>> = [
      { sessionId: "wrong-session" },
      { pairingId: "wrong-pairing" },
      { matchId: "wrong-match" },
      { hostPeerId: "wrong-host" },
      { guestPeerId: "wrong-guest" },
      { intent: "resume" },
    ];

    for (const mismatch of mismatches) {
      await expect(harness.session.acceptAnswer(encodeAnswer(offer, mismatch))).rejects
        .toMatchObject({ code: "identity-mismatch" });
    }
    expect(harness.pc.calls.filter((call) => call.startsWith("setRemote"))).toEqual([]);

    await harness.session.acceptAnswer(encodeAnswer(offer));
    expect(harness.pc.calls.at(-1)).toBe("setRemote:answer");
  });

  it("does not start connection timeout while people are manually sharing offer and answer text", async () => {
    const host = makeHarness();
    const { offer } = await createHostOffer(host);
    host.timers.advance(2_000);
    expect(host.session.getSnapshot().phase).toBe("waiting-answer");

    await host.session.acceptAnswer(encodeAnswer(offer));
    expect(host.session.getSnapshot().phase).toBe("connecting");

    const guest = makeHarness(guestIdentity);
    const encodedOffer = encodeSignalingMessageV1({
      ...offer,
      hostPeerId: guestIdentity.remotePeerId,
    });
    if (!encodedOffer.ok) throw new Error(encodedOffer.error.code);
    const pendingAnswer = guest.session.acceptOffer(encodedOffer.value);
    await flushMicrotasks();
    guest.pc.completeIce();
    await pendingAnswer;
    guest.timers.advance(2_000);
    expect(guest.session.getSnapshot().phase).toBe("answer-ready");

    guest.pc.setConnectionState("connecting");
    expect(guest.session.getSnapshot().phase).toBe("connecting");
  });

  it("binds the answerer peer id when the host did not know it before creating the offer", async () => {
    const identity: PeerSessionOptions["identity"] = {
      role: hostIdentity.role,
      sessionId: hostIdentity.sessionId,
      pairingId: hostIdentity.pairingId,
      matchId: hostIdentity.matchId,
      localPeerId: hostIdentity.localPeerId,
      intent: hostIdentity.intent,
    };
    const harness = makeHarness(identity);
    const { offer } = await createHostOffer(harness);

    await expect(harness.session.acceptAnswer(encodeAnswer(offer))).resolves.toBeUndefined();
    expect(harness.session.getRemotePeerId()).toBe("peer-guest");
  });

  it("fails and invalidates late ICE events when gathering times out", async () => {
    const harness = makeHarness();
    const pending = harness.session.createOffer();
    await flushMicrotasks();

    harness.timers.advance(1_000);
    await expect(pending).rejects.toBeInstanceOf(PeerSessionError);
    expect(harness.session.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: "gather-timeout",
    });
    expect(harness.pc.closeCalls).toBe(1);

    harness.pc.completeIce();
    harness.pc.channel.open();
    expect(harness.session.getSnapshot().phase).toBe("failed");
  });

  it("rejects pending gathering and ignores its late events after disposal", async () => {
    const harness = makeHarness();
    const pending = harness.session.createOffer();
    await flushMicrotasks();

    harness.session.dispose();
    await expect(pending).rejects.toMatchObject({ code: "invalid-state" });
    harness.pc.completeIce();
    harness.pc.channel.open();

    expect(harness.session.getSnapshot().phase).toBe("closed");
    expect(harness.pc.listenerCount()).toBe(0);
    expect(harness.pc.channel.listenerCount()).toBe(0);
  });

  it("fails and releases resources when connection establishment times out", async () => {
    const harness = makeHarness();
    const { offer } = await createHostOffer(harness);
    await harness.session.acceptAnswer(encodeAnswer(offer));

    harness.timers.advance(2_000);
    expect(harness.session.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: "connect-timeout",
    });
    expect(harness.pc.channel.closeCalls).toBe(1);
    expect(harness.pc.closeCalls).toBe(1);
    expect(harness.timers.size()).toBe(0);
  });

  it("enters disconnected grace, recovers, then fails if a later grace period expires", async () => {
    const harness = makeHarness();
    await createHostOffer(harness);
    harness.pc.channel.open();

    harness.pc.setConnectionState("disconnected");
    expect(harness.session.getSnapshot().phase).toBe("disconnected-grace");
    harness.timers.advance(499);
    harness.pc.setConnectionState("connected");
    expect(harness.session.getSnapshot().phase).toBe("open");

    harness.pc.setConnectionState("disconnected");
    harness.timers.advance(500);
    expect(harness.session.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: "disconnect-timeout",
    });
    harness.pc.setConnectionState("connected");
    expect(harness.session.getSnapshot().phase).toBe("failed");
  });

  it("fails immediately on a failed peer connection", async () => {
    const harness = makeHarness();
    await createHostOffer(harness);
    harness.pc.setConnectionState("failed");
    expect(harness.session.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: "connection-failed",
    });
    expect(harness.pc.closeCalls).toBe(1);
  });

  it("publishes the terminal snapshot before idempotently closing every resource", async () => {
    const harness = makeHarness();
    await createHostOffer(harness);
    harness.pc.channel.open();
    harness.pc.channel.bufferedAmount = 65;
    expect(harness.session.send("queued")).toEqual({ ok: true, queued: true });
    const observedAtClose: string[] = [];
    harness.pc.channel.onClose = () => observedAtClose.push(harness.session.getSnapshot().phase);
    harness.pc.onClose = () => observedAtClose.push(harness.session.getSnapshot().phase);

    harness.session.dispose();
    harness.session.close();
    harness.session.dispose();

    expect(observedAtClose).toEqual(["closed", "closed"]);
    expect(harness.pc.channel.closeCalls).toBe(1);
    expect(harness.pc.closeCalls).toBe(1);
    expect(harness.pc.listenerCount()).toBe(0);
    expect(harness.pc.channel.listenerCount()).toBe(0);
    expect(harness.timers.size()).toBe(0);
    expect(harness.session.getSnapshot()).toMatchObject({ queuedFrames: 0, queuedBytes: 0 });
    expect(harness.session.send("late")).toEqual({ ok: false, reason: "not-open" });
  });
});

describe("PeerSession frame safety and backpressure", () => {
  it("queues without loss, drains in order on bufferedamountlow, and reports queue overflow", async () => {
    const harness = makeHarness();
    await createHostOffer(harness);
    harness.pc.channel.open();
    harness.pc.channel.bufferedAmount = 65;

    for (let index = 0; index < 32; index += 1) {
      expect(harness.session.send(`f${index}`)).toEqual({ ok: true, queued: true });
    }
    expect(harness.session.getSnapshot()).toMatchObject({ queuedFrames: 32 });
    expect(harness.session.send("overflow")).toEqual({ ok: false, reason: "queue-full" });

    harness.pc.channel.bufferedAmount = 0;
    harness.pc.channel.emit("bufferedamountlow");
    expect(harness.pc.channel.sent).toEqual(Array.from({ length: 32 }, (_, index) => `f${index}`));
    expect(harness.session.getSnapshot()).toMatchObject({ queuedFrames: 0, queuedBytes: 0 });
  });

  it("enforces the 64 KiB queue budget and negotiated SCTP message size", async () => {
    const harness = makeHarness();
    await createHostOffer(harness);
    harness.pc.channel.open();
    harness.pc.channel.bufferedAmount = 65;

    const fullFrame = "x".repeat(16_384);
    for (let index = 0; index < 4; index += 1) {
      expect(harness.session.send(fullFrame)).toEqual({ ok: true, queued: true });
    }
    expect(harness.session.send("x")).toEqual({ ok: false, reason: "queue-full" });

    harness.pc.sctp.maxMessageSize = 3;
    harness.pc.channel.bufferedAmount = 0;
    expect(harness.session.send("four")).toEqual({ ok: false, reason: "message-too-large" });
  });

  it("drops binary, oversized, and rate-limited inbound data before onFrame", async () => {
    const harness = makeHarness();
    await createHostOffer(harness);
    harness.pc.channel.open();

    harness.pc.channel.message(new Uint8Array([1]));
    harness.pc.channel.message("棋".repeat(5_462));
    harness.pc.channel.message("one");
    harness.pc.channel.message("two");
    harness.pc.channel.message("three");

    expect(harness.frames).toEqual(["one", "two"]);
    expect(harness.rejected).toEqual(["binary", "message-too-large", "rate-limit"]);

    harness.setNow(1_101);
    harness.pc.channel.message("after-window");
    expect(harness.frames).toEqual(["one", "two", "after-window"]);
  });
});
