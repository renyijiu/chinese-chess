import { describe, expect, it, vi } from "vitest";

import {
  OnlineMatchSession,
  type OnlineMatchSessionOptions,
} from "../../../components/xiangqi/online/OnlineMatchSession";
import type { PeerConnectionPort } from "../../../components/xiangqi/online/PeerSession";
import {
  createInitialGame,
  dispatch,
  sha256Hex,
  type GameState,
} from "../../../lib/xiangqi/index";
import {
  decodeOnlineMessageV1,
  type OnlineMessageV1,
} from "../../../lib/xiangqi/online/index";

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
  readonly #listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener !== "function") return;
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === "function") this.#listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event = { type } as Event): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(): number {
    return [...this.#listeners.values()]
      .reduce((total, listeners) => total + listeners.size, 0);
  }
}

class LinkedDataChannel extends FakeEventTarget {
  readonly label = "xiangqi-v1";
  readonly ordered = true;
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readonly sent: string[] = [];
  peer: LinkedDataChannel | null = null;
  closeCalls = 0;

  send(frame: string): void {
    this.sent.push(frame);
    this.peer?.message(frame);
  }

  close(): void {
    this.closeCalls += 1;
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
  readonly channel: LinkedDataChannel;
  closeCalls = 0;

  constructor(channel: LinkedDataChannel) {
    super();
    this.channel = channel;
  }

  createDataChannel(): LinkedDataChannel {
    return this.channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: APPLICATION_SDP };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: APPLICATION_SDP };
  }

  async setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
    this.iceGatheringState = "gathering";
  }

  async setRemoteDescription(): Promise<void> {}

  completeIce(): void {
    const type = this.localDescription?.type ?? "offer";
    const sdp = `${APPLICATION_SDP}a=candidate:final\r\n`;
    this.localDescription = { type, sdp, toJSON: () => ({ type, sdp }) } as RTCSessionDescription;
    this.iceGatheringState = "complete";
    this.emit("icegatheringstatechange");
  }

  receiveDataChannel(): void {
    this.emit("datachannel", {
      type: "datachannel",
      channel: this.channel,
    } as unknown as RTCDataChannelEvent);
  }

  close(): void {
    this.closeCalls += 1;
    this.connectionState = "closed";
  }
}

interface SessionHarness {
  readonly session: OnlineMatchSession;
  readonly peerConnection: FakePeerConnection;
  readonly channel: LinkedDataChannel;
  readonly bindMatch: ReturnType<typeof vi.fn>;
  getGame(): GameState;
}

function createSessionHarness(
  identity: OnlineMatchSessionOptions["identity"],
  bindResult = true,
): SessionHarness {
  const channel = new LinkedDataChannel();
  const peerConnection = new FakePeerConnection(channel);
  let game = createInitialGame();
  let id = 0;
  const bindMatch = vi.fn(async () => bindResult);
  const session = new OnlineMatchSession({
    identity,
    peerConnectionFactory: () => peerConnection,
    getGame: () => game,
    bindMatch,
    commitCommand: async (command) => {
      const result = dispatch(game, command);
      if (result.error) return { status: "rejected" };
      game = result.state;
      return { status: "committed" };
    },
    installRecoveredGame: async (recovered) => {
      game = recovered;
      return true;
    },
    digest: sha256Hex,
    createId: () => `id-${++id}`,
  });
  return { session, peerConnection, channel, bindMatch, getGame: () => game };
}

function createPair(): { host: SessionHarness; guest: SessionHarness } {
  const host = createSessionHarness({
    role: "host",
    sessionId: "session-1",
    pairingId: "pairing-1",
    matchId: "match-1",
    localPeerId: "peer-host",
    intent: "new",
  });
  const guest = createSessionHarness({
    role: "guest",
    sessionId: "session-1",
    pairingId: "pairing-1",
    matchId: "match-1",
    localPeerId: "peer-guest",
    intent: "new",
  });
  host.channel.peer = guest.channel;
  guest.channel.peer = host.channel;
  return { host, guest };
}

async function flushMicrotasks(): Promise<void> {
  for (let count = 0; count < 8; count += 1) await Promise.resolve();
}

async function exchangeSignals(host: SessionHarness, guest: SessionHarness): Promise<void> {
  const pendingOffer = host.session.createOffer();
  await flushMicrotasks();
  host.peerConnection.completeIce();
  const offer = await pendingOffer;

  const pendingAnswer = guest.session.acceptOffer(offer);
  await flushMicrotasks();
  guest.peerConnection.completeIce();
  const answer = await pendingAnswer;
  await host.session.acceptAnswer(answer);
}

function messages(channel: LinkedDataChannel): OnlineMessageV1[] {
  return channel.sent.map((frame) => {
    const decoded = decodeOnlineMessageV1(frame);
    if (!decoded.ok) throw new Error(decoded.error.code);
    return decoded.value;
  });
}

