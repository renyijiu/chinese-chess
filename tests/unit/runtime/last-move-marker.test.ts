import { describe, expect, it } from "vitest";

import {
  LAST_MOVE_MARKER_HEIGHT,
  resolveLastMoveMarkerGeometry,
} from "../../../components/xiangqi/game/last-move-marker";
import { BOARD_SPACING } from "../../../components/xiangqi/runtime/board-coordinates";
import type { MoveRecord } from "../../../lib/xiangqi/index";

function move(from: MoveRecord["from"], to: MoveRecord["to"]): MoveRecord {
  return {
    revision: 2,
    pieceId: "black:cannon:0",
    side: "black",
    role: "cannon",
    from,
    to,
    captured: {
      id: "red:horse:0",
      side: "red",
      role: "horse",
      square: to,
    },
    notation: "黑·砲 b7 → b0",
    beforeNoCapturePlies: 1,
    beforeRepetitionCounts: {},
    beforeStatus: { kind: "playing", check: null },
  };
}

describe("last move marker geometry", () => {
  it("connects the authoritative source and destination without overshoot", () => {
    const geometry = resolveLastMoveMarkerGeometry(
      move({ file: 1, rank: 7 }, { file: 1, rank: 0 }),
    );
    expect(geometry).not.toBeNull();
    if (!geometry) throw new Error("expected a visible last-move marker");

    expect(geometry.start[1]).toBe(LAST_MOVE_MARKER_HEIGHT);
    expect(geometry.end[1]).toBe(LAST_MOVE_MARKER_HEIGHT);
    expect(geometry.midpoint).toEqual([
      geometry.start[0],
      LAST_MOVE_MARKER_HEIGHT,
      (geometry.start[2] + geometry.end[2]) / 2,
    ]);
    expect(geometry.length).toBeCloseTo(BOARD_SPACING * 7, 12);
    expect(geometry.capture).toBe(true);
    expect(geometry.side).toBe("black");
  });

  it("returns null for a zero-distance defensive input", () => {
    expect(
      resolveLastMoveMarkerGeometry(move({ file: 4, rank: 4 }, { file: 4, rank: 4 })),
    ).toBeNull();
  });
});
