import { describe, expect, it } from "vitest";

import {
  XiangqiSerializationError,
  createInitialGame,
  deserializeGame,
  dispatch,
  fingerprintGame,
  getPositionKey,
  serializeGame,
  sha256Hex,
  type GameCommand,
  type GameState,
  type ReplayCommand,
} from "../../../lib/xiangqi/index";

function apply(state: GameState, replay: ReplayCommand): GameState {
  const command = { ...replay, expectedRevision: state.revision } as GameCommand;
  const result = dispatch(state, command);
  expect(result.error).toBeUndefined();
  return result.state;
}

describe("replay persistence", () => {
  it("rebuilds derived state from the standard position and command trajectory", () => {
    let state = createInitialGame();
    state = apply(state, {
      type: "move",
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });
    state = apply(state, {
      type: "move",
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    });
    state = apply(state, { type: "undo" });
    state = apply(state, {
      type: "move",
      from: { file: 2, rank: 6 },
      to: { file: 2, rank: 5 },
    });

    const restored = deserializeGame(serializeGame(state));
    expect(restored.revision).toBe(4);
    expect(restored.commandLog).toEqual(state.commandLog);
    expect(restored.history).toEqual(state.history);
    expect(restored.noCapturePlies).toBe(state.noCapturePlies);
    expect(restored.status).toEqual(state.status);
    expect(getPositionKey(restored)).toBe(getPositionKey(state));
  });

  it("rejects malformed, unsupported, and illegal replay data", () => {
    expect(() => deserializeGame("not json")).toThrow(XiangqiSerializationError);
    expect(() => deserializeGame(JSON.stringify({
      schemaVersion: 2,
      rulesetId: "popular-v1",
      initialPosition: "standard",
      commands: [],
    }))).toThrow(/unsupported/);
    expect(() => deserializeGame(JSON.stringify({
      schemaVersion: 1,
      rulesetId: "popular-v1",
      initialPosition: "standard",
      commands: [{ type: "move", from: { file: 0, rank: 6 }, to: { file: 0, rank: 5 } }],
    }))).toThrow(/not-your-turn/);
  });

  it("records an explicitly named resigning side even when it is not that side's turn", () => {
    const initial = createInitialGame();
    const result = dispatch(initial, {
      type: "resign",
      expectedRevision: initial.revision,
      side: "black",
    });

    expect(result.error).toBeUndefined();
    expect(result.state.status).toMatchObject({
      kind: "ended",
      winner: "red",
      reason: "resignation",
    });
    expect(result.state.lastAction).toEqual({ kind: "resign", side: "black" });
    expect(result.state.commandLog).toEqual([{ type: "resign", side: "black" }]);
    expect(deserializeGame(serializeGame(result.state))).toEqual(result.state);
  });

  it("keeps the legacy omitted-side resign meaning as side-to-move", () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      rulesetId: "popular-v1",
      initialPosition: "standard",
      commands: [{ type: "resign" }],
    });

    const restored = deserializeGame(legacy);
    expect(restored.status).toMatchObject({
      kind: "ended",
      winner: "black",
      reason: "resignation",
    });
    expect(restored.lastAction).toEqual({ kind: "resign", side: "red" });
    expect(serializeGame(restored)).toBe(legacy);
  });

  it("rejects invalid explicit resign sides", () => {
    expect(() => deserializeGame(JSON.stringify({
      schemaVersion: 1,
      rulesetId: "popular-v1",
      initialPosition: "standard",
      commands: [{ type: "resign", side: "green" }],
    }))).toThrow(/side/i);
  });
});

describe("canonical game fingerprints", () => {
  it("hashes UTF-8 strings as stable lowercase SHA-256", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("fingerprints only the canonical serialized game", async () => {
    const game = createInitialGame();
    expect(serializeGame(game)).toBe(
      '{"schemaVersion":1,"rulesetId":"popular-v1","initialPosition":"standard","commands":[]}',
    );
    await expect(fingerprintGame(game)).resolves.toBe(
      "b0d6c2da8043fbd46812939390a3b576fa3a947626627be0670a31a660a0591d",
    );
    await expect(fingerprintGame(deserializeGame(serializeGame(game))))
      .resolves.toBe(await fingerprintGame(game));
  });
});
