import { describe, expect, it } from "vitest";
import {
  createInitialGame,
  dispatch,
  getLegalMoves,
  getLegalPositionMoves,
  getPositionKey,
} from "../../../lib/xiangqi/engine";
import type { GameState } from "../../../lib/xiangqi/types";
import { makeState, piece } from "./fixtures";

function assertSuccessors(state: GameState) {
  const candidates = getLegalPositionMoves(state);
  const legalCount = state.board.reduce(
    (count, piece) => count + (piece ? getLegalMoves(state, piece.id).length : 0),
    0,
  );
  expect(candidates).toHaveLength(legalCount);
  for (const candidate of candidates) {
    const committed = dispatch(state, {
      type: "move",
      expectedRevision: state.revision,
      from: candidate.from,
      to: candidate.to,
    });
    expect(committed.error).toBeUndefined();
    const position = candidate.advance();
    expect(committed.state).toMatchObject(position);
    expect(position).not.toHaveProperty("history");
    expect(position).not.toHaveProperty("commandLog");
    expect(position).not.toHaveProperty("lastAction");
  }
  return candidates;
}

describe("search position rules", () => {
  it("matches authoritative moves and derived state throughout varied play", () => {
    let state = createInitialGame();
    let seed = 12345;
    for (let ply = 0; ply < 40 && state.status.kind === "playing"; ply += 1) {
      const candidates = assertSuccessors(state);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const move = candidates[seed % candidates.length]!;
      state = dispatch(state, {
        type: "move",
        expectedRevision: state.revision,
        from: move.from,
        to: move.to,
      }).state;
    }
  });

  it("preserves draw thresholds and checkmate before draw adjudication", () => {
    const initial = createInitialGame();
    const noCapture = { ...initial, noCapturePlies: 99 };
    expect(assertSuccessors(noCapture).some((move) => move.advance().status.kind === "ended")).toBe(
      true,
    );
    const first = getLegalPositionMoves(initial)[0]!;
    const repeated = {
      ...initial,
      repetitionCounts: { ...initial.repetitionCounts, [getPositionKey(first.advance())]: 2 },
    };
    const repeat = assertSuccessors(repeated).find(
      (move) =>
        move.from.file === first.from.file &&
        move.from.rank === first.from.rank &&
        move.to.file === first.to.file &&
        move.to.rank === first.to.rank,
    )!;
    expect(repeat.advance().status).toMatchObject({ reason: "repetition" });
    const mate = makeState(
      [
        piece("red:general:0", "red", "general", 4, 0),
        piece("black:general:0", "black", "general", 4, 9),
        piece("red:chariot:mate", "red", "chariot", 4, 7),
        piece("red:soldier:left", "red", "soldier", 3, 8),
        piece("red:soldier:right", "red", "soldier", 5, 8),
        piece("black:soldier:block", "black", "soldier", 4, 8),
      ],
      "red",
      { noCapturePlies: 99 },
    );
    expect(
      assertSuccessors(mate).some((move) => {
        const status = move.advance().status;
        return status.kind === "ended" && status.reason === "checkmate";
      }),
    ).toBe(true);
    expect(
      getLegalPositionMoves(dispatch(initial, { type: "resign", expectedRevision: 0 }).state),
    ).toEqual([]);
  });
});
