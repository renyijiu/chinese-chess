import {
  POPULAR_RULESET_ID,
  XIANGQI_SCHEMA_VERSION,
  boardIndex,
  getPositionKey,
  type GameState,
  type Piece,
  type Role,
  type Side,
} from "../../../lib/xiangqi/index";

export function piece(
  id: string,
  side: Side,
  role: Role,
  file: number,
  rank: number,
): Piece {
  return { id, side, role, square: { file, rank } };
}

export function makeState(
  pieces: ReadonlyArray<Piece>,
  sideToMove: Side = "red",
  overrides: Partial<GameState> = {},
): GameState {
  const board: Array<Piece | null> = Array.from({ length: 90 }, () => null);
  for (const candidate of pieces) {
    board[boardIndex(candidate.square)] = candidate;
  }
  const base: GameState = {
    schemaVersion: XIANGQI_SCHEMA_VERSION,
    rulesetId: POPULAR_RULESET_ID,
    initialPosition: "standard",
    board,
    sideToMove,
    revision: 0,
    noCapturePlies: 0,
    history: [],
    repetitionCounts: {},
    status: { kind: "playing", check: null },
    lastAction: null,
    commandLog: [],
    ...overrides,
  };
  if (overrides.repetitionCounts) {
    return base;
  }
  return { ...base, repetitionCounts: { [getPositionKey(base)]: 1 } };
}

export function guardedGenerals(): Piece[] {
  return [
    piece("red:general:0", "red", "general", 4, 0),
    piece("black:general:0", "black", "general", 4, 9),
    piece("red:soldier:guard", "red", "soldier", 4, 5),
  ];
}

export function squareKeys(squares: ReadonlyArray<{ file: number; rank: number }>): string[] {
  return squares.map(({ file, rank }) => `${file},${rank}`).sort();
}
