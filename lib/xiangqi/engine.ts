import {
  POPULAR_RULESET_ID,
  XIANGQI_SCHEMA_VERSION,
  type Board,
  type CapturedPiece,
  type DispatchResult,
  type DomainEvent,
  type GameCommand,
  type GameState,
  type GameStatus,
  type MoveRecord,
  type Piece,
  type ReplayCommand,
  type Role,
  type Side,
  type Square,
} from "./types";

const FILE_COUNT = 9;
const RANK_COUNT = 10;
const BOARD_SIZE = FILE_COUNT * RANK_COUNT;

const ORTHOGONAL_DIRECTIONS = [
  { file: 0, rank: 1 },
  { file: 1, rank: 0 },
  { file: 0, rank: -1 },
  { file: -1, rank: 0 },
] as const;

const ROLE_CODES: Record<Role, string> = {
  general: "G",
  advisor: "A",
  elephant: "E",
  chariot: "R",
  horse: "H",
  cannon: "C",
  soldier: "S",
};

const ROLE_LABELS: Record<Side, Record<Role, string>> = {
  red: {
    general: "帅",
    advisor: "仕",
    elephant: "相",
    chariot: "车",
    horse: "马",
    cannon: "炮",
    soldier: "兵",
  },
  black: {
    general: "将",
    advisor: "士",
    elephant: "象",
    chariot: "车",
    horse: "马",
    cannon: "炮",
    soldier: "卒",
  },
};

export function boardIndex(square: Square): number {
  return square.rank * FILE_COUNT + square.file;
}

export function isSquare(square: Square): boolean {
  return (
    Number.isInteger(square.file) &&
    Number.isInteger(square.rank) &&
    square.file >= 0 &&
    square.file < FILE_COUNT &&
    square.rank >= 0 &&
    square.rank < RANK_COUNT
  );
}

function sameSquare(left: Square, right: Square): boolean {
  return left.file === right.file && left.rank === right.rank;
}

function otherSide(side: Side): Side {
  return side === "red" ? "black" : "red";
}

function cloneSquare(square: Square): Square {
  return { file: square.file, rank: square.rank };
}

function pieceAt(board: Board, square: Square): Piece | null {
  if (!isSquare(square)) {
    return null;
  }
  return board[boardIndex(square)] ?? null;
}

export function getPieceAt(state: GameState, square: Square): Piece | null {
  return pieceAt(state.board, square);
}

function createPiece(id: string, side: Side, role: Role, file: number, rank: number): Piece {
  return { id, side, role, square: { file, rank } };
}

function createInitialBoard(): Board {
  const board: Array<Piece | null> = Array.from({ length: BOARD_SIZE }, () => null);
  const backRank: ReadonlyArray<Role> = [
    "chariot",
    "horse",
    "elephant",
    "advisor",
    "general",
    "advisor",
    "elephant",
    "horse",
    "chariot",
  ];

  for (const side of ["red", "black"] as const) {
    const homeRank = side === "red" ? 0 : 9;
    const cannonRank = side === "red" ? 2 : 7;
    const soldierRank = side === "red" ? 3 : 6;
    const roleCounts: Partial<Record<Role, number>> = {};

    for (const [file, role] of backRank.entries()) {
      const ordinal = roleCounts[role] ?? 0;
      roleCounts[role] = ordinal + 1;
      const piece = createPiece(`${side}:${role}:${ordinal}`, side, role, file, homeRank);
      board[boardIndex(piece.square)] = piece;
    }

    for (const [ordinal, file] of [1, 7].entries()) {
      const piece = createPiece(`${side}:cannon:${ordinal}`, side, "cannon", file, cannonRank);
      board[boardIndex(piece.square)] = piece;
    }

    for (const [ordinal, file] of [0, 2, 4, 6, 8].entries()) {
      const piece = createPiece(`${side}:soldier:${ordinal}`, side, "soldier", file, soldierRank);
      board[boardIndex(piece.square)] = piece;
    }
  }

  return board;
}

export function getPositionKey(
  state: Pick<GameState, "board" | "sideToMove" | "rulesetId">,
): string {
  const cells = Array.from({ length: BOARD_SIZE }, (_, index) => {
    const piece = state.board[index];
    if (!piece) {
      return "--";
    }
    const sideCode = piece.side === "red" ? "r" : "b";
    return `${sideCode}${ROLE_CODES[piece.role]}`;
  });
  return `${state.rulesetId}|${state.sideToMove}|${cells.join(".")}`;
}

