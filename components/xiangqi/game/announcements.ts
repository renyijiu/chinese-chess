import {
  getPieceAt,
  type CommandErrorCode,
  type DomainEvent,
  type GameState,
  type Role,
  type Square,
} from "../../../lib/xiangqi/index";

const SIDE_LABELS = { red: "红方", black: "黑方" } as const;
const END_REASON_LABELS = {
  checkmate: "将死",
  stalemate: "困毙",
  repetition: "三次重复局面",
  "no-capture": "连续 100 手无吃子",
  resignation: "认输",
} as const;

const ERROR_MESSAGES: Readonly<Record<CommandErrorCode, string>> = Object.freeze({
  "stale-revision": "这次操作已过期，请重新选择棋子。",
  "game-over": "棋局已经结束。",
  "invalid-square": "该交叉点不在棋盘范围内。",
  "no-piece": "起点没有棋子。",
  "not-your-turn": "现在轮到另一方行动。",
  "illegal-move": "该落点不符合当前局面的规则。",
  "cannot-undo": "当前不能再次悔棋。",
});

const ROLE_LABELS: Readonly<Record<Role, string>> = Object.freeze({
  advisor: "仕士",
  cannon: "炮",
  chariot: "车",
  elephant: "相象",
  general: "帅将",
  horse: "马",
  soldier: "兵卒",
});

export function commandErrorMessage(code: CommandErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function formatGameOutcome(game: GameState): string {
  if (game.status.kind !== "ended") return "棋局进行中";
  const reason = END_REASON_LABELS[game.status.reason];
  return game.status.winner
    ? `${SIDE_LABELS[game.status.winner]}胜 · ${reason}`
    : `和棋 · ${reason}`;
}

export function eventAnnouncement(events: readonly DomainEvent[], game: GameState): string {
  const ended = events.find((event) => event.type === "GameEnded");
  if (ended) return formatGameOutcome(game);
  const undone = events.find((event) => event.type === "MoveUndone");
  if (undone?.type === "MoveUndone") return `已撤回 ${undone.move.notation}`;
  const move = events.find((event) => event.type === "MoveCommitted");
  const captured = events.some((event) => event.type === "PieceCaptured");
  const check = events.find((event) => event.type === "CheckDeclared");
  if (move?.type === "MoveCommitted") {
    const suffix = check?.type === "CheckDeclared" ? "，将军" : captured ? "，完成吃子" : "";
    return `${move.move.notation}${suffix}`;
  }
  return "棋局状态已更新。";
}

export function describeKeyboardSquare(game: GameState, square: Square): string {
  const piece = getPieceAt(game, square);
  if (!piece) return "空交叉点";
  return `${piece.side === "red" ? "红方" : "黑方"}${ROLE_LABELS[piece.role]}`;
}
