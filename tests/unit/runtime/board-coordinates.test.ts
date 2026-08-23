import { describe, expect, it } from "vitest";

import {
  BOARD_SPACING,
  BOARD_SURFACE_Y,
  squareToWorld,
} from "../../../components/xiangqi/runtime/board-coordinates";

describe("squareToWorld", () => {
  it("maps the red home rank to the near, positive-Z edge", () => {
    expect(squareToWorld({ file: 4, rank: 0 })).toEqual([0, BOARD_SURFACE_Y, 4.5 * BOARD_SPACING]);
  });

  it("maps the black home rank to the far, negative-Z edge", () => {
    expect(squareToWorld({ file: 4, rank: 9 })).toEqual([0, BOARD_SURFACE_Y, -4.5 * BOARD_SPACING]);
  });

  it("maps file zero to the left edge from the red viewpoint", () => {
    expect(squareToWorld({ file: 0, rank: 0 })).toEqual([
      -4 * BOARD_SPACING,
      BOARD_SURFACE_Y,
      4.5 * BOARD_SPACING,
    ]);
  });

  it("rejects coordinates outside the 9 by 10 board", () => {
    expect(() => squareToWorld({ file: -1, rank: 0 })).toThrow(/file/i);
    expect(() => squareToWorld({ file: 0, rank: 10 })).toThrow(/rank/i);
    expect(() => squareToWorld({ file: 0.5, rank: 3 })).toThrow(/integer/i);
  });
});
