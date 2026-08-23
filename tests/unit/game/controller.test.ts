import { describe, expect, it } from "vitest";

import {
  createInitialGame,
  dispatch,
  type GameState,
  type Square,
} from "../../../lib/xiangqi/index";
import {
  deriveSelection,
  moveKeyboardCursor,
  resolveBoardClick,
  type GameSelection,
} from "../../../components/xiangqi/game/controller";

function move(state: GameState, from: Square, to: Square): GameState {
  const result = dispatch(state, {
    type: "move",
    expectedRevision: state.revision,
    from,
    to,
  });
  expect(result.error).toBeUndefined();
  return result.state;
}

describe("game selection controller", () => {
  it("selects only the side to move and derives legal targets from the rules engine", () => {
    const game = createInitialGame();
    const selected = resolveBoardClick(game, deriveSelection(game, null), { file: 0, rank: 3 });

    expect(selected).toMatchObject({
      kind: "selection",
      selection: { pieceId: "red:soldier:0" },
    });
    expect(selected.kind === "selection" && selected.selection.legalMoves).toEqual([
      { file: 0, rank: 4 },
    ]);

    const enemy = resolveBoardClick(game, deriveSelection(game, null), { file: 0, rank: 6 });
    expect(enemy).toMatchObject({
      kind: "selection",
      selection: { pieceId: null, legalMoves: [] },
    });
  });

  it("switches between friendly pieces and cancels when the selected piece is clicked again", () => {
    const game = createInitialGame();
    const first = resolveBoardClick(game, deriveSelection(game, null), { file: 0, rank: 3 });
    expect(first.kind).toBe("selection");
    const firstSelection = first.kind === "selection" ? first.selection : null;

    const switched = resolveBoardClick(game, firstSelection ?? deriveSelection(game, null), {
      file: 2,
      rank: 3,
    });
    expect(switched).toMatchObject({
      kind: "selection",
      selection: { pieceId: "red:soldier:1" },
    });

    const cancelled = resolveBoardClick(game, deriveSelection(game, "red:soldier:1"), { file: 2, rank: 3 });
    expect(cancelled).toMatchObject({
      kind: "selection",
      selection: { pieceId: null, legalMoves: [] },
    });
  });

  it("returns a revision-bound move intent for legal empty and enemy targets", () => {
    let game = createInitialGame();
    const quiet = resolveBoardClick(game, deriveSelection(game, "red:soldier:0"), { file: 0, rank: 4 });
    expect(quiet).toEqual({
      kind: "move",
      command: {
        type: "move",
        expectedRevision: 0,
        from: { file: 0, rank: 3 },
        to: { file: 0, rank: 4 },
      },
    });

    game = move(game, { file: 0, rank: 3 }, { file: 0, rank: 4 });
    game = move(game, { file: 0, rank: 6 }, { file: 0, rank: 5 });
    const capture = resolveBoardClick(game, deriveSelection(game, "red:soldier:0"), { file: 0, rank: 5 });
    expect(capture).toMatchObject({
      kind: "move",
      command: { expectedRevision: 2, to: { file: 0, rank: 5 } },
    });
  });

  it("preserves a valid selection after an illegal empty target and clears stale selection", () => {
    const game = createInitialGame();
    const illegal = resolveBoardClick(game, deriveSelection(game, "red:soldier:0"), { file: 1, rank: 4 });
    expect(illegal).toMatchObject({
      kind: "selection",
      selection: { pieceId: "red:soldier:0" },
    });

    const stale: GameSelection = deriveSelection(game, "black:soldier:0");
    expect(stale).toEqual({ pieceId: null, legalMoves: [] });
  });

  it("moves a keyboard cursor with arrows or WASD and clamps it to the 9 × 10 board", () => {
    expect(moveKeyboardCursor({ file: 4, rank: 0 }, "ArrowLeft")).toEqual({ file: 3, rank: 0 });
    expect(moveKeyboardCursor({ file: 3, rank: 0 }, "a")).toEqual({ file: 2, rank: 0 });
    expect(moveKeyboardCursor({ file: 2, rank: 0 }, "W")).toEqual({ file: 2, rank: 1 });
    expect(moveKeyboardCursor({ file: 8, rank: 9 }, "ArrowRight")).toEqual({ file: 8, rank: 9 });
    expect(moveKeyboardCursor({ file: 0, rank: 0 }, "s")).toEqual({ file: 0, rank: 0 });
    expect(moveKeyboardCursor({ file: 5, rank: 6 }, "Tab")).toEqual({ file: 5, rank: 6 });
  });

  it("can derive a complete select-and-move command from keyboard cursor positions", () => {
    const game = createInitialGame();
    const selected = resolveBoardClick(game, deriveSelection(game, null), { file: 0, rank: 3 });
    expect(selected).toMatchObject({
      kind: "selection",
      selection: { pieceId: "red:soldier:0" },
    });

    const moved = resolveBoardClick(
      game,
      selected.kind === "selection" ? selected.selection : deriveSelection(game, null),
      moveKeyboardCursor({ file: 0, rank: 3 }, "ArrowUp"),
    );
    expect(moved).toMatchObject({
      kind: "move",
      command: {
        expectedRevision: 0,
        from: { file: 0, rank: 3 },
        to: { file: 0, rank: 4 },
      },
    });
  });
});
