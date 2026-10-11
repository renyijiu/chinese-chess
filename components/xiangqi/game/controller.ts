import {
  getLegalMoves,
  getPieceAt,
  type GameState,
  type MoveCommand,
  type Square,
} from "../../../lib/xiangqi/index";

export type GameSelection = Readonly<{
  pieceId: string | null;
  legalMoves: readonly Square[];
}>;

export type BoardClickDecision =
  | Readonly<{
      kind: "selection";
      selection: GameSelection;
      announcement: string;
    }>
  | Readonly<{
      kind: "move";
      command: MoveCommand;
    }>;

export const EMPTY_SELECTION: GameSelection = Object.freeze({
  pieceId: null,
  legalMoves: Object.freeze([]),
});

const KEYBOARD_DELTAS: Readonly<Record<string, readonly [file: number, rank: number]>> =
  Object.freeze({
    arrowdown: [0, -1],
    arrowleft: [-1, 0],
    arrowright: [1, 0],
    arrowup: [0, 1],
    a: [-1, 0],
    d: [1, 0],
    s: [0, -1],
    w: [0, 1],
  });

function sameSquare(left: Square, right: Square) {
  return left.file === right.file && left.rank === right.rank;
}

export function moveKeyboardCursor(square: Square, key: string): Square {
  const delta = KEYBOARD_DELTAS[key.toLowerCase()];
  if (!delta) return square;
  return {
    file: Math.min(8, Math.max(0, square.file + delta[0])),
    rank: Math.min(9, Math.max(0, square.rank + delta[1])),
  };
}

export function isKeyboardNavigationKey(key: string): boolean {
  return KEYBOARD_DELTAS[key.toLowerCase()] !== undefined;
}

export function deriveSelection(game: GameState, pieceId: string | null): GameSelection {
  if (!pieceId || game.status.kind !== "playing") return EMPTY_SELECTION;
  const piece = game.board.find((candidate) => candidate?.id === pieceId);
  if (!piece || piece.side !== game.sideToMove) return EMPTY_SELECTION;
  return { pieceId, legalMoves: getLegalMoves(game, pieceId) };
}

export function resolveBoardClick(
  game: GameState,
  selection: GameSelection,
  square: Square,
): BoardClickDecision {
  if (game.status.kind !== "playing") {
    return {
      kind: "selection",
      selection: EMPTY_SELECTION,
      announcement: "棋局已经结束，请开始新局或查看当前棋盘。",
    };
  }

  const selectedPiece = selection.pieceId
    ? (game.board.find((candidate) => candidate?.id === selection.pieceId) ?? null)
    : null;

  if (
    selectedPiece &&
    selection.legalMoves.some((destination) => sameSquare(destination, square))
  ) {
    return {
      kind: "move",
      command: {
        type: "move",
        expectedRevision: game.revision,
        from: selectedPiece.square,
        to: square,
      },
    };
  }

  const target = getPieceAt(game, square);
  if (target?.side === game.sideToMove) {
    if (target.id === selection.pieceId) {
      return {
        kind: "selection",
        selection: EMPTY_SELECTION,
        announcement: "已取消选择。",
      };
    }
    const nextSelection = deriveSelection(game, target.id);
    return {
      kind: "selection",
      selection: nextSelection,
      announcement: `已选择${target.side === "red" ? "红方" : "黑方"}棋子，共 ${nextSelection.legalMoves.length} 个合法落点。`,
    };
  }

  if (selection.pieceId) {
    return {
      kind: "selection",
      selection,
      announcement: target ? "这枚棋子现在吃不到。" : "这里不能落子。",
    };
  }

  return {
    kind: "selection",
    selection: EMPTY_SELECTION,
    announcement: target ? "还没轮到这一方走棋。" : "请先选一枚要走的棋子。",
  };
}
