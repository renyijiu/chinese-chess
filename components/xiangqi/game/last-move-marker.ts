import type { MoveRecord, Side } from "../../../lib/xiangqi/index";
import { BOARD_SURFACE_Y, squareToWorld, type WorldPosition } from "../runtime/board-coordinates";

export const LAST_MOVE_MARKER_HEIGHT = BOARD_SURFACE_Y + 0.052;

type LastMoveMarkerGeometry = Readonly<{
  capture: boolean;
  direction: WorldPosition;
  end: WorldPosition;
  length: number;
  midpoint: WorldPosition;
  side: Side;
  start: WorldPosition;
}>;

export function resolveLastMoveMarkerGeometry(move: MoveRecord): LastMoveMarkerGeometry | null {
  const [startX, , startZ] = squareToWorld(move.from);
  const [endX, , endZ] = squareToWorld(move.to);
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const length = Math.hypot(deltaX, deltaZ);
  if (length <= Number.EPSILON) return null;
  return {
    capture: Boolean(move.captured),
    direction: [deltaX / length, 0, deltaZ / length],
    end: [endX, LAST_MOVE_MARKER_HEIGHT, endZ],
    length,
    midpoint: [startX + deltaX / 2, LAST_MOVE_MARKER_HEIGHT, startZ + deltaZ / 2],
    side: move.side,
    start: [startX, LAST_MOVE_MARKER_HEIGHT, startZ],
  };
}
