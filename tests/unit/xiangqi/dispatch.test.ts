import { describe, expect, it } from "vitest";

import {
  createInitialGame,
  dispatch,
  getLegalMoves,
  getPieceAt,
  getPositionKey,
  type GameState,
  type Square,
} from "../../../lib/xiangqi/index";
import { guardedGenerals, makeState, piece } from "./fixtures";

function move(state: GameState, from: Square, to: Square): GameState {
  const result = dispatch(state, { type: "move", expectedRevision: state.revision, from, to });
  expect(result.error).toBeUndefined();
  return result.state;
}

function checkmateSetup(): GameState {
  return makeState([
    piece("red:general:0", "red", "general", 4, 0),
    piece("black:general:0", "black", "general", 4, 9),
    piece("red:chariot:check", "red", "chariot", 4, 7),
    piece("red:chariot:left", "red", "chariot", 3, 7),
    piece("red:chariot:right", "red", "chariot", 5, 7),
  ]);
}

describe("command dispatch", () => {
  it("atomically commits a legal move with deterministic events", () => {
    const state = createInitialGame();
    const result = dispatch(state, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });

    expect(result.error).toBeUndefined();
    expect(result.state).not.toBe(state);
    expect(result.state.revision).toBe(1);
    expect(result.state.sideToMove).toBe("black");
    expect(result.state.history[0]?.notation).toBe("红·兵 a3 → a4");
    expect(result.events.map((event) => [event.type, event.eventId])).toEqual([
      ["MoveCommitted", "1:0"],
    ]);
  });

  it("keeps the exact original state reference for invalid and stale commands", () => {
    const state = createInitialGame();
    const wrongSide = dispatch(state, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    });
    expect(wrongSide.state).toBe(state);
    expect(wrongSide.events).toEqual([]);
    expect(wrongSide.error?.code).toBe("not-your-turn");

    const stale = dispatch(state, {
      type: "resign",
      expectedRevision: 10,
    });
    expect(stale.state).toBe(state);
    expect(stale.error?.code).toBe("stale-revision");
  });

  it.each([
    {
      name: "off-board coordinates",
      command: { type: "move", expectedRevision: 0, from: { file: -1, rank: 3 }, to: { file: 0, rank: 4 } } as const,
      code: "invalid-square",
    },
    {
      name: "empty source",
      command: { type: "move", expectedRevision: 0, from: { file: 0, rank: 4 }, to: { file: 0, rank: 5 } } as const,
      code: "no-piece",
    },
    {
      name: "illegal destination",
      command: { type: "move", expectedRevision: 0, from: { file: 0, rank: 3 }, to: { file: 1, rank: 3 } } as const,
      code: "illegal-move",
    },
  ])("rejects $name without mutation", ({ command, code }) => {
    const state = createInitialGame();
    const result = dispatch(state, command);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
    expect(result.error?.code).toBe(code);
  });

  it("emits capture after move and resets the no-capture counter", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:chariot:0", "red", "chariot", 0, 0),
      piece("black:soldier:0", "black", "soldier", 0, 2),
    ], "red", { noCapturePlies: 41 });
    const result = dispatch(state, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 2 },
    });

    expect(result.error).toBeUndefined();
    expect(result.state.noCapturePlies).toBe(0);
    expect(result.events.map((event) => event.type)).toEqual([
      "MoveCommitted",
      "PieceCaptured",
    ]);
    expect(getPieceAt(result.state, { file: 0, rank: 2 })?.id).toBe("red:chariot:0");

    const undone = dispatch(result.state, { type: "undo", expectedRevision: 1 });
    expect(undone.state.noCapturePlies).toBe(41);
    expect(getPieceAt(undone.state, { file: 0, rank: 0 })?.id).toBe("red:chariot:0");
    expect(getPieceAt(undone.state, { file: 0, rank: 2 })?.id).toBe("black:soldier:0");
  });

  it("ends on checkmate before any draw counter and allows that move to be undone", () => {
    const state = { ...checkmateSetup(), noCapturePlies: 99 };
    const result = dispatch(state, {
      type: "move",
      expectedRevision: 0,
      from: { file: 4, rank: 7 },
      to: { file: 4, rank: 8 },
    });

    expect(result.state.status).toEqual({
      kind: "ended",
      outcome: "red-win",
      winner: "red",
      reason: "checkmate",
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "MoveCommitted",
      "CheckDeclared",
      "GameEnded",
    ]);

    const undone = dispatch(result.state, { type: "undo", expectedRevision: 1 });
    expect(undone.error).toBeUndefined();
    expect(undone.state.status).toEqual({ kind: "playing", check: null });
    expect(undone.state.sideToMove).toBe("red");
  });

  it("awards a win for stalemate even when the general is not checked", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:chariot:left", "red", "chariot", 3, 8),
      piece("red:chariot:right", "red", "chariot", 5, 8),
      piece("red:soldier:mover", "red", "soldier", 0, 3),
    ]);
    const result = dispatch(state, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });

    expect(result.state.status).toMatchObject({
      kind: "ended",
      winner: "red",
      reason: "stalemate",
    });
  });

  it("draws on the third occurrence of a side-to-move position", () => {
    let state = makeState([
      ...guardedGenerals(),
      piece("red:chariot:0", "red", "chariot", 0, 0),
      piece("black:chariot:0", "black", "chariot", 8, 9),
    ]);
    const cycle: Array<[Square, Square]> = [
      [{ file: 0, rank: 0 }, { file: 0, rank: 1 }],
      [{ file: 8, rank: 9 }, { file: 8, rank: 8 }],
      [{ file: 0, rank: 1 }, { file: 0, rank: 0 }],
      [{ file: 8, rank: 8 }, { file: 8, rank: 9 }],
    ];
    const initialKey = getPositionKey(state);
    for (const [from, to] of [...cycle, ...cycle]) {
      state = move(state, from, to);
    }

    expect(state.repetitionCounts[initialKey]).toBe(3);
    expect(state.status).toMatchObject({ kind: "ended", reason: "repetition", winner: null });
  });

  it("draws at 100 quiet half-moves", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:chariot:0", "red", "chariot", 0, 0),
      piece("black:chariot:0", "black", "chariot", 8, 9),
    ], "red", { noCapturePlies: 99 });
    const result = dispatch(state, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 1 },
    });
    expect(result.state.status).toMatchObject({ kind: "ended", reason: "no-capture", winner: null });
  });

  it("allows only one consecutive undo and allows another after a new move", () => {
    const moved = move(createInitialGame(), { file: 0, rank: 3 }, { file: 0, rank: 4 });
    const undone = dispatch(moved, { type: "undo", expectedRevision: moved.revision });
    expect(undone.error).toBeUndefined();
    expect(getPieceAt(undone.state, { file: 0, rank: 3 })?.id).toBe("red:soldier:0");

    const repeated = dispatch(undone.state, { type: "undo", expectedRevision: undone.state.revision });
    expect(repeated.state).toBe(undone.state);
    expect(repeated.error?.code).toBe("cannot-undo");

    const movedAgain = move(undone.state, { file: 2, rank: 3 }, { file: 2, rank: 4 });
    const secondUndo = dispatch(movedAgain, { type: "undo", expectedRevision: movedAgain.revision });
    expect(secondUndo.error).toBeUndefined();
  });

  it("ends on resignation and never permits undoing it", () => {
    const state = createInitialGame();
    const resigned = dispatch(state, { type: "resign", expectedRevision: 0 });
    expect(resigned.state.status).toMatchObject({
      kind: "ended",
      winner: "black",
      reason: "resignation",
    });
    expect(resigned.events.map((event) => event.type)).toEqual(["Resigned", "GameEnded"]);

    const undo = dispatch(resigned.state, { type: "undo", expectedRevision: 1 });
    expect(undo.error?.code).toBe("cannot-undo");
  });

  it("preserves board invariants through deterministic random legal games", () => {
    let seed = 0x51a9_2026;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let game = 0; game < 6; game += 1) {
      let state = createInitialGame();
      for (let ply = 0; ply < 160 && state.status.kind === "playing"; ply += 1) {
        const choices = state.board.flatMap((candidate) => {
          if (!candidate || candidate.side !== state.sideToMove) {
            return [];
          }
          return getLegalMoves(state, candidate.id).map((to) => ({ piece: candidate, to }));
        });
        expect(choices.length).toBeGreaterThan(0);
        const choice = choices[Math.floor(random() * choices.length)];
        expect(choice).toBeDefined();
        const result = dispatch(state, {
          type: "move",
          expectedRevision: state.revision,
          from: choice!.piece.square,
          to: choice!.to,
        });
        expect(result.error).toBeUndefined();
        state = result.state;

        const pieces = state.board.filter((candidate) => candidate !== null);
        expect(new Set(pieces.map((candidate) => candidate.id)).size).toBe(pieces.length);
        expect(pieces.filter((candidate) => candidate.role === "general")).toHaveLength(2);
        expect(pieces.every((candidate) => getPieceAt(state, candidate.square)?.id === candidate.id)).toBe(true);
      }
    }
  });
});
