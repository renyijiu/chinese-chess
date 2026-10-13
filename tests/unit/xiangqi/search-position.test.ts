import { describe, expect, it } from "vitest";
import {
  createInitialGame,
  dispatch,
  getLegalMoves,
  getLegalPositionMoves,
  getPositionKey,
  isInCheck,
} from "../../../lib/xiangqi/engine";
import type { GameState, PositionState, Square } from "../../../lib/xiangqi/types";
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
  it("keeps persisted position keys byte-compatible and leaves the source board unchanged", () => {
    const state = createInitialGame();
    const original = structuredClone(state);
    const roleCodes = {
      general: "G",
      advisor: "A",
      elephant: "E",
      chariot: "R",
      horse: "H",
      cannon: "C",
      soldier: "S",
    };
    const positions = [state, ...getLegalPositionMoves(state).map((move) => move.advance())];
    for (const position of positions) {
      const legacyCells = Array.from({ length: 90 }, (_, index) => {
        const piece = position.board[index];
        return piece ? `${piece.side === "red" ? "r" : "b"}${roleCodes[piece.role]}` : "--";
      });
      expect(getPositionKey(position)).toBe(
        `${position.rulesetId}|${position.sideToMove}|${legacyCells.join(".")}`,
      );
    }
    expect(state).toEqual(original);
  });
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

  it("derives the same rules from layered repetition counts as from copied ones", () => {
    let copied: PositionState = createInitialGame();
    let layered: PositionState = copied;
    let seed = 2468;
    for (let ply = 0; ply < 40 && copied.status.kind === "playing"; ply += 1) {
      const copiedMoves = getLegalPositionMoves(copied);
      const layeredMoves = getLegalPositionMoves(layered, { layerRepetition: true });
      expect(layeredMoves).toHaveLength(copiedMoves.length);
      for (const [index, move] of copiedMoves.entries()) {
        const expected = move.advance();
        const actual = layeredMoves[index]!.advance();
        expect({ ...actual, repetitionCounts: null }).toEqual({
          ...expected,
          repetitionCounts: null,
        });
        for (const [key, count] of Object.entries(expected.repetitionCounts)) {
          expect(actual.repetitionCounts[key]).toBe(count);
        }
      }
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      copied = copiedMoves[seed % copiedMoves.length]!.advance();
      layered = layeredMoves[seed % layeredMoves.length]!.advance();
    }
  });

  it("detects threefold repetition through layered counts", () => {
    const shuffle: ReadonlyArray<readonly [from: Square, to: Square]> = [
      [
        { file: 0, rank: 0 },
        { file: 0, rank: 1 },
      ],
      [
        { file: 0, rank: 9 },
        { file: 0, rank: 8 },
      ],
      [
        { file: 0, rank: 1 },
        { file: 0, rank: 0 },
      ],
      [
        { file: 0, rank: 8 },
        { file: 0, rank: 9 },
      ],
    ];
    let position: PositionState = createInitialGame();
    for (let ply = 0; ply < 8; ply += 1) {
      expect(position.status.kind).toBe("playing");
      const [from, to] = shuffle[ply % shuffle.length]!;
      position = getLegalPositionMoves(position, { layerRepetition: true })
        .find(
          (move) =>
            move.from.file === from.file &&
            move.from.rank === from.rank &&
            move.to.file === to.file &&
            move.to.rank === to.rank,
        )!
        .advance();
    }
    expect(position.status).toMatchObject({ kind: "ended", reason: "repetition" });
  });

  it("records the check facts that search leaves read from a derived status", () => {
    let state = createInitialGame();
    let seed = 97531;
    let derived = 0;
    for (let ply = 0; ply < 60 && state.status.kind === "playing"; ply += 1) {
      const candidates = getLegalPositionMoves(state);
      for (const candidate of candidates) {
        const position = candidate.advance();
        if (position.status.kind !== "playing") continue;
        derived += 1;
        const mover = position.sideToMove === "red" ? "black" : "red";
        expect(isInCheck(position, mover)).toBe(false);
        expect(position.status.check === position.sideToMove).toBe(
          isInCheck(position, position.sideToMove),
        );
      }
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const move = candidates[seed % candidates.length]!;
      state = dispatch(state, {
        type: "move",
        expectedRevision: state.revision,
        from: move.from,
        to: move.to,
      }).state;
    }
    expect(derived).toBeGreaterThan(1_000);
  });
});
