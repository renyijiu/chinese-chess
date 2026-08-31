import { describe, expect, it } from "vitest";

import {
  createInitialGame,
  dispatch,
  serializeGame,
  sha256Hex,
  type GameState,
  type ReplayCommand,
} from "../../../lib/xiangqi/index";
import {
  MAX_ONLINE_FRAME_BYTES,
  ONLINE_PROTOCOL_VERSION,
  compareCommandLogs,
  validateSnapshotForFastForwardV1,
  validateSnapshotV1,
  type SnapshotMessageV1,
} from "../../../lib/xiangqi/online/index";

function move(
  state: GameState,
  from: { readonly file: number; readonly rank: number },
  to: { readonly file: number; readonly rank: number },
): GameState {
  const result = dispatch(state, { type: "move", expectedRevision: state.revision, from, to });
  if (result.error) throw new Error(result.error.code);
  return result.state;
}

async function snapshot(state: GameState): Promise<SnapshotMessageV1> {
  const serializedGame = serializeGame(state);
  return {
    v: ONLINE_PROTOCOL_VERSION,
    type: "snapshot",
    pairingId: "pairing-1",
    sessionId: "session-1",
    matchId: "match-1",
    senderPeerId: "peer-host",
    seq: 8,
    requestId: "snapshot-1",
    revision: state.revision,
    positionHash: await sha256Hex(serializedGame),
    serializedGame,
  };
}

describe("online snapshot state synchronization", () => {
  it("accepts a canonical snapshot only when revision and digest agree", async () => {
    const remote = move(createInitialGame(), { file: 0, rank: 3 }, { file: 0, rank: 4 });
    const result = await validateSnapshotV1(await snapshot(remote));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.game).toEqual(remote);
      expect(serializeGame(result.game)).toBe(serializeGame(remote));
    }
  });

  it("rejects invalid, non-canonical, revision-mismatched, hash-mismatched, and undo snapshots", async () => {
    const moved = move(createInitialGame(), { file: 0, rank: 3 }, { file: 0, rank: 4 });
    const valid = await snapshot(moved);
    const pretty = JSON.stringify(JSON.parse(valid.serializedGame), null, 2);

    await expect(validateSnapshotV1({ ...valid, serializedGame: "not-json" }))
      .resolves.toEqual({ ok: false, error: { code: "invalid-serialization" } });
    await expect(validateSnapshotV1({
      ...valid,
      serializedGame: pretty,
      positionHash: await sha256Hex(pretty),
    })).resolves.toEqual({ ok: false, error: { code: "non-canonical" } });
    await expect(validateSnapshotV1({ ...valid, revision: valid.revision + 1 }))
      .resolves.toEqual({ ok: false, error: { code: "revision-mismatch" } });
    await expect(validateSnapshotV1({ ...valid, positionHash: "0".repeat(64) }))
      .resolves.toEqual({ ok: false, error: { code: "hash-mismatch" } });

    const undone = dispatch(moved, { type: "undo", expectedRevision: moved.revision });
    if (undone.error) throw new Error(undone.error.code);
    await expect(validateSnapshotV1(await snapshot(undone.state)))
      .resolves.toEqual({ ok: false, error: { code: "undo-not-allowed" } });

    await expect(validateSnapshotV1({
      ...valid,
      serializedGame: "x".repeat(MAX_ONLINE_FRAME_BYTES),
    })).resolves.toEqual({ ok: false, error: { code: "invalid-snapshot" } });
  });

  it("permits only equal logs or a strict local-prefix fast-forward", () => {
    const first: ReplayCommand = {
      type: "move",
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    };
    const second: ReplayCommand = {
      type: "move",
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    };
    const divergent: ReplayCommand = {
      type: "move",
      from: { file: 2, rank: 6 },
      to: { file: 2, rank: 5 },
    };

    expect(compareCommandLogs([first], [first])).toEqual({ status: "equal" });
    expect(compareCommandLogs([first], [first, second])).toEqual({
      status: "fast-forward",
      missingCommands: [second],
    });
    expect(compareCommandLogs([first, second], [first])).toEqual({ status: "conflict" });
    expect(compareCommandLogs([first, second], [first, divergent])).toEqual({ status: "conflict" });
    expect(compareCommandLogs([{ type: "undo" }], [{ type: "undo" }])).toEqual({
      status: "conflict",
    });
  });

  it("integrates canonical validation with strict-prefix reconciliation", async () => {
    const local = move(createInitialGame(), { file: 0, rank: 3 }, { file: 0, rank: 4 });
    const remote = move(local, { file: 0, rank: 6 }, { file: 0, rank: 5 });
    const accepted = await validateSnapshotForFastForwardV1(local, await snapshot(remote));

    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.status).toBe("fast-forward");
      expect(accepted.game).toEqual(remote);
      expect(accepted.missingCommands).toEqual([remote.commandLog[1]]);
    }

    const conflict = await validateSnapshotForFastForwardV1(remote, await snapshot(local));
    expect(conflict).toEqual({ ok: false, error: { code: "history-conflict" } });
  });
});
