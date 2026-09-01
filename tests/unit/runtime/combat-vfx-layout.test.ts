import { describe, expect, it } from "vitest";

import {
  BOARD_SPACING,
  BOARD_SURFACE_Y,
  squareToWorld,
} from "../../../components/xiangqi/runtime/board-coordinates";
import {
  COMBAT_VFX_GROUND_CLEARANCE,
  COMBAT_VFX_PAYLOAD_BASE_HEIGHT,
  COMBAT_VFX_RING_INNER_RADIUS,
  COMBAT_VFX_RING_OUTER_RADIUS,
  elevatedSquareToWorld,
  resolveCombatPayloadWorldPosition,
} from "../../../components/xiangqi/vfx/combat-vfx-layout";

describe("combat VFX layout", () => {
  it("places telegraph and impact rings above the board and outside a piece base", () => {
    const square = { file: 4, rank: 4 };
    expect(elevatedSquareToWorld(square, COMBAT_VFX_GROUND_CLEARANCE)).toEqual([
      squareToWorld(square)[0],
      BOARD_SURFACE_Y + COMBAT_VFX_GROUND_CLEARANCE,
      squareToWorld(square)[2],
    ]);
    expect(COMBAT_VFX_RING_INNER_RADIUS).toBeGreaterThan(0.445);
    expect(COMBAT_VFX_RING_OUTER_RADIUS).toBeLessThan(BOARD_SPACING / 2);
    expect(COMBAT_VFX_RING_OUTER_RADIUS - COMBAT_VFX_RING_INNER_RADIUS).toBeGreaterThanOrEqual(0.1);
  });

  it("keeps the attack payload above the bases while following the board path", () => {
    const from = { file: 0, rank: 3 };
    const to = { file: 0, rank: 6 };
    const start = squareToWorld(from);
    const end = squareToWorld(to);
    const samples = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      resolveCombatPayloadWorldPosition(from, to, progress),
    );

    expect(samples[0]).toEqual([
      start[0],
      BOARD_SURFACE_Y + COMBAT_VFX_PAYLOAD_BASE_HEIGHT,
      start[2],
    ]);
    expect(samples.at(-1)).toEqual([
      end[0],
      BOARD_SURFACE_Y + COMBAT_VFX_PAYLOAD_BASE_HEIGHT,
      end[2],
    ]);
    samples.forEach((position) => {
      expect(position[1]).toBeGreaterThanOrEqual(BOARD_SURFACE_Y + COMBAT_VFX_PAYLOAD_BASE_HEIGHT);
      expect(position[2]).toBeGreaterThanOrEqual(Math.min(start[2], end[2]));
      expect(position[2]).toBeLessThanOrEqual(Math.max(start[2], end[2]));
    });
    expect(samples[2]![1]).toBeGreaterThan(samples[0]![1]);
  });

  it("clamps payload progress so a delayed frame cannot overshoot the target", () => {
    const from = { file: 0, rank: 3 };
    const to = { file: 0, rank: 6 };
    expect(resolveCombatPayloadWorldPosition(from, to, -1)).toEqual(
      resolveCombatPayloadWorldPosition(from, to, 0),
    );
    expect(resolveCombatPayloadWorldPosition(from, to, 2)).toEqual(
      resolveCombatPayloadWorldPosition(from, to, 1),
    );
  });
});
