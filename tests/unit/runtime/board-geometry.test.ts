import { describe, expect, it } from "vitest";

import {
  BOARD_HIT_RADIUS,
  BOARD_ORNAMENT_MARGIN,
  PIECE_FOOTPRINT_DIAMETER,
  makeBoardOrnamentPlacements,
  makeBoardSegments,
} from "../../../components/xiangqi/scene/board-geometry";
import {
  BOARD_FILE_POSITIONS,
  BOARD_RANK_POSITIONS,
  BOARD_SPACING,
  squareToWorld,
} from "../../../components/xiangqi/runtime/board-coordinates";

type Point = readonly [number, number];

function segmentMatches(
  segment: readonly [Point, Point],
  start: Point,
  end: Point,
) {
  return (
    (segment[0][0] === start[0]
      && segment[0][1] === start[1]
      && segment[1][0] === end[0]
      && segment[1][1] === end[1])
    || (segment[0][0] === end[0]
      && segment[0][1] === end[1]
      && segment[1][0] === start[0]
      && segment[1][1] === start[1])
  );
}

function segmentLength(segment: readonly [Point, Point]) {
  return Math.hypot(
    segment[1][0] - segment[0][0],
    segment[1][1] - segment[0][1],
  );
}

describe("Qin board geometry", () => {
  it("preserves all ranks, river-broken files, palace diagonals, and corner marks", () => {
    const segments = makeBoardSegments();
    const fileMin = Math.min(...BOARD_FILE_POSITIONS);
    const fileMax = Math.max(...BOARD_FILE_POSITIONS);
    const rankMin = Math.min(...BOARD_RANK_POSITIONS);
    const rankMax = Math.max(...BOARD_RANK_POSITIONS);
    const ascendingRanks = [...BOARD_RANK_POSITIONS].sort((a, b) => a - b);

    for (const rank of BOARD_RANK_POSITIONS) {
      expect(segments.some((segment) => segmentMatches(segment, [fileMin, rank], [fileMax, rank]))).toBe(true);
    }

    for (const [index, file] of BOARD_FILE_POSITIONS.entries()) {
      if (index === 0 || index === BOARD_FILE_POSITIONS.length - 1) {
        expect(segments.some((segment) => segmentMatches(segment, [file, rankMin], [file, rankMax]))).toBe(true);
      } else {
        expect(segments.some((segment) => segmentMatches(segment, [file, rankMin], [file, ascendingRanks[4]!]))).toBe(true);
        expect(segments.some((segment) => segmentMatches(segment, [file, ascendingRanks[5]!], [file, rankMax]))).toBe(true);
        expect(segments.some((segment) => segmentMatches(segment, [file, rankMin], [file, rankMax]))).toBe(false);
      }
    }

    const palaceDiagonals = [
      [[-BOARD_SPACING, rankMin], [BOARD_SPACING, ascendingRanks[2]!]],
      [[BOARD_SPACING, rankMin], [-BOARD_SPACING, ascendingRanks[2]!]],
      [[-BOARD_SPACING, ascendingRanks[7]!], [BOARD_SPACING, rankMax]],
      [[BOARD_SPACING, ascendingRanks[7]!], [-BOARD_SPACING, rankMax]],
    ] as const;
    for (const [start, end] of palaceDiagonals) {
      expect(segments.some((segment) => segmentMatches(segment, start, end))).toBe(true);
    }

    expect(segments.filter((segment) => segmentLength(segment) < 0.13)).toHaveLength(96);
    expect(segments).toHaveLength(126);
  });

  it("returns deterministic non-interactive Qin ornaments outside every square footprint", () => {
    const first = makeBoardOrnamentPlacements();
    const second = makeBoardOrnamentPlacements();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(new Set(first.map(({ kind }) => kind))).toEqual(new Set([
      "brick-impression",
      "gate-cue",
      "tile-medallion",
      "water-swirl",
    ]));

    for (const ornament of first) {
      expect(ornament.interactive).toBe(false);
      for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
          const [x, , z] = squareToWorld({ file, rank });
          const distance = Math.hypot(ornament.position[0] - x, ornament.position[1] - z);
          expect(distance).toBeGreaterThanOrEqual(
            BOARD_HIT_RADIUS + ornament.footprintRadius + BOARD_ORNAMENT_MARGIN,
          );
          expect(distance).toBeGreaterThanOrEqual(
            PIECE_FOOTPRINT_DIAMETER / 2 + ornament.footprintRadius + BOARD_ORNAMENT_MARGIN,
          );
        }
      }
    }
  });
});