export function createInitialGame(): GameState {
  const board = createInitialBoard();
  const partial = {
    board,
    sideToMove: "red" as const,
    rulesetId: POPULAR_RULESET_ID,
  };
  const initialKey = getPositionKey(partial);

  return {
    schemaVersion: XIANGQI_SCHEMA_VERSION,
    rulesetId: POPULAR_RULESET_ID,
    initialPosition: "standard",
    board,
    sideToMove: "red",
    revision: 0,
    noCapturePlies: 0,
    history: [],
    repetitionCounts: { [initialKey]: 1 },
    status: { kind: "playing", check: null },
    lastAction: null,
    commandLog: [],
  };
}

function isInsidePalace(side: Side, square: Square): boolean {
  if (square.file < 3 || square.file > 5) {
    return false;
  }
  return side === "red"
    ? square.rank >= 0 && square.rank <= 2
    : square.rank >= 7 && square.rank <= 9;
}

function crossedRiver(side: Side, rank: number): boolean {
  return side === "red" ? rank >= 5 : rank <= 4;
}

function canLand(board: Board, piece: Piece, square: Square): boolean {
  if (!isSquare(square)) {
    return false;
  }
  const occupant = pieceAt(board, square);
  return !occupant || (occupant.side !== piece.side && occupant.role !== "general");
}

function pushIfLandable(moves: Square[], board: Board, piece: Piece, square: Square): void {
  if (canLand(board, piece, square)) {
    moves.push(square);
  }
}

function rayMoves(board: Board, piece: Piece, cannon: boolean): Square[] {
  const moves: Square[] = [];
  for (const direction of ORTHOGONAL_DIRECTIONS) {
    let screened = false;
    for (let distance = 1; distance < RANK_COUNT; distance += 1) {
      const square = {
        file: piece.square.file + direction.file * distance,
        rank: piece.square.rank + direction.rank * distance,
      };
      if (!isSquare(square)) {
        break;
      }
      const occupant = pieceAt(board, square);
      if (!cannon) {
        if (!occupant) {
          moves.push(square);
          continue;
        }
        if (occupant.side !== piece.side && occupant.role !== "general") {
          moves.push(square);
        }
        break;
      }

      if (!screened) {
        if (!occupant) {
          moves.push(square);
        } else {
          screened = true;
        }
        continue;
      }

      if (!occupant) {
        continue;
      }
      if (occupant.side !== piece.side && occupant.role !== "general") {
        moves.push(square);
      }
      break;
    }
  }
  return moves;
}

function pseudoMoves(board: Board, piece: Piece): Square[] {
  const moves: Square[] = [];
  switch (piece.role) {
    case "chariot":
      return rayMoves(board, piece, false);
    case "cannon":
      return rayMoves(board, piece, true);
    case "horse": {
      const patterns = [
        { file: 1, rank: 2, legFile: 0, legRank: 1 },
        { file: -1, rank: 2, legFile: 0, legRank: 1 },
        { file: 2, rank: 1, legFile: 1, legRank: 0 },
        { file: 2, rank: -1, legFile: 1, legRank: 0 },
        { file: 1, rank: -2, legFile: 0, legRank: -1 },
        { file: -1, rank: -2, legFile: 0, legRank: -1 },
        { file: -2, rank: 1, legFile: -1, legRank: 0 },
        { file: -2, rank: -1, legFile: -1, legRank: 0 },
      ];
      for (const pattern of patterns) {
        const leg = {
          file: piece.square.file + pattern.legFile,
          rank: piece.square.rank + pattern.legRank,
        };
        if (pieceAt(board, leg)) {
          continue;
        }
        pushIfLandable(moves, board, piece, {
          file: piece.square.file + pattern.file,
          rank: piece.square.rank + pattern.rank,
        });
      }
      return moves;
    }
    case "elephant": {
      for (const fileDelta of [-2, 2]) {
        for (const rankDelta of [-2, 2]) {
          const destination = {
            file: piece.square.file + fileDelta,
            rank: piece.square.rank + rankDelta,
          };
          const staysHome = piece.side === "red" ? destination.rank <= 4 : destination.rank >= 5;
          const eye = {
            file: piece.square.file + fileDelta / 2,
            rank: piece.square.rank + rankDelta / 2,
          };
          if (staysHome && !pieceAt(board, eye)) {
            pushIfLandable(moves, board, piece, destination);
          }
        }
      }
      return moves;
    }
    case "advisor": {
      for (const fileDelta of [-1, 1]) {
        for (const rankDelta of [-1, 1]) {
          const destination = {
            file: piece.square.file + fileDelta,
            rank: piece.square.rank + rankDelta,
          };
          if (isInsidePalace(piece.side, destination)) {
            pushIfLandable(moves, board, piece, destination);
          }
        }
      }
      return moves;
    }
    case "general": {
      for (const direction of ORTHOGONAL_DIRECTIONS) {
        const destination = {
          file: piece.square.file + direction.file,
          rank: piece.square.rank + direction.rank,
        };
        if (isInsidePalace(piece.side, destination)) {
          pushIfLandable(moves, board, piece, destination);
        }
      }
      return moves;
    }
    case "soldier": {
      const forward = piece.side === "red" ? 1 : -1;
      pushIfLandable(moves, board, piece, {
        file: piece.square.file,
        rank: piece.square.rank + forward,
      });
      if (crossedRiver(piece.side, piece.square.rank)) {
        pushIfLandable(moves, board, piece, {
          file: piece.square.file - 1,
          rank: piece.square.rank,
        });
        pushIfLandable(moves, board, piece, {
          file: piece.square.file + 1,
          rank: piece.square.rank,
        });
      }
      return moves;
    }
  }
}