describe("OnlineMatchSession", () => {
  it("binds peer ids from manual signaling and assigns the initial host and guest sides", async () => {
    const { host, guest } = createPair();
    try {
      await exchangeSignals(host, guest);

      expect(host.bindMatch).toHaveBeenCalledWith(expect.objectContaining({
        localPeerId: "peer-host",
        remotePeerId: "peer-guest",
        signalingRole: "host",
        localSide: "red",
      }));
      expect(guest.bindMatch).toHaveBeenCalledWith(expect.objectContaining({
        localPeerId: "peer-guest",
        remotePeerId: "peer-host",
        signalingRole: "guest",
        localSide: "black",
      }));
      expect(host.session.getSnapshot().identity).toMatchObject({
        remotePeerId: "peer-guest",
        localSide: "red",
      });
      expect(guest.session.getSnapshot().identity).toMatchObject({
        remotePeerId: "peer-host",
        localSide: "black",
      });
    } finally {
      host.session.dispose();
      guest.session.dispose();
    }
  });

  it("starts hello on DataChannel open and becomes playable only after both ready messages", async () => {
    const { host, guest } = createPair();
    try {
      await exchangeSignals(host, guest);
      guest.peerConnection.receiveDataChannel();
      host.channel.open();
      guest.channel.open();

      await expect.poll(() => [
        host.session.getSnapshot().coordinator?.phase,
        guest.session.getSnapshot().coordinator?.phase,
      ]).toEqual(["awaiting-ready", "awaiting-ready"]);
      expect(messages(host.channel).filter((message) => message.type === "hello")).toHaveLength(1);
      expect(messages(guest.channel).filter((message) => message.type === "hello")).toHaveLength(1);

      await expect(host.session.setLocalReady()).resolves.toEqual({ ok: true });
      await expect(guest.session.setLocalReady()).resolves.toEqual({ ok: true });
      await expect.poll(() => [
        host.session.getSnapshot().coordinator?.phase,
        guest.session.getSnapshot().coordinator?.phase,
      ]).toEqual(["playable", "playable"]);
      expect(messages(host.channel).filter((message) => message.type === "ready")).toHaveLength(1);
      expect(messages(guest.channel).filter((message) => message.type === "ready")).toHaveLength(1);
    } finally {
      host.session.dispose();
      guest.session.dispose();
    }
  });

  it("queues a hello that arrives after match binding but before the local channel opens", async () => {
    const { host, guest } = createPair();
    try {
      await exchangeSignals(host, guest);
      guest.peerConnection.receiveDataChannel();

      guest.channel.open();
      await expect.poll(() => messages(guest.channel).some((message) => message.type === "hello"))
        .toBe(true);
      expect(host.session.getSnapshot().coordinator?.phase).toBe("idle");
      expect(host.session.getSnapshot().error).toBeNull();

      host.channel.open();
      await expect.poll(() => [
        host.session.getSnapshot().coordinator?.phase,
        guest.session.getSnapshot().coordinator?.phase,
      ]).toEqual(["awaiting-ready", "awaiting-ready"]);
      expect(host.session.getSnapshot().error).toBeNull();
      expect(messages(host.channel).filter((message) => message.type === "hello")).toHaveLength(1);
    } finally {
      host.session.dispose();
      guest.session.dispose();
    }
  });

  it("surfaces bindMatch failure without constructing or exposing a coordinator", async () => {
    const guest = createSessionHarness({
      role: "guest",
      sessionId: "session-1",
      pairingId: "pairing-1",
      matchId: "match-1",
      localPeerId: "peer-guest",
      intent: "new",
    }, false);
    const host = createSessionHarness({
      role: "host",
      sessionId: "session-1",
      pairingId: "pairing-1",
      matchId: "match-1",
      localPeerId: "peer-host",
      intent: "new",
    });
    try {
      const pendingOffer = host.session.createOffer();
      await flushMicrotasks();
      host.peerConnection.completeIce();
      const offer = await pendingOffer;

      const pendingAnswer = guest.session.acceptOffer(offer);
      await flushMicrotasks();
      guest.peerConnection.completeIce();
      await expect(pendingAnswer).rejects.toThrow("match-bind-failed");

      expect(guest.bindMatch).toHaveBeenCalledOnce();
      expect(guest.session.getSnapshot()).toMatchObject({
        coordinator: null,
        identity: null,
        error: "match-bind-failed",
      });
    } finally {
      host.session.dispose();
      guest.session.dispose();
    }
  });

  it("disposes once and ignores gathering, channel, and frame events that arrive later", async () => {
    const host = createSessionHarness({
      role: "host",
      sessionId: "session-1",
      pairingId: "pairing-1",
      matchId: "match-1",
      localPeerId: "peer-host",
      intent: "new",
    });
    const observed: unknown[] = [];
    host.session.subscribe((snapshot) => observed.push(snapshot));
    const pendingOffer = host.session.createOffer();
    await flushMicrotasks();
    const snapshotAtDispose = host.session.getSnapshot();
    const observationsAtDispose = observed.length;

    host.session.dispose();
    host.session.dispose();
    await expect(pendingOffer).rejects.toThrow("invalid-state");
    host.peerConnection.completeIce();
    host.channel.open();
    host.channel.message("late-frame");
    await flushMicrotasks();

    expect(host.session.getSnapshot()).toBe(snapshotAtDispose);
    expect(observed).toHaveLength(observationsAtDispose);
    expect(host.channel.closeCalls).toBe(1);
    expect(host.peerConnection.closeCalls).toBe(1);
    expect(host.channel.listenerCount()).toBe(0);
    expect(host.peerConnection.listenerCount()).toBe(0);
    expect(host.bindMatch).not.toHaveBeenCalled();
  });
});
