import { describe, expect, it } from "vitest";

import {
  OnlineMatchCoordinator,
  type OnlineCommitContext,
  type OnlineMatchCoordinatorOptions,
} from "../../../components/xiangqi/online/OnlineMatchCoordinator";
import {
  createInitialGame,
  dispatch,
  serializeGame,
  sha256Hex,
  type GameCommand,
  type GameState,
  type MoveCommand,
} from "../../../lib/xiangqi/index";
import {
  ONLINE_PROTOCOL_VERSION,
  decodeOnlineMessageV1,
  encodeOnlineMessageV1,
  type OnlineMessageTypeV1,
  type OnlineMessageV1,
} from "../../../lib/xiangqi/online/index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const RED_MOVE: MoveCommand = {
  type: "move",
  expectedRevision: 0,
  from: { file: 0, rank: 3 },
  to: { file: 0, rank: 4 },
};

const BLACK_MOVE: MoveCommand = {
  type: "move",
  expectedRevision: 1,
  from: { file: 0, rank: 6 },
  to: { file: 0, rank: 5 },
};

function apply(state: GameState, command: GameCommand): GameState {
  const result = dispatch(state, command);
  if (result.error) throw new Error(result.error.code);
  return result.state;
}

function messages(frames: ReadonlyArray<string>): OnlineMessageV1[] {
  return frames.map((frame) => {
    const decoded = decodeOnlineMessageV1(frame);
    if (!decoded.ok) throw new Error(decoded.error.code);
    return decoded.value;
  });
}

interface EndpointOptions {
  readonly role: "host" | "guest";
  readonly side: "red" | "black";
  readonly peerId: string;
  readonly remotePeerId: string;
  readonly game?: GameState;
  readonly intent?: "new" | "resume";
  readonly digest?: (serialized: string) => string | Promise<string>;
}

class Endpoint {
  readonly sent: string[] = [];
  readonly commitCalls: Array<Readonly<{ command: GameCommand; context: OnlineCommitContext }>> = [];
  readonly installCalls: GameState[] = [];
  readonly blockedTypes = new Set<OnlineMessageTypeV1>();
  readonly deliveries = new Set<Promise<void>>();
  readonly coordinator: OnlineMatchCoordinator;
  peer: Endpoint | null = null;
  game: GameState;
  sendFailure = false;
  commitStatus: "committed" | "rejected" | "superseded" = "committed";
  installResult = true;
  commitWait: Promise<void> | null = null;

  constructor(options: EndpointOptions) {
    this.game = options.game ?? createInitialGame();
    const coordinatorOptions: OnlineMatchCoordinatorOptions = {
      identity: {
        pairingId: "pairing-1",
        sessionId: "session-1",
        matchId: "match-1",
        localPeerId: options.peerId,
        remotePeerId: options.remotePeerId,
        signalingRole: options.role,
        localSide: options.side,
        intent: options.intent ?? "new",
      },
      send: (frame) => {
        if (this.sendFailure) return { ok: false, reason: "send-error" };
        this.sent.push(frame);
        const decoded = decodeOnlineMessageV1(frame);
        const peer = this.peer;
        if (peer && decoded.ok && !this.blockedTypes.has(decoded.value.type)) {
          const delivery = peer.coordinator.handleFrame(frame);
          this.deliveries.add(delivery);
          void delivery.then(
            () => this.deliveries.delete(delivery),
            () => this.deliveries.delete(delivery),
          );
        }
        return { ok: true };
      },
      getGame: () => this.game,
      commitCommand: async (command, context) => {
        this.commitCalls.push({ command, context });
        await this.commitWait;
        if (this.commitStatus !== "committed") return { status: this.commitStatus };
        const result = dispatch(this.game, command);
        if (result.error) return { status: "rejected" };
        this.game = result.state;
        return { status: "committed" };
      },
      installRecoveredGame: async (game) => {
        this.installCalls.push(game);
        if (this.installResult) this.game = game;
        return this.installResult;
      },
      digest: options.digest ?? sha256Hex,
      createId: (() => {
        let value = 0;
        return () => `${options.peerId}-${++value}`;
      })(),
      timers: {
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    };
    this.coordinator = new OnlineMatchCoordinator(coordinatorOptions);
  }

  connect(peer: Endpoint): void {
    this.peer = peer;
  }
}

function pair(input: Readonly<{
  hostGame?: GameState;
  guestGame?: GameState;
  intent?: "new" | "resume";
}> = {}) {
  const host = new Endpoint({
    role: "host",
    side: "red",
    peerId: "peer-host",
    remotePeerId: "peer-guest",
    game: input.hostGame,
    intent: input.intent,
  });
  const guest = new Endpoint({
    role: "guest",
    side: "black",
    peerId: "peer-guest",
    remotePeerId: "peer-host",
    game: input.guestGame,
    intent: input.intent,
  });
  host.connect(guest);
  guest.connect(host);
  return { host, guest };
}

async function settle(...endpoints: ReadonlyArray<Endpoint>): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    await Promise.all([
      ...endpoints.map((endpoint) => endpoint.coordinator.whenIdle()),
      ...endpoints.flatMap((endpoint) => [...endpoint.deliveries]),
    ]);
    await Promise.resolve();
    if (endpoints.every((endpoint) => endpoint.deliveries.size === 0)) return;
  }
  throw new Error("coordinator transport did not settle");
}