function countBetween(board: Board, from: Square, to: Square): number {
  const fileDelta = Math.sign(to.file - from.file);
  const rankDelta = Math.sign(to.rank - from.rank);
  let count = 0;
  let file = from.file + fileDelta;
  let rank = from.rank + rankDelta;
  while (file !== to.file || rank !== to.rank) {
    if (pieceAt(board, { file, rank })) {
      count += 1;
    }
    file += fileDelta;
    rank += rankDelta;
  }
  return count;
}

function attacksSquare(board: Board, piece: Piece, target: Square): boolean {
  const fileDistance = target.file - piece.square.file;
  const rankDistance = target.rank - piece.square.rank;
  const absoluteFile = Math.abs(fileDistance);
  const absoluteRank = Math.abs(rankDistance);

  switch (piece.role) {
    case "chariot":
      return (
        (fileDistance === 0 || rankDistance === 0) &&
        countBetween(board, piece.square, target) === 0
      );
    case "cannon":
      return (
        (fileDistance === 0 || rankDistance === 0) &&
        countBetween(board, piece.square, target) === 1
      );
    case "horse": {
      if (
        !((absoluteFile === 1 && absoluteRank === 2) || (absoluteFile === 2 && absoluteRank === 1))
      ) {
        return false;
      }
      const leg =
        absoluteRank === 2
          ? { file: piece.square.file, rank: piece.square.rank + Math.sign(rankDistance) }
          : { file: piece.square.file + Math.sign(fileDistance), rank: piece.square.rank };
      return !pieceAt(board, leg);
    }
    case "elephant": {
      if (absoluteFile !== 2 || absoluteRank !== 2) {
        return false;
      }
      const staysHome = piece.side === "red" ? target.rank <= 4 : target.rank >= 5;
      const eye = {
        file: piece.square.file + fileDistance / 2,
        rank: piece.square.rank + rankDistance / 2,
      };
      return staysHome && !pieceAt(board, eye);
    }
    case "advisor":
      return absoluteFile === 1 && absoluteRank === 1 && isInsidePalace(piece.side, target);
    case "general": {
      if (absoluteFile + absoluteRank === 1 && isInsidePalace(piece.side, target)) {
        return true;
      }
      const targetPiece = pieceAt(board, target);
      return (
        fileDistance === 0 &&
        targetPiece?.role === "general" &&
        targetPiece.side !== piece.side &&
        countBetween(board, piece.square, target) === 0
      );
    }
    case "soldier": {
      const forward = piece.side === "red" ? 1 : -1;
      if (fileDistance === 0 && rankDistance === forward) {
        return true;
      }
      return (
        crossedRiver(piece.side, piece.square.rank) && rankDistance === 0 && absoluteFile === 1
      );
    }
  }
}

function findGeneral(board: Board, side: Side): Piece | null {
  return board.find((piece) => piece?.side === side && piece.role === "general") ?? null;
}

function isInCheckOnBoard(board: Board, side: Side): boolean {
  const general = findGeneral(board, side);
  if (!general) {
    return true;
  }
  return board.some(
    (piece) => piece?.side === otherSide(side) && attacksSquare(board, piece, general.square),
  );
}

export function isInCheck(state: Pick<GameState, "board">, side: Side): boolean {
  return isInCheckOnBoard(state.board, side);
}

