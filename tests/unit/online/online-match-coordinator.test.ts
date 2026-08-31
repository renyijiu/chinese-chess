import { describe, expect, it } from "vitest";

import {
  OnlineMatchCoordinator,
  type OnlineCommitContext,
  type OnlineMatchCoordinatorOptions,
  type OnlineMatchCoordinatorTimers,
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
  readonly game?: GameState | undefined;
  readonly intent?: "new" | "resume" | undefined;
  readonly digest?: ((serialized: string) => string | Promise<string>) | undefined;
  readonly timers?: OnlineMatchCoordinatorOptions["timers"] | undefined;
  readonly ackTimeoutMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly pongTimeoutMs?: number | undefined;
}

class ManualTimers implements OnlineMatchCoordinatorTimers {
  #now = 0;
  #nextId = 1;
  readonly #tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.#now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#tasks.delete(handle as number);
  }

  advance(delayMs: number): void {
    const target = this.#now + delayMs;
    while (true) {
      const due = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) break;
      this.#tasks.delete(due[0]);
      this.#now = due[1].at;
      due[1].callback();
    }
    this.#now = target;
  }
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
      timers: options.timers ?? {
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      ackTimeoutMs: options.ackTimeoutMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      pongTimeoutMs: options.pongTimeoutMs,
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
  hostTimers?: OnlineMatchCoordinatorOptions["timers"];
  guestTimers?: OnlineMatchCoordinatorOptions["timers"];
  ackTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
}> = {}) {
  const host = new Endpoint({
    role: "host",
    side: "red",
    peerId: "peer-host",
    remotePeerId: "peer-guest",
    game: input.hostGame,
    intent: input.intent,
    timers: input.hostTimers,
    ackTimeoutMs: input.ackTimeoutMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    pongTimeoutMs: input.pongTimeoutMs,
  });
  const guest = new Endpoint({
    role: "guest",
    side: "black",
    peerId: "peer-guest",
    remotePeerId: "peer-host",
    game: input.guestGame,
    intent: input.intent,
    timers: input.guestTimers,
    ackTimeoutMs: input.ackTimeoutMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    pongTimeoutMs: input.pongTimeoutMs,
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
  if (!first) throw new Error("Expected a handshake message");
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
      features: ["rematch-v1", "snapshot-v1"],
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
    expect(host.commitCalls.map((call) => call.context.actorSide)).toEqual(["red", "black"]);
    expect(guest.commitCalls.map((call) => call.context.actorSide)).toEqual(["red", "black"]);
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
      purpose: "heartbeat",
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
      purpose: "heartbeat",
      revision: 0,
      positionHash: hash,
    }));
    expect(messages(host.sent).at(-1)).toMatchObject({
      type: "pong",
      nonce: "ping-1",
      purpose: "heartbeat",
      revision: 0,
      positionHash: hash,
    });

    const before = serializeGame(host.game);
    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, guestNextSeq + 1),
      type: "resign",
      action: "request",
      proposalId: "proposal-resign-1",
      resigningSide: "black",
      knownRevision: 0,
      knownHash: hash,
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

  it("resigns through request/commit/ack even when it is not the local turn", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);

    await expect(guest.coordinator.submitLocalResign()).resolves.toEqual({ ok: true });
    await settle(host, guest);

    expect(host.game).toEqual(guest.game);
    expect(host.game).toMatchObject({
      revision: 1,
      status: { kind: "ended", winner: "red", reason: "resignation" },
      lastAction: { kind: "resign", side: "black" },
    });
    expect(host.coordinator.getSnapshot()).toMatchObject({ phase: "terminal", pending: null });
    expect(guest.coordinator.getSnapshot()).toMatchObject({ phase: "terminal", pending: null });
    expect(messages(guest.sent).filter((message) => message.type === "resign"))
      .toEqual([expect.objectContaining({ action: "request", resigningSide: "black" })]);
    expect(messages(host.sent).filter((message) => message.type === "resign"))
      .toEqual([expect.objectContaining({ action: "commit", resigningSide: "black" })]);
    expect(host.commitCalls.at(-1)?.context).toMatchObject({ origin: "remote", actorSide: "black" });
    // The requester's commit arrives in a remote frame, but the resigning
    // actor remains its own local side.
    expect(guest.commitCalls.at(-1)?.context).toMatchObject({ origin: "remote", actorSide: "black" });
  });

  it("serializes a legal move racing a resignation and gives simultaneous host resign priority", async () => {
    const racing = pair();
    await startPair(racing.host, racing.guest);
    await readyPair(racing.host, racing.guest);
    await Promise.all([
      racing.host.coordinator.submitLocalMove(RED_MOVE),
      racing.guest.coordinator.submitLocalResign(),
    ]);
    await settle(racing.host, racing.guest);
    expect(racing.host.game).toEqual(racing.guest.game);
    expect(racing.host.game).toMatchObject({
      revision: 2,
      status: { kind: "ended", winner: "red", reason: "resignation" },
    });

    const simultaneous = pair();
    await startPair(simultaneous.host, simultaneous.guest);
    await readyPair(simultaneous.host, simultaneous.guest);
    await Promise.all([
      simultaneous.host.coordinator.submitLocalResign(),
      simultaneous.guest.coordinator.submitLocalResign(),
    ]);
    await settle(simultaneous.host, simultaneous.guest);
    expect(simultaneous.host.game).toEqual(simultaneous.guest.game);
    expect(simultaneous.host.game.status).toMatchObject({
      kind: "ended",
      winner: "black",
      reason: "resignation",
    });
    expect(simultaneous.host.game.lastAction).toEqual({ kind: "resign", side: "red" });
  });

  it("stalls on ack timeout without retrying and accepts the exact late ack", async () => {
    const timers = new ManualTimers();
    const { host, guest } = pair({ hostTimers: timers, ackTimeoutMs: 12 });
    await startPair(host, guest);
    await readyPair(host, guest);
    guest.blockedTypes.add("ack");

    await host.coordinator.submitLocalMove(RED_MOVE);
    await settle(host, guest);
    const sentBeforeTimeout = host.sent.length;
    timers.advance(12);
    await host.coordinator.whenIdle();
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "stalled",
      issue: { kind: "ack-timeout" },
      pending: { kind: "move" },
    });
    expect(host.sent).toHaveLength(sentBeforeTimeout);

    const lateAck = messages(guest.sent).find((message) => message.type === "ack");
    if (!lateAck) throw new Error("missing late ack");
    await host.coordinator.handleFrame(encode(lateAck));
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "playable",
      issue: null,
      pending: null,
    });
  });

  it("pauses heartbeat while hidden and revalidates with an exact ping before unlocking", async () => {
    const timers = new ManualTimers();
    const { host, guest } = pair({
      hostTimers: timers,
      ackTimeoutMs: 10,
      heartbeatIntervalMs: 15,
      pongTimeoutMs: 20,
    });
    await startPair(host, guest);
    await readyPair(host, guest);
    const sentBeforeHidden = host.sent.length;
    await host.coordinator.setVisible(false);
    timers.advance(100);
    await host.coordinator.whenIdle();
    expect(host.sent).toHaveLength(sentBeforeHidden);
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "stalled",
      issue: { kind: "hidden" },
      control: { visible: false },
    });

    await host.coordinator.setVisible(true);
    await settle(host, guest);
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "playable",
      issue: null,
      control: { visible: true, outstandingPingNonce: null },
    });

    const sentBeforeDisconnect = host.sent.length;
    await host.coordinator.setTransportAvailable(false);
    timers.advance(100);
    await host.coordinator.whenIdle();
    expect(host.sent).toHaveLength(sentBeforeDisconnect);
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "stalled",
      issue: { kind: "transport-unavailable" },
      control: { transportAvailable: false },
    });
    await host.coordinator.setTransportAvailable(true);
    await settle(host, guest);
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "playable",
      issue: null,
      control: { transportAvailable: true },
    });
  });

  it("continues applying and acknowledging ordered remote commands while hidden", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    await guest.coordinator.setVisible(false);

    await host.coordinator.submitLocalMove(RED_MOVE);
    await settle(host, guest);

    expect(guest.game).toEqual(host.game);
    expect(guest.coordinator.getSnapshot()).toMatchObject({
      phase: "stalled",
      revision: 1,
      issue: { kind: "hidden" },
      control: { visible: false },
    });
    expect(host.coordinator.getSnapshot()).toMatchObject({ pending: null });

    await guest.coordinator.setVisible(true);
    await settle(host, guest);
    expect(guest.coordinator.getSnapshot()).toMatchObject({
      phase: "playable",
      issue: null,
      control: { visible: true },
    });
  });

  it("accepts an exact routine pong after the local game advances", async () => {
    const timers = new ManualTimers();
    const { host, guest } = pair({
      hostTimers: timers,
      heartbeatIntervalMs: 15,
      pongTimeoutMs: 20,
    });
    await startPair(host, guest);
    await readyPair(host, guest);
    guest.blockedTypes.add("pong");
    guest.blockedTypes.add("ack");

    timers.advance(15);
    await settle(host, guest);
    const pong = messages(guest.sent).find((message) => message.type === "pong");
    if (!pong || pong.type !== "pong") throw new Error("missing pong");
    expect(pong.purpose).toBe("heartbeat");

    await expect(host.coordinator.submitLocalMove(RED_MOVE)).resolves.toEqual({ ok: true });
    await settle(host, guest);
    expect(host.game.revision).toBe(1);
    expect(host.coordinator.getSnapshot().control.outstandingPingNonce).toBe(pong.nonce);

    const ack = messages(guest.sent).find((message) => message.type === "ack");
    if (!ack || ack.type !== "ack") throw new Error("missing ack");
    await host.coordinator.handleFrame(encode(pong));
    await host.coordinator.handleFrame(encode(ack));

    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "playable",
      revision: 1,
      pending: null,
      error: null,
      control: { outstandingPingNonce: null },
    });

    const nextGuestSeq = Math.max(...messages(guest.sent).map((message) => message.seq)) + 1;
    const initialHash = await sha256Hex(serializeGame(createInitialGame()));
    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, nextGuestSeq),
      type: "ping",
      nonce: "historical-heartbeat",
      purpose: "heartbeat",
      revision: 0,
      positionHash: initialHash,
    }));
    expect(messages(host.sent).at(-1)).toMatchObject({
      type: "pong",
      nonce: "historical-heartbeat",
      purpose: "heartbeat",
      revision: 0,
      positionHash: initialHash,
    });
    expect(host.coordinator.getSnapshot()).toMatchObject({ phase: "playable", revision: 1 });
  });

  it("keeps lifecycle revalidation strict when the peer position advanced", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    await host.coordinator.setTransportAvailable(false);
    guest.game = apply(guest.game, RED_MOVE);

    await host.coordinator.setTransportAvailable(true);
    await settle(host, guest);

    const revalidation = messages(host.sent).findLast((message) => message.type === "ping");
    expect(revalidation).toMatchObject({ purpose: "revalidation", revision: 0 });
    expect(guest.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "position-mismatch" },
    });
    expect(host.coordinator.getSnapshot().phase).not.toBe("playable");
  });

  it("keeps fatal phases sticky across visibility and transport changes", async () => {
    const repair = pair();
    await startPair(repair.host, repair.guest);
    const lastGuestSeq = Math.max(...messages(repair.guest.sent).map((message) => message.seq));
    const hash = repair.host.coordinator.getSnapshot().hash;
    if (!hash) throw new Error("missing hash");
    await repair.host.coordinator.handleFrame(encode({
      ...remoteIdentity(repair.guest, lastGuestSeq + 2),
      type: "ping",
      nonce: "gap",
      purpose: "heartbeat",
      revision: 0,
      positionHash: hash,
    }));
    await repair.host.coordinator.setVisible(false);
    await repair.host.coordinator.setVisible(true);
    await repair.host.coordinator.setTransportAvailable(false);
    await repair.host.coordinator.setTransportAvailable(true);
    expect(repair.host.coordinator.getSnapshot()).toMatchObject({
      phase: "repair-required",
      error: { code: "sequence-gap" },
      control: { visible: true, transportAvailable: true },
    });

    const failed = new Endpoint({
      role: "host",
      side: "red",
      peerId: "peer-host",
      remotePeerId: "peer-guest",
      digest: async () => { throw new Error("digest unavailable"); },
    });
    await failed.coordinator.start();
    await failed.coordinator.setVisible(false);
    await failed.coordinator.setVisible(true);
    await failed.coordinator.setTransportAvailable(false);
    await failed.coordinator.setTransportAvailable(true);
    expect(failed.coordinator.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "internal-error" },
      control: { visible: true, transportAvailable: true },
    });
  });

  it("flushes a locally committed move before reconnect revalidation", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    const gate = deferred<void>();
    host.commitWait = gate.promise;

    const move = host.coordinator.submitLocalMove(RED_MOVE);
    await expect.poll(() => host.commitCalls.length).toBe(1);
    const paused = host.coordinator.setTransportAvailable(false);
    gate.resolve();

    await expect(move).resolves.toEqual({ ok: true });
    await paused;
    expect(host.game.revision).toBe(1);
    expect(guest.game.revision).toBe(0);
    expect(messages(host.sent).filter((message) => message.type === "command")).toHaveLength(0);

    await host.coordinator.setTransportAvailable(true);
    await settle(host, guest);

    const reconnectFrames = messages(host.sent).filter((message) => (
      message.type === "command" || message.type === "ping"
    ));
    expect(reconnectFrames.slice(-2).map((message) => message.type)).toEqual(["command", "ping"]);
    expect(reconnectFrames.at(-1)).toMatchObject({ purpose: "revalidation", revision: 1 });
    expect(guest.game).toEqual(host.game);
    expect(host.coordinator.getSnapshot()).toMatchObject({ phase: "playable", pending: null });
  });

  it("flushes an ACK committed during disconnect before reconnect revalidation", async () => {
    const { host, guest } = pair();
    await startPair(host, guest);
    await readyPair(host, guest);
    const gate = deferred<void>();
    guest.commitWait = gate.promise;

    await host.coordinator.submitLocalMove(RED_MOVE);
    await expect.poll(() => guest.commitCalls.length).toBe(1);
    const paused = guest.coordinator.setTransportAvailable(false);
    gate.resolve();
    await paused;

    expect(host.game.revision).toBe(1);
    expect(guest.game.revision).toBe(1);
    expect(messages(guest.sent).filter((message) => message.type === "ack")).toHaveLength(0);
    expect(host.coordinator.getSnapshot().pending).toMatchObject({ kind: "move" });

    await guest.coordinator.setTransportAvailable(true);
    await settle(host, guest);

    const reconnectFrames = messages(guest.sent).filter((message) => (
      message.type === "ack" || message.type === "ping"
    ));
    expect(reconnectFrames.slice(-2).map((message) => message.type)).toEqual(["ack", "ping"]);
    expect(host.game).toEqual(guest.game);
    expect(host.coordinator.getSnapshot()).toMatchObject({ phase: "playable", pending: null });
    expect(guest.coordinator.getSnapshot().phase).toBe("playable");
  });

  it("stalls on heartbeat timeout and an exact late pong restores play", async () => {
    const timers = new ManualTimers();
    const { host, guest } = pair({
      hostTimers: timers,
      heartbeatIntervalMs: 15,
      pongTimeoutMs: 20,
    });
    await startPair(host, guest);
    await readyPair(host, guest);
    host.blockedTypes.add("ping");

    timers.advance(15);
    await settle(host, guest);
    const ping = messages(host.sent).find((message) => message.type === "ping");
    if (!ping || ping.type !== "ping") throw new Error("missing ping");
    expect(host.coordinator.getSnapshot().control.outstandingPingNonce).toBe(ping.nonce);
    timers.advance(20);
    await host.coordinator.whenIdle();
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "stalled",
      issue: { kind: "pong-timeout", relatedId: ping.nonce },
    });

    const nextGuestSeq = Math.max(...messages(guest.sent).map((message) => message.seq)) + 1;
    const currentHash = host.coordinator.getSnapshot().hash;
    if (!currentHash) throw new Error("missing hash");
    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, nextGuestSeq),
      type: "ping",
      nonce: "unrelated-ping",
      purpose: "heartbeat",
      revision: 0,
      positionHash: currentHash,
    }));
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "stalled",
      issue: { kind: "pong-timeout", relatedId: ping.nonce },
      control: { outstandingPingNonce: ping.nonce },
    });

    await host.coordinator.handleFrame(encode({
      ...remoteIdentity(guest, nextGuestSeq + 1),
      type: "pong",
      nonce: ping.nonce,
      purpose: ping.purpose,
      revision: ping.revision,
      positionHash: ping.positionHash,
    }));
    expect(host.coordinator.getSnapshot()).toMatchObject({
      phase: "playable",
      issue: null,
      control: { outstandingPingNonce: null },
    });
  });

  it("supports terminal rematch request, accept, decline, cancel, and host-priority races", async () => {
    const agreed = pair();
    await startPair(agreed.host, agreed.guest);
    await readyPair(agreed.host, agreed.guest);
    await agreed.guest.coordinator.submitLocalResign();
    await settle(agreed.host, agreed.guest);
    await agreed.host.coordinator.requestRematch();
    await settle(agreed.host, agreed.guest);
    expect(agreed.guest.coordinator.getSnapshot().rematch).toMatchObject({ status: "received" });
    await expect(agreed.host.coordinator.requestRematch())
      .resolves.toEqual({ ok: false, reason: "invalid-phase" });
    await agreed.guest.coordinator.acceptRematch();
    await settle(agreed.host, agreed.guest);
    const hostAgreement = agreed.host.coordinator.getSnapshot().rematch.agreedProposal;
    expect(hostAgreement).toMatchObject({ nextRematchIndex: 1, hostSide: "black" });
    expect(agreed.guest.coordinator.getSnapshot().rematch.agreedProposal)
      .toMatchObject({
        proposalId: hostAgreement?.proposalId,
        nextMatchId: hostAgreement?.nextMatchId,
        nextRematchIndex: 1,
        hostSide: "black",
      });

    const declined = pair();
    await startPair(declined.host, declined.guest);
    await readyPair(declined.host, declined.guest);
    await declined.guest.coordinator.submitLocalResign();
    await settle(declined.host, declined.guest);
    await declined.host.coordinator.requestRematch();
    await settle(declined.host, declined.guest);
    await declined.guest.coordinator.declineRematch();
    await settle(declined.host, declined.guest);
    expect(declined.host.coordinator.getSnapshot().rematch.status).toBe("declined");

    await declined.host.coordinator.requestRematch();
    await settle(declined.host, declined.guest);
    await declined.host.coordinator.cancelRematch();
    await settle(declined.host, declined.guest);
    expect(declined.guest.coordinator.getSnapshot().rematch.status).toBe("cancelled");

    const raced = pair();
    await startPair(raced.host, raced.guest);
    await readyPair(raced.host, raced.guest);
    await raced.guest.coordinator.submitLocalResign();
    await settle(raced.host, raced.guest);
    await Promise.all([
      raced.host.coordinator.requestRematch(),
      raced.guest.coordinator.requestRematch(),
    ]);
    await settle(raced.host, raced.guest);
    const hostProposal = raced.host.coordinator.getSnapshot().rematch.proposal;
    expect(hostProposal?.owner).toBe("local");
    expect(raced.guest.coordinator.getSnapshot().rematch.proposal)
      .toMatchObject({ proposalId: hostProposal?.proposalId, owner: "remote" });
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
