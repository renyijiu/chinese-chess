import { describe, expect, it } from "vitest";

import {
  MAX_ONLINE_FRAME_BYTES,
  ONLINE_PROTOCOL_VERSION,
  decodeOnlineMessageV1,
  encodeOnlineMessageV1,
  type OnlineMessageV1,
} from "../../../lib/xiangqi/online/index";

const HASH = "a".repeat(64);

const identity = {
  v: ONLINE_PROTOCOL_VERSION,
  pairingId: "pairing-1",
  sessionId: "session-1",
  matchId: "match-1",
  senderPeerId: "peer-host",
  seq: 4,
} as const;

const messages: ReadonlyArray<OnlineMessageV1> = [
  {
    ...identity,
    type: "hello",
    intent: "new",
    signalingRole: "host",
    side: "red",
    gameSchemaVersion: 1,
    ruleset: "popular-v1",
    revision: 0,
    positionHash: HASH,
    features: ["rematch-v1", "snapshot-v1"],
  },
  { ...identity, type: "ready", revision: 0, positionHash: HASH },
  {
    ...identity,
    type: "command",
    commandId: "command-1",
    actorSide: "red",
    expectedRevision: 0,
    beforeHash: HASH,
    command: {
      type: "move",
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    },
    afterRevision: 1,
    afterHash: "b".repeat(64),
  },
  {
    ...identity,
    type: "ack",
    ackedMessageId: "command-1",
    ackedSeq: 3,
    status: "applied",
    revision: 1,
    positionHash: HASH,
  },
  {
    ...identity,
    type: "snapshot-request",
    requestId: "snapshot-1",
    reason: "hash-mismatch",
    knownRevision: 1,
    knownHash: HASH,
  },
  {
    ...identity,
    type: "snapshot",
    requestId: "snapshot-1",
    revision: 1,
    positionHash: HASH,
    serializedGame: "canonical-game",
  },
  { ...identity, type: "ping", nonce: "nonce-1", revision: 1, positionHash: HASH },
  { ...identity, type: "pong", nonce: "nonce-1", revision: 1, positionHash: HASH },
  {
    ...identity,
    type: "resign",
    action: "commit",
    proposalId: "proposal-resign-1",
    commandId: "resign-1",
    resigningSide: "black",
    expectedRevision: 2,
    beforeHash: HASH,
    afterRevision: 3,
    afterHash: "b".repeat(64),
  },
  {
    ...identity,
    type: "resign",
    action: "request",
    proposalId: "proposal-resign-1",
    resigningSide: "black",
    knownRevision: 2,
    knownHash: HASH,
  },
  {
    ...identity,
    type: "rematch",
    action: "request",
    proposalId: "proposal-1",
    nextMatchId: "match-2",
    nextRematchIndex: 1,
    hostSide: "black",
    terminalRevision: 3,
    terminalHash: HASH,
  },
  {
    ...identity,
    type: "error",
    code: "recovery-conflict",
    fatal: true,
    relatedSeq: 3,
  },
];

function expectEncoded(message: OnlineMessageV1): string {
  const encoded = encodeOnlineMessageV1(message);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(encoded.error.code);
  return encoded.value;
}