function movePiece(board: Board, piece: Piece, to: Square): Board {
  const next = [...board];
  next[boardIndex(piece.square)] = null;
  next[boardIndex(to)] = { ...piece, square: cloneSquare(to) };
  return next;
}

function legalMovesForPiece(board: Board, piece: Piece): Square[] {
  return pseudoMoves(board, piece).filter((destination) => {
    const nextBoard = movePiece(board, piece, destination);
    return !isInCheckOnBoard(nextBoard, piece.side);
  });
}

export function getLegalMoves(state: GameState, pieceId: string): Square[] {
  if (state.status.kind !== "playing") {
    return [];
  }
  const piece = state.board.find((candidate) => candidate?.id === pieceId);
  if (!piece || piece.side !== state.sideToMove) {
    return [];
  }
  return legalMovesForPiece(state.board, piece);
}

function sideHasLegalMove(board: Board, side: Side): boolean {
  return board.some((piece) => piece?.side === side && legalMovesForPiece(board, piece).length > 0);
}

export function formatSquareCoordinate(square: Square): string {
  return `${String.fromCharCode(97 + square.file)}${square.rank}`;
}

function notation(piece: Piece, from: Square, to: Square): string {
  const sideLabel = piece.side === "red" ? "红" : "黑";
  return `${sideLabel}·${ROLE_LABELS[piece.side][piece.role]} ${formatSquareCoordinate(from)} → ${formatSquareCoordinate(to)}`;
}

function rejected(
  state: GameState,
  code:
    | "stale-revision"
    | "game-over"
    | "invalid-square"
    | "no-piece"
    | "not-your-turn"
    | "illegal-move"
    | "cannot-undo",
  message: string,
): DispatchResult {
  return { state, events: [], error: { code, message } };
}

function eventId(revision: number, sequence: number): string {
  return `${revision}:${sequence}`;
}

function replayCommand(command: GameCommand): ReplayCommand {
  if (command.type === "move") {
    return { type: "move", from: cloneSquare(command.from), to: cloneSquare(command.to) };
  }
  if (command.type === "resign" && command.side) {
    return { type: "resign", side: command.side };
  }
  return { type: command.type };
}

function endedStatus(
  winner: Side | null,
  reason: Extract<GameStatus, { kind: "ended" }>["reason"],
): Extract<GameStatus, { kind: "ended" }> {
  return {
    kind: "ended",
    outcome: winner ? `${winner}-win` : "draw",
    winner,
    reason,
  };
}

function dispatchMove(
  state: GameState,
  command: Extract<GameCommand, { type: "move" }>,
): DispatchResult {
  if (state.status.kind === "ended") {
    return rejected(state, "game-over", "The game has already ended.");
  }
  if (!isSquare(command.from) || !isSquare(command.to)) {
    return rejected(state, "invalid-square", "Move coordinates must be on the 9 by 10 board.");
  }
  const piece = pieceAt(state.board, command.from);
  if (!piece) {
    return rejected(state, "no-piece", "There is no piece on the source square.");
  }
  if (piece.side !== state.sideToMove) {
    return rejected(
      state,
      "not-your-turn",
      "The selected piece does not belong to the side to move.",
    );
  }
  const legal = getLegalMoves(state, piece.id);
  if (!legal.some((square) => sameSquare(square, command.to))) {
    return rejected(state, "illegal-move", "The destination is not legal for the selected piece.");
  }

  const target = pieceAt(state.board, command.to);
  if (target?.role === "general") {
    return rejected(
      state,
      "illegal-move",
      "Generals are never captured; mate ends the game first.",
    );
  }
  const captured: CapturedPiece | null = target
    ? { ...target, square: cloneSquare(target.square) }
    : null;
  const nextBoard = movePiece(state.board, piece, command.to);
  const nextSide = otherSide(state.sideToMove);
  const nextRevision = state.revision + 1;
  const nextNoCapturePlies = captured ? 0 : state.noCapturePlies + 1;
  const positionKey = getPositionKey({
    board: nextBoard,
    sideToMove: nextSide,
    rulesetId: state.rulesetId,
  });
  const nextRepetitionCounts = {
    ...state.repetitionCounts,
    [positionKey]: (state.repetitionCounts[positionKey] ?? 0) + 1,
  };
  const inCheck = isInCheckOnBoard(nextBoard, nextSide);
  const hasMove = sideHasLegalMove(nextBoard, nextSide);

  let status: GameStatus;
  if (!hasMove) {
    status = endedStatus(state.sideToMove, inCheck ? "checkmate" : "stalemate");
  } else if ((nextRepetitionCounts[positionKey] ?? 0) >= 3) {
    status = endedStatus(null, "repetition");
  } else if (nextNoCapturePlies >= 100) {
    status = endedStatus(null, "no-capture");
  } else {
    status = { kind: "playing", check: inCheck ? nextSide : null };
  }

  const move: MoveRecord = {
    revision: nextRevision,
    pieceId: piece.id,
    side: piece.side,
    role: piece.role,
    from: cloneSquare(command.from),
    to: cloneSquare(command.to),
    captured,
    notation: notation(piece, command.from, command.to),
    beforeNoCapturePlies: state.noCapturePlies,
    beforeRepetitionCounts: state.repetitionCounts,
    beforeStatus: state.status,
  };
  const nextState: GameState = {
    ...state,
    board: nextBoard,
    sideToMove: nextSide,
    revision: nextRevision,
    noCapturePlies: nextNoCapturePlies,
    history: [...state.history, move],
    repetitionCounts: nextRepetitionCounts,
    status,
    lastAction: { kind: "move", move },
    commandLog: [...state.commandLog, replayCommand(command)],
  };

  const events: DomainEvent[] = [
    { type: "MoveCommitted", revision: nextRevision, eventId: eventId(nextRevision, 0), move },
  ];
  if (captured) {
    events.push({
      type: "PieceCaptured",
      revision: nextRevision,
      eventId: eventId(nextRevision, events.length),
      piece: captured,
      byPieceId: piece.id,
    });
  }
  if (inCheck) {
    events.push({
      type: "CheckDeclared",
      revision: nextRevision,
      eventId: eventId(nextRevision, events.length),
      side: nextSide,
      byPieceId: piece.id,
    });
  }
  if (status.kind === "ended") {
    events.push({
      type: "GameEnded",
      revision: nextRevision,
      eventId: eventId(nextRevision, events.length),
      status,
    });
  }
  return { state: nextState, events };
}

