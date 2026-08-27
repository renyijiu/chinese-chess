import type { OpponentCoordinatorPhase } from "../ai/OpponentCoordinator";
import type { DomainEvent, GameCommand, GameState, Side } from "../../../lib/xiangqi/index";
import type { SavedMatch } from "./match";

export type GameActionTransition = Readonly<{
  actionId: string;
  before: GameState;
  after: GameState;
  events: readonly DomainEvent[];
  reducedMotion: boolean;
  /** Board-view perspective captured when the command was accepted. */
  viewSide: Side;
}>;

/** A Promise keeps board input locked for the handler's full visual timeline. */
export type GameActionHandler = (
  transition: GameActionTransition,
) => void | Promise<void>;

export type GamePhase = "menu" | "playing";

export function isComputerTurn(match: SavedMatch): boolean {
  return match.config.mode === "computer"
    && match.game.status.kind === "playing"
    && match.game.sideToMove !== match.config.humanSide;
}

export function canIssueHumanCommand(match: SavedMatch, command: GameCommand): boolean {
  if (match.config.mode === "local") return true;
  if (command.type === "undo") return false;
  const locallyControlledSide = match.config.mode === "computer"
    ? match.config.humanSide
    : match.config.localSide;
  return match.game.status.kind === "playing"
    && match.game.sideToMove === locallyControlledSide;
}

export function shouldRequestOpponentTurn(
  match: SavedMatch,
  phase: GamePhase,
  coordinatorPhase: OpponentCoordinatorPhase,
  generation?: number,
  lastRequestKey: string | null = null,
): boolean {
  if (!(phase === "playing"
    && coordinatorPhase === "ready"
    && isComputerTurn(match))) return false;
  return generation === undefined
    || opponentTurnRequestKey(match, generation) !== lastRequestKey;
}

export function opponentTurnRequestKey(match: SavedMatch, generation: number): string | null {
  if (match.config.mode !== "computer" || !isComputerTurn(match)) return null;
  return [
    match.config.matchId,
    generation,
    match.revision,
    match.game.sideToMove,
  ].join(":");
}

export function deriveBoardCommandsLocked(input: Readonly<{
  phase: GamePhase;
  commandBusy: boolean;
  computerOwnsTurn: boolean;
  confirmationOpen: boolean;
  terminal: boolean;
}>): boolean {
  return input.phase !== "playing"
    || input.commandBusy
    || input.computerOwnsTurn
    || input.confirmationOpen
    || input.terminal;
}
