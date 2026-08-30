import {
  BOARD_SPACING,
  squareToWorld,
  type BoardSquare,
  type WorldPosition,
} from "../runtime/board-coordinates";

export const COMBAT_VFX_GROUND_CLEARANCE = 0.045;
export const COMBAT_VFX_RING_INNER_RADIUS = 0.46;
export const COMBAT_VFX_RING_OUTER_RADIUS = 0.56;
export const COMBAT_VFX_PAYLOAD_BASE_HEIGHT = 0.46;
export const COMBAT_VFX_PAYLOAD_ARC_HEIGHT = 0.28;

if (COMBAT_VFX_RING_OUTER_RADIUS >= BOARD_SPACING / 2) {
  throw new Error("Combat VFX must not cover an adjacent board intersection");
}

export function elevatedSquareToWorld(
  square: BoardSquare,
  height: number,
): WorldPosition {
  const [x, y, z] = squareToWorld(square);
  return [x, y + Math.max(0, height), z];
}

export function resolveCombatPayloadWorldPosition(
  from: BoardSquare,
  to: BoardSquare,
  progress: number,
): WorldPosition {
  const start = squareToWorld(from);
  const end = squareToWorld(to);
  const amount = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const arc = Math.sin(amount * Math.PI) * COMBAT_VFX_PAYLOAD_ARC_HEIGHT;
  if (amount === 0) {
    return [start[0], start[1] + COMBAT_VFX_PAYLOAD_BASE_HEIGHT, start[2]];
  }
  if (amount === 1) {
    return [end[0], end[1] + COMBAT_VFX_PAYLOAD_BASE_HEIGHT, end[2]];
  }

  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + COMBAT_VFX_PAYLOAD_BASE_HEIGHT + arc,
    start[2] + (end[2] - start[2]) * amount,
  ];
}
