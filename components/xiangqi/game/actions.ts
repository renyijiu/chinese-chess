import type { DomainEvent, GameState, Side } from "../../../lib/xiangqi/index";

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