async function startPair(host: Endpoint, guest: Endpoint): Promise<void> {
  await Promise.all([host.coordinator.start(), guest.coordinator.start()]);
  await settle(host, guest);
}

async function readyPair(host: Endpoint, guest: Endpoint): Promise<void> {
  await Promise.all([host.coordinator.setLocalReady(), guest.coordinator.setLocalReady()]);
  await settle(host, guest);
}

function encode(message: OnlineMessageV1): string {
  const encoded = encodeOnlineMessageV1(message);
  if (!encoded.ok) throw new Error(encoded.error.code);
  return encoded.value;
}

function remoteIdentity(endpoint: Endpoint, seq: number) {
  const first = messages(endpoint.sent)[0];
  return {
    v: ONLINE_PROTOCOL_VERSION,
    pairingId: first.pairingId,
    sessionId: first.sessionId,
    matchId: first.matchId,
    senderPeerId: first.senderPeerId,
    seq,
  } as const;
}

describe("OnlineMatchCoordinator", () => {
  it("handshakes, becomes playable only after both ready, and commits one move per side", async () => {
    const { host, guest } = pair();

    await startPair(host, guest);
    expect(messages(host.sent)[0]).toMatchObject({
      type: "hello",
      seq: 1,
      side: "red",
      features: ["snapshot-v1"],
    });
    expect(messages(guest.sent)[0]).toMatchObject({ type: "hello", seq: 1, side: "black" });
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "awaiting-ready",
      localReady: false,
      remoteReady: false,
      revision: 0,
    });

    await host.coordinator.setLocalReady();
    await settle(host, guest);
    expect(host.coordinator.getSnapshot().phase).toBe("awaiting-ready");
    expect(guest.coordinator.getSnapshot()).toMatchObject({ remoteReady: true });
    await guest.coordinator.setLocalReady();
    await settle(host, guest);
    expect(host.coordinator.getSnapshot().phase).toBe("playable");
    expect(guest.coordinator.getSnapshot().phase).toBe("playable");

    await expect(host.coordinator.submitLocalMove(RED_MOVE)).resolves.toEqual({ ok: true });
    await settle(host, guest);
    expect(host.game.revision).toBe(1);
    expect(guest.game).toEqual(host.game);
    expect(host.coordinator.getSnapshot()).toMatchObject({ phase: "playable", pending: null });
    expect(host.coordinator.getSnapshot().hash).toBe(guest.coordinator.getSnapshot().hash);

    await expect(guest.coordinator.submitLocalMove(BLACK_MOVE)).resolves.toEqual({ ok: true });
    await settle(host, guest);
    expect(host.game.revision).toBe(2);
    expect(guest.game).toEqual(host.game);
    expect(host.coordinator.getSnapshot().hash).toBe(guest.coordinator.getSnapshot().hash);
    expect(host.commitCalls).toHaveLength(2);
    expect(guest.commitCalls).toHaveLength(2);
    expect(host.commitCalls.map((call) => call.context.origin)).toEqual(["local", "remote"]);
    expect(guest.commitCalls.map((call) => call.context.origin)).toEqual(["remote", "local"]);
  });

  it("rejects local moves outside the playable local turn without dispatching or sending", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    const beforeFrames = guest.sent.length;

    await expect(guest.coordinator.submitLocalMove({ ...RED_MOVE }))
      .resolves.toEqual({ ok: false, reason: "not-local-turn" });
    expect(guest.commitCalls).toHaveLength(0);
    expect(guest.sent).toHaveLength(beforeFrames);

    await host.coordinator.submitLocalMove(RED_MOVE);
    await settle(host, guest);
    await expect(host.coordinator.submitLocalMove({ ...BLACK_MOVE }))
      .resolves.toEqual({ ok: false, reason: "not-local-turn" });
  });

  it("rejects a remote command that claims the local actor side before committing it", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    const beforeHash = host.coordinator.getSnapshot().hash;
    if (!beforeHash) throw new Error("missing hash");
    const afterHash = await sha256Hex(serializeGame(apply(host.game, RED_MOVE)));
    const nextGuestSeq = Math.max(...messages(guest.sent).map((message) => message.seq)) + 1;

    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, nextGuestSeq),
      type: "command",
      commandId: "wrong-actor",
      actorSide: "red",
      expectedRevision: 0,
      beforeHash,
      command: { type: "move", from: RED_MOVE.from, to: RED_MOVE.to },
      afterRevision: 1,
      afterHash,
    }));

    expect(host.commitCalls).toHaveLength(0);
    expect(host.game.revision).toBe(0);
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "invalid-command" },
    });
  });

  it("persists a remote command once and resends its cached ack for a duplicate frame", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    await host.coordinator.submitLocalMove(RED_MOVE);
    await settle(host, guest);

    const commandFrame = host.sent.find((frame) => {
      const decoded = decodeOnlineMessageV1(frame);
      return decoded.ok && decoded.value.type === "command";
    });
    if (!commandFrame) throw new Error("missing command frame");
    const ackCount = messages(guest.sent).filter((message) => message.type === "ack").length;

    await guest.coordinator.handleFrame(commandFrame);
    await settle(host, guest);
    expect(guest.commitCalls).toHaveLength(1);
    expect(messages(guest.sent).filter((message) => message.type === "ack")).toHaveLength(ackCount + 1);
    expect(host.coordinator.getSnapshot().phase).toBe("playable");
  });

  it("locks on sequence gaps and ack mismatches and emits a typed error when transport permits", async () => {
    const first = pair();
    await startPair(first.host, first.guest);
    const lastGuestSeq = Math.max(...messages(first.guest.sent).map((message) => message.seq));
    const gameHash = first.host.coordinator.getSnapshot().hash;
    if (!gameHash) throw new Error("missing hash");

    await first.host.coordinator.handleFrame(encode({
      ...remoteIdentity(first.guest, lastGuestSeq + 2),
      type: "ping",
      nonce: "gap",
      revision: 0,
      positionHash: gameHash,
    }));
    expect(first.host.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "sequence-gap" },
    });
    expect(messages(first.host.sent).at(-1)).toMatchObject({
      type: "error",
      code: "sequence-gap",
      fatal: true,
    });

    const second = pair();
    await startPair(second.host, second.guest);
    await readyPair(second.host, second.guest);
    second.guest.blockedTypes.add("ack");
    await second.host.coordinator.submitLocalMove(RED_MOVE);
    await settle(second.host, second.guest);
    expect(second.host.coordinator.getSnapshot().phase).toBe("awaiting-ack");
    const realAck = messages(second.guest.sent).find((message) => message.type === "ack");
    if (!realAck || realAck.type !== "ack") throw new Error("missing ack");
    await second.host.coordinator.handleFrame(encode({ ...realAck, ackedMessageId: "wrong" }));
    expect(second.host.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "protocol-violation" },
    });
  });

  it("strictly rejects malformed, versioned, and cross-identity frames", async () => {
    const malformed = pair();
    await malformed.host.coordinator.start();
    await malformed.host.coordinator.handleFrame("not-json");
    expect(malformed.host.coordinator.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "invalid-message" },
    });

    const versioned = pair();
    await versioned.host.coordinator.start();
    await versioned.host.coordinator.handleFrame(JSON.stringify({ v: 2 }));
    expect(versioned.host.coordinator.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "unsupported-version" },
    });

    const foreign = pair();
    await foreign.host.coordinator.start();
    const initialHash = foreign.host.coordinator.getSnapshot().hash;
    if (!initialHash) throw new Error("missing hash");
    await foreign.host.coordinator.handleFrame(encode({
      v: ONLINE_PROTOCOL_VERSION,
      type: "hello",
      pairingId: "foreign-pairing",
      sessionId: "session-1",
      matchId: "match-1",
      senderPeerId: "peer-guest",
      seq: 1,
      intent: "new",
      signalingRole: "guest",
      side: "black",
      gameSchemaVersion: 1,
      ruleset: "popular-v1",
      revision: 0,
      positionHash: initialHash,
      features: ["snapshot-v1"],
    }));
    expect(foreign.host.coordinator.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "identity-mismatch" },
    });
  });

  it("fast-forwards only a strict command-log prefix and re-handshakes on the recovered game", async () => {
    const afterRed = apply(createInitialGame(), RED_MOVE);
    const afterBlack = apply(afterRed, BLACK_MOVE);
    const { host, guest } = pair({ hostGame: afterBlack, guestGame: afterRed, intent: "resume" });

    await startPair(host, guest);
    expect(guest.installCalls).toHaveLength(1);
    expect(guest.game).toEqual(afterBlack);
    expect(guest.coordinator.getSnapshot()).toMatchObject({
      phase: "awaiting-ready",
      revision: 2,
    });
    expect(messages(guest.sent).filter((message) => message.type === "snapshot-request"))
      .toHaveLength(1);
    expect(messages(host.sent).filter((message) => message.type === "snapshot")).toHaveLength(1);
    expect(messages(guest.sent).filter((message) => message.type === "hello")).toHaveLength(2);

    await readyPair(host, guest);
    expect(host.coordinator.getSnapshot().phase).toBe("playable");
    expect(guest.coordinator.getSnapshot().hash).toBe(host.coordinator.getSnapshot().hash);
  });

  it("locks mismatched revisions when the peer did not advertise snapshot recovery", async () => {
    const afterRed = apply(createInitialGame(), RED_MOVE);
    const host = new Endpoint({
      role: "host",
      side: "red",
      peerId: "peer-host",
      remotePeerId: "peer-guest",
      game: afterRed,
      intent: "resume",
    });
    await host.coordinator.start();
    const initialHash = await sha256Hex(serializeGame(createInitialGame()));

    await host.coordinator.handleFrame(encode({
      v: ONLINE_PROTOCOL_VERSION,
      type: "hello",
      pairingId: "pairing-1",
      sessionId: "session-1",
      matchId: "match-1",
      senderPeerId: "peer-guest",
      seq: 1,
      intent: "resume",
      signalingRole: "guest",
      side: "black",
      gameSchemaVersion: 1,
      ruleset: "popular-v1",
      revision: 0,
      positionHash: initialHash,
      features: [],
    }));

    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "recovery-conflict", fatal: true },
    });
    expect(messages(host.sent).filter((message) => message.type === "snapshot")).toHaveLength(0);
  });

  it("refuses equal-revision hash divergence and divergent snapshot histories", async () => {
    const localBranch = apply(createInitialGame(), {
      ...RED_MOVE,
      from: { file: 2, rank: 3 },
      to: { file: 2, rank: 4 },
    });
    const remoteFirst = apply(createInitialGame(), RED_MOVE);
    const remoteAhead = apply(remoteFirst, BLACK_MOVE);

    const equalRevision = pair({ hostGame: remoteFirst, guestGame: localBranch, intent: "resume" });
    await startPair(equalRevision.host, equalRevision.guest);
    expect(equalRevision.host.coordinator.getSnapshot().phase).toBe("repair-required");
    expect(equalRevision.guest.coordinator.getSnapshot().phase).toBe("repair-required");

    const divergent = pair({ hostGame: remoteAhead, guestGame: localBranch, intent: "resume" });
    await startPair(divergent.host, divergent.guest);
    expect(divergent.guest.installCalls).toHaveLength(0);
    expect(divergent.guest.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "recovery-conflict" },
    });
  });

  it("handles send, commit, install, and digest failures without leaking commands", async () => {
    const failedSend = new Endpoint({
      role: "host",
      side: "red",
      peerId: "peer-host",
      remotePeerId: "peer-guest",
    });
    failedSend.sendFailure = true;
    await expect(failedSend.coordinator.start()).resolves.toEqual({ ok: false, reason: "send-failed" });
    expect(failedSend.coordinator.getSnapshot().phase).toBe("failed");

    const commit = pair();
    await startPair(commit.host, commit.guest);
    await readyPair(commit.host, commit.guest);
    commit.host.commitStatus = "rejected";
    await expect(commit.host.coordinator.submitLocalMove(RED_MOVE))
      .resolves.toEqual({ ok: false, reason: "commit-failed" });
    expect(commit.host.coordinator.getSnapshot().phase).toBe("failed");
    expect(messages(commit.host.sent).some((message) => message.type === "command")).toBe(false);
    expect(commit.guest.game.revision).toBe(0);

    const afterRed = apply(createInitialGame(), RED_MOVE);
    const recovery = pair({ hostGame: afterRed, guestGame: createInitialGame(), intent: "resume" });
    recovery.guest.installResult = false;
    await startPair(recovery.host, recovery.guest);
    expect(recovery.guest.coordinator.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "internal-error" },
    });

    const digestFailure = new Endpoint({
      role: "host",
      side: "red",
      peerId: "peer-host",
      remotePeerId: "peer-guest",
      digest: async () => { throw new Error("digest unavailable"); },
    });
    await digestFailure.coordinator.start();
    expect(digestFailure.coordinator.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "internal-error" },
    });
  });

  it("answers ping from the current game and safely rejects out-of-phase resign/rematch", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    const guestNextSeq = Math.max(...messages(guest.sent).map((message) => message.seq)) + 1;
    const hash = host.coordinator.getSnapshot().hash;
    if (!hash) throw new Error("missing hash");
    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, guestNextSeq),
      type: "ping",
      nonce: "ping-1",
      revision: 0,
      positionHash: hash,
    }));
    expect(messages(host.sent).at(-1)).toMatchObject({
      type: "pong",
      nonce: "ping-1",
      revision: 0,
      positionHash: hash,
    });

    const before = serializeGame(host.game);
    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, guestNextSeq + 1),
      type: "resign",
      commandId: "resign-1",
      resigningSide: "black",
      expectedRevision: 0,
      beforeHash: hash,
      afterRevision: 1,
      afterHash: "f".repeat(64),
    }));
    expect(serializeGame(host.game)).toBe(before);
    expect(messages(host.sent).at(-1)).toMatchObject({
      type: "error",
      code: "protocol-violation",
      fatal: false,
    });

    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, guestNextSeq + 2),
      type: "rematch",
      action: "request",
      proposalId: "proposal-1",
      nextMatchId: "match-2",
      nextRematchIndex: 1,
      hostSide: "black",
      terminalRevision: 0,
      terminalHash: hash,
    }));
    expect(serializeGame(host.game)).toBe(before);
    expect(messages(host.sent).at(-1)).toMatchObject({
      type: "error",
      code: "protocol-violation",
      fatal: false,
    });
  });

  it("drops late commit work after dispose and never sends its command", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    const gate = deferred<void>();
    host.commitWait = gate.promise;

    const pending = host.coordinator.submitLocalMove(RED_MOVE);
    await expect.poll(() => host.commitCalls.length).toBe(1);
    host.coordinator.dispose();
    gate.resolve();

    await expect(pending).resolves.toEqual({ ok: false, reason: "disposed" });
    await settle(host, guest);
    expect(host.coordinator.getSnapshot().phase).toBe("disposed");
    expect(messages(host.sent).some((message) => message.type === "command")).toBe(false);
    expect(guest.game.revision).toBe(0);
  });
});