describe("online protocol v1", () => {
  it("round-trips every exact-key message variant", () => {
    for (const message of messages) {
      const decoded = decodeOnlineMessageV1(expectEncoded(message));
      expect(decoded).toEqual({ ok: true, value: message });
    }
  });

  it("rejects unknown top-level and nested keys, and encoder self-validates", () => {
    const hello = messages[0];
    const withExtra = { ...hello, surprise: true };
    expect(decodeOnlineMessageV1(JSON.stringify(withExtra))).toEqual({
      ok: false,
      error: { code: "schema" },
    });
    expect(encodeOnlineMessageV1(withExtra)).toEqual({
      ok: false,
      error: { code: "schema" },
    });

    const command = messages[2];
    if (command.type !== "command") throw new Error("bad fixture");
    expect(decodeOnlineMessageV1(JSON.stringify({
      ...command,
      command: { ...command.command, promotion: "general" },
    }))).toEqual({ ok: false, error: { code: "schema" } });
  });

  it("requires canonical known feature subsets and rejects unknown enums", () => {
    const hello = messages[0];
    expect(decodeOnlineMessageV1(JSON.stringify({ ...hello, features: ["snapshot-v1"] })).ok)
      .toBe(true);
    for (const features of [
      ["snapshot-v1", "rematch-v1"],
      ["snapshot-v1", "snapshot-v1"],
      ["future-v2"],
    ]) {
      expect(decodeOnlineMessageV1(JSON.stringify({ ...hello, features }))).toEqual({
        ok: false,
        error: { code: "schema" },
      });
    }

    const remoteError = messages.at(-1)!;
    expect(decodeOnlineMessageV1(JSON.stringify({ ...remoteError, code: "free-form" }))).toEqual({
      ok: false,
      error: { code: "schema" },
    });
  });

  it("keeps both resignation phases exact-key and mutually exclusive", () => {
    const commit = messages.find((message) => message.type === "resign" && message.action === "commit")!;
    const request = messages.find((message) => message.type === "resign" && message.action === "request")!;

    expect(decodeOnlineMessageV1(JSON.stringify({ ...request, commandId: "not-allowed" })))
      .toEqual({ ok: false, error: { code: "schema" } });
    expect(decodeOnlineMessageV1(JSON.stringify({ ...commit, knownRevision: 2 })))
      .toEqual({ ok: false, error: { code: "schema" } });
    const missingAction = Object.fromEntries(
      Object.entries(commit).filter(([key]) => key !== "action"),
    );
    expect(decodeOnlineMessageV1(JSON.stringify(missingAction)))
      .toEqual({ ok: false, error: { code: "schema" } });
  });

  it("enforces bounded IDs, safe integers, lowercase hashes, and legal move squares", () => {
    const ready = messages[1];
    const invalid = [
      { ...ready, pairingId: "" },
      { ...ready, sessionId: "x".repeat(129) },
      { ...ready, seq: 0 },
      { ...ready, seq: Number.MAX_SAFE_INTEGER + 1 },
      { ...ready, revision: -1 },
      { ...ready, positionHash: "A".repeat(64) },
    ];
    for (const value of invalid) {
      expect(decodeOnlineMessageV1(JSON.stringify(value))).toEqual({
        ok: false,
        error: { code: "schema" },
      });
    }

    const command = messages[2];
    if (command.type !== "command") throw new Error("bad fixture");
    expect(decodeOnlineMessageV1(JSON.stringify({
      ...command,
      command: { ...command.command, from: { file: 9, rank: 0 } },
    }))).toEqual({ ok: false, error: { code: "schema" } });
    expect(decodeOnlineMessageV1(JSON.stringify({
      ...command,
      afterRevision: command.expectedRevision + 2,
    }))).toEqual({ ok: false, error: { code: "schema" } });
  });

  it("distinguishes size, UTF-8, JSON, schema, and version failures before parsing payloads", () => {
    expect(decodeOnlineMessageV1("{".repeat(MAX_ONLINE_FRAME_BYTES + 1))).toEqual({
      ok: false,
      error: { code: "size" },
    });
    expect(decodeOnlineMessageV1(new Uint8Array([0xc3, 0x28]))).toEqual({
      ok: false,
      error: { code: "encoding" },
    });
    expect(decodeOnlineMessageV1("{" )).toEqual({ ok: false, error: { code: "json" } });
    expect(decodeOnlineMessageV1("[]")).toEqual({ ok: false, error: { code: "schema" } });
    expect(decodeOnlineMessageV1(JSON.stringify({ v: 2 }))).toEqual({
      ok: false,
      error: { code: "version" },
    });
  });

  it("refuses to encode otherwise valid messages that exceed the UTF-8 frame budget", () => {
    const snapshot = messages.find((message) => message.type === "snapshot")!;
    const encoded = encodeOnlineMessageV1({
      ...snapshot,
      serializedGame: "棋".repeat(MAX_ONLINE_FRAME_BYTES),
    });
    expect(encoded).toEqual({ ok: false, error: { code: "size" } });
  });
});