function dispatchUndo(
  state: GameState,
  command: Extract<GameCommand, { type: "undo" }>,
): DispatchResult {
  if (state.lastAction?.kind !== "move") {
    return rejected(state, "cannot-undo", "Only the immediately preceding move can be undone.");
  }
  const move = state.history.at(-1);
  if (!move) {
    return rejected(state, "cannot-undo", "There is no move to undo.");
  }
  const movedPiece = pieceAt(state.board, move.to);
  if (!movedPiece || movedPiece.id !== move.pieceId) {
    return rejected(state, "cannot-undo", "The board no longer matches the move being undone.");
  }
  const board = [...state.board];
  board[boardIndex(move.to)] = move.captured
    ? { ...move.captured, square: cloneSquare(move.captured.square) }
    : null;
  board[boardIndex(move.from)] = { ...movedPiece, square: cloneSquare(move.from) };
  const revision = state.revision + 1;
  const nextState: GameState = {
    ...state,
    board,
    sideToMove: move.side,
    revision,
    noCapturePlies: move.beforeNoCapturePlies,
    history: state.history.slice(0, -1),
    repetitionCounts: move.beforeRepetitionCounts,
    status: move.beforeStatus,
    lastAction: { kind: "undo", move },
    commandLog: [...state.commandLog, replayCommand(command)],
  };
  return {
    state: nextState,
    events: [{ type: "MoveUndone", revision, eventId: eventId(revision, 0), move }],
  };
}

function dispatchResign(
  state: GameState,
  command: Extract<GameCommand, { type: "resign" }>,
): DispatchResult {
  if (state.status.kind === "ended") {
    return rejected(state, "game-over", "The game has already ended.");
  }
  const resigningSide = command.side ?? state.sideToMove;
  const revision = state.revision + 1;
  const status = endedStatus(otherSide(resigningSide), "resignation");
  const nextState: GameState = {
    ...state,
    revision,
    status,
    lastAction: { kind: "resign", side: resigningSide },
    commandLog: [...state.commandLog, replayCommand(command)],
  };
  return {
    state: nextState,
    events: [
      { type: "Resigned", revision, eventId: eventId(revision, 0), side: resigningSide },
      { type: "GameEnded", revision, eventId: eventId(revision, 1), status },
    ],
  };
}

export function dispatch(state: GameState, command: GameCommand): DispatchResult {
  if (command.expectedRevision !== state.revision) {
    return rejected(state, "stale-revision", "The command was created for an older game revision.");
  }
  switch (command.type) {
    case "move":
      return dispatchMove(state, command);
    case "undo":
      return dispatchUndo(state, command);
    case "resign":
      return dispatchResign(state, command);
  }
}
