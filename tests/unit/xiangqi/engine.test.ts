import { describe, expect, it } from "vitest";

import {
  createInitialGame,
  getLegalMoves,
  getPieceAt,
} from "../../../lib/xiangqi/index";

describe("popular-v1 initial position", () => {
  it("starts with 32 stable pieces, red to move, and legal opening moves", () => {
    const state = createInitialGame();

    expect(state.board.filter(Boolean)).toHaveLength(32);
    expect(new Set(state.board.filter(Boolean).map((piece) => piece?.id)).size).toBe(32);
    expect(state.sideToMove).toBe("red");
    expect(getPieceAt(state, { file: 4, rank: 0 })).toMatchObject({
      id: "red:general:0",
      role: "general",
      side: "red",
    });
    expect(getLegalMoves(state, "red:soldier:0")).toEqual([
      { file: 0, rank: 4 },
    ]);
    expect(getPieceAt(state, { file: 7, rank: 7 })?.id).toBe("black:cannon:1");
    expect(getPieceAt(state, { file: 8, rank: 9 })?.id).toBe("black:chariot:1");
  });
});
