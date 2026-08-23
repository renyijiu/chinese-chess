import { describe, expect, it } from "vitest";

import {
  XiangqiSerializationError,
  createInitialGame,
  deserializeGame,
  dispatch,
  getPositionKey,
  serializeGame,
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
});
