import { describe, expect, it } from "vitest";

import {
  BOARD_SPACING,
  BOARD_SURFACE_Y,
  interpolateSquareToWorld,
  squareToWorld,
} from "../../../components/xiangqi/runtime/board-coordinates";

describe("squareToWorld", () => {
  it("keeps the complete 90-square world-coordinate contract frozen", () => {
    expect(BOARD_SPACING).toBe(1.14);
    expect(BOARD_SURFACE_Y).toBe(0.69);

    for (let rank = 0; rank < 10; rank += 1) {
      for (let file = 0; file < 9; file += 1) {
        expect(squareToWorld({ file, rank })).toEqual([
          (file - 4) * 1.14,
          0.69,
          (4.5 - rank) * 1.14,
        ]);
      }
    }
  });

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

describe("interpolateSquareToWorld", () => {
  it.each([
    ["red forward", { file: 0, rank: 3 }, { file: 0, rank: 4 }],
    ["black forward", { file: 0, rank: 6 }, { file: 0, rank: 5 }],
    ["lateral", { file: 0, rank: 0 }, { file: 8, rank: 0 }],
    ["long chariot move", { file: 0, rank: 0 }, { file: 0, rank: 8 }],
    ["undo direction", { file: 0, rank: 4 }, { file: 0, rank: 3 }],
  ] as const)("moves %s monotonically from start to destination", (_label, from, to) => {
    const start = squareToWorld(from);
    const end = squareToWorld(to);
    const samples = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      interpolateSquareToWorld(from, to, progress),
    );

    expect(samples[0]).toEqual(start);
    expect(samples.at(-1)).toEqual(end);
    samples.forEach((position, index) => {
      const progress = index / (samples.length - 1);
      expect(position[0]).toBeCloseTo(start[0] + (end[0] - start[0]) * progress, 12);
      expect(position[1]).toBe(BOARD_SURFACE_Y);
      expect(position[2]).toBeCloseTo(start[2] + (end[2] - start[2]) * progress, 12);
      expect(position[0]).toBeGreaterThanOrEqual(Math.min(start[0], end[0]));
      expect(position[0]).toBeLessThanOrEqual(Math.max(start[0], end[0]));
      expect(position[2]).toBeGreaterThanOrEqual(Math.min(start[2], end[2]));
      expect(position[2]).toBeLessThanOrEqual(Math.max(start[2], end[2]));
    });
  });

  it("clamps invalid and out-of-range progress instead of overshooting", () => {
    const from = { file: 0, rank: 3 };
    const to = { file: 0, rank: 4 };
    expect(interpolateSquareToWorld(from, to, -1)).toEqual(squareToWorld(from));
    expect(interpolateSquareToWorld(from, to, Number.NaN)).toEqual(squareToWorld(from));
    expect(interpolateSquareToWorld(from, to, 2)).toEqual(squareToWorld(to));
  });
});
