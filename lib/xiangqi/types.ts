export const XIANGQI_SCHEMA_VERSION = 1 as const;
export const POPULAR_RULESET_ID = "popular-v1" as const;

export type Side = "red" | "black";

export type Role =
  | "general"
  | "advisor"
  | "elephant"
  | "chariot"
  | "horse"
  | "cannon"
  | "soldier";

export interface Square {
  readonly file: number;
  readonly rank: number;
}

export interface Piece {
  readonly id: string;
  readonly side: Side;
  readonly role: Role;
  readonly square: Square;
}

export type Board = ReadonlyArray<Piece | null>;

export type GameEndReason =
  | "checkmate"
  | "stalemate"
  | "repetition"
  | "no-capture"
  | "resignation";

export type GameStatus =
  | {
      readonly kind: "playing";
      readonly check: Side | null;
    }
  | {
      readonly kind: "ended";
      readonly outcome: "red-win" | "black-win" | "draw";
      readonly winner: Side | null;
      readonly reason: GameEndReason;
    };

export interface CapturedPiece {
  readonly id: string;
  readonly side: Side;
  readonly role: Role;
  readonly square: Square;
}

export interface MoveRecord {
  readonly revision: number;
  readonly pieceId: string;
  readonly side: Side;
  readonly role: Role;
  readonly from: Square;
  readonly to: Square;
  readonly captured: CapturedPiece | null;
  readonly notation: string;
  readonly beforeNoCapturePlies: number;
  readonly beforeRepetitionCounts: Readonly<Record<string, number>>;
  readonly beforeStatus: GameStatus;
}

export type ReplayCommand =
  | {
      readonly type: "move";
      readonly from: Square;
      readonly to: Square;
    }
  | { readonly type: "undo" }
  | { readonly type: "resign"; readonly side?: Side };

export type LastAction =
  | {
      readonly kind: "move";
      readonly move: MoveRecord;
    }
  | {
      readonly kind: "undo";
      readonly move: MoveRecord;
    }
  | {
      readonly kind: "resign";
      readonly side: Side;
    }
  | null;

export interface GameState {
  readonly schemaVersion: typeof XIANGQI_SCHEMA_VERSION;
  readonly rulesetId: typeof POPULAR_RULESET_ID;
  readonly initialPosition: "standard";
  readonly board: Board;
  readonly sideToMove: Side;
  readonly revision: number;
  readonly noCapturePlies: number;
  readonly history: ReadonlyArray<MoveRecord>;
  readonly repetitionCounts: Readonly<Record<string, number>>;
  readonly status: GameStatus;
  readonly lastAction: LastAction;
  readonly commandLog: ReadonlyArray<ReplayCommand>;
}

interface RevisionedCommand {
  readonly expectedRevision: number;
}

export interface MoveCommand extends RevisionedCommand {
  readonly type: "move";
  readonly from: Square;
  readonly to: Square;
}

export interface UndoCommand extends RevisionedCommand {
  readonly type: "undo";
}

export interface ResignCommand extends RevisionedCommand {
  readonly type: "resign";
  readonly side?: Side;
}

export type GameCommand = MoveCommand | UndoCommand | ResignCommand;

interface EventBase {
  readonly revision: number;
  readonly eventId: string;
}

export interface MoveCommittedEvent extends EventBase {
  readonly type: "MoveCommitted";
  readonly move: MoveRecord;
}

export interface PieceCapturedEvent extends EventBase {
  readonly type: "PieceCaptured";
  readonly piece: CapturedPiece;
  readonly byPieceId: string;
}

export interface CheckDeclaredEvent extends EventBase {
  readonly type: "CheckDeclared";
  readonly side: Side;
  readonly byPieceId: string;
}

export interface MoveUndoneEvent extends EventBase {
  readonly type: "MoveUndone";
  readonly move: MoveRecord;
}

export interface ResignedEvent extends EventBase {
  readonly type: "Resigned";
  readonly side: Side;
}

export interface GameEndedEvent extends EventBase {
  readonly type: "GameEnded";
  readonly status: Extract<GameStatus, { kind: "ended" }>;
}

export type DomainEvent =
  | MoveCommittedEvent
  | PieceCapturedEvent
  | CheckDeclaredEvent
  | MoveUndoneEvent
  | ResignedEvent
  | GameEndedEvent;

export type CommandErrorCode =
  | "stale-revision"
  | "game-over"
  | "invalid-square"
  | "no-piece"
  | "not-your-turn"
  | "illegal-move"
  | "cannot-undo";

export interface CommandError {
  readonly code: CommandErrorCode;
  readonly message: string;
}

export type DispatchResult =
  | {
      readonly state: GameState;
      readonly events: ReadonlyArray<DomainEvent>;
      readonly error?: undefined;
    }
  | {
      readonly state: GameState;
      readonly events: readonly [];
      readonly error: CommandError;
    };
