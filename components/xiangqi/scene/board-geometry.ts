import {
  BOARD_FILE_POSITIONS,
  BOARD_RANK_POSITIONS,
  BOARD_SPACING,
} from "../runtime/board-coordinates";

export type BoardPoint = readonly [x: number, z: number];
export type BoardSegment = readonly [start: BoardPoint, end: BoardPoint];

export type BoardOrnamentKind =
  | "brick-impression"
  | "gate-cue"
  | "tile-medallion"
  | "water-swirl";

export type BoardOrnamentPlacement = Readonly<{
  footprintRadius: number;
  interactive: false;
  kind: BoardOrnamentKind;
  position: BoardPoint;
  rotation: number;
  scale: readonly [x: number, z: number];
}>;

export type ClayTilePlacement = Readonly<{
  position: BoardPoint;
  rotation: number;
}>;

export type EnclosureWallPlacement = Readonly<{
  position: BoardPoint;
  scale: readonly [x: number, y: number, z: number];
}>;

export const BOARD_HIT_RADIUS = 0.52;
export const PIECE_FOOTPRINT_DIAMETER = 0.98;
export const BOARD_ORNAMENT_MARGIN = 0.06;

const FILE_MIN = Math.min(...BOARD_FILE_POSITIONS);
const FILE_MAX = Math.max(...BOARD_FILE_POSITIONS);
const RANK_MIN = Math.min(...BOARD_RANK_POSITIONS);
const RANK_MAX = Math.max(...BOARD_RANK_POSITIONS);
const ASCENDING_RANKS = [...BOARD_RANK_POSITIONS].sort((a, b) => a - b);

function addCornerMark(
  segments: BoardSegment[],
  x: number,
  z: number,
  xDirection: -1 | 1,
  zDirection: -1 | 1,
) {
  const offset = 0.17;
  const length = 0.12;
  const cornerX = x + xDirection * offset;
  const cornerZ = z + zDirection * offset;
  segments.push([[cornerX, cornerZ], [cornerX - xDirection * length, cornerZ]]);
  segments.push([[cornerX, cornerZ], [cornerX, cornerZ - zDirection * length]]);
}

/** Pure, rule-correct Xiangqi line topology in scene-space X/Z coordinates. */
export function makeBoardSegments(): BoardSegment[] {
  const segments: BoardSegment[] = [];
  ASCENDING_RANKS.forEach((z) => segments.push([[FILE_MIN, z], [FILE_MAX, z]]));
  BOARD_FILE_POSITIONS.forEach((x, index) => {
    if (index === 0 || index === BOARD_FILE_POSITIONS.length - 1) {
      segments.push([[x, RANK_MIN], [x, RANK_MAX]]);
      return;
    }
    segments.push([[x, RANK_MIN], [x, ASCENDING_RANKS[4]]]);
    segments.push([[x, ASCENDING_RANKS[5]], [x, RANK_MAX]]);
  });
  segments.push(
    [[-BOARD_SPACING, RANK_MIN], [BOARD_SPACING, ASCENDING_RANKS[2]]],
    [[BOARD_SPACING, RANK_MIN], [-BOARD_SPACING, ASCENDING_RANKS[2]]],
    [[-BOARD_SPACING, ASCENDING_RANKS[7]], [BOARD_SPACING, RANK_MAX]],
    [[BOARD_SPACING, ASCENDING_RANKS[7]], [-BOARD_SPACING, RANK_MAX]],
  );

  const markedIntersections = [
    ...[-3, 3].flatMap((file) => [-2.5, 2.5].map((rank) => [file * BOARD_SPACING, rank * BOARD_SPACING])),
    ...[-4, -2, 0, 2, 4].flatMap((file) => [-1.5, 1.5].map((rank) => [file * BOARD_SPACING, rank * BOARD_SPACING])),
  ] as Array<[number, number]>;

  markedIntersections.forEach(([x, z]) => {
    const xDirections: Array<-1 | 1> = x === FILE_MIN ? [1] : x === FILE_MAX ? [-1] : [-1, 1];
    xDirections.forEach((xDirection) => {
      addCornerMark(segments, x, z, xDirection, -1);
      addCornerMark(segments, x, z, xDirection, 1);
    });
  });
  return segments;
}

function randomSequence(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

/** Deterministic tile variation keeps the clay field handmade without texture noise. */
export function makeClayTilePlacements(): ClayTilePlacement[] {
  const random = randomSequence(41);
  const placements: ClayTilePlacement[] = [];

  for (let file = 0; file < 8; file += 1) {
    for (const rankInterval of [-4, -3, -2, -1, 1, 2, 3, 4]) {
      const variation = random();
      placements.push({
        position: [(file - 3.5) * BOARD_SPACING, rankInterval * BOARD_SPACING],
        rotation: (variation - 0.5) * 0.018,
      });
    }
  }
  return placements;
}

/** Rounded wall runs for the Qin mausoleum's rectangular double enclosure and four axial gates. */
export function makeEnclosureWallPlacements(): EnclosureWallPlacement[] {
  const placements: EnclosureWallPlacement[] = [];
  const enclosures = [
    { gateHalfWidth: 0.72, halfDepth: 6.82, halfWidth: 6.08, height: 0.34, thickness: 0.28 },
    { gateHalfWidth: 0.62, halfDepth: 6.28, halfWidth: 5.54, height: 0.25, thickness: 0.2 },
  ] as const;

  for (const enclosure of enclosures) {
    const horizontalLength = enclosure.halfWidth - enclosure.gateHalfWidth;
    const horizontalCenter = (enclosure.halfWidth + enclosure.gateHalfWidth) / 2;
    const verticalLength = enclosure.halfDepth - enclosure.gateHalfWidth;
    const verticalCenter = (enclosure.halfDepth + enclosure.gateHalfWidth) / 2;

    for (const z of [-enclosure.halfDepth, enclosure.halfDepth]) {
      for (const x of [-horizontalCenter, horizontalCenter]) {
        placements.push({
          position: [x, z],
          scale: [horizontalLength, enclosure.height, enclosure.thickness],
        });
      }
    }
    for (const x of [-enclosure.halfWidth, enclosure.halfWidth]) {
      for (const z of [-verticalCenter, verticalCenter]) {
        placements.push({
          position: [x, z],
          scale: [enclosure.thickness, enclosure.height, verticalLength],
        });
      }
    }
  }
  return placements;
}

function ornament(
  kind: BoardOrnamentKind,
  position: BoardPoint,
  footprintRadius: number,
  scale: readonly [number, number],
  rotation = 0,
): BoardOrnamentPlacement {
  return { footprintRadius, interactive: false, kind, position, rotation, scale };
}

/** Sparse impressions remain in the enclosure apron, beyond every piece and pointer footprint. */
export function makeBoardOrnamentPlacements(): BoardOrnamentPlacement[] {
  const random = randomSequence(1729);
  const placements: BoardOrnamentPlacement[] = [
    ornament("gate-cue", [0, -6.82], 0.34, [0.68, 0.3]),
    ornament("gate-cue", [0, 6.82], 0.34, [0.68, 0.3]),
    ornament("gate-cue", [-6.08, 0], 0.34, [0.3, 0.68], Math.PI / 2),
    ornament("gate-cue", [6.08, 0], 0.34, [0.3, 0.68], Math.PI / 2),
    ornament("tile-medallion", [-5.68, -6.38], 0.23, [0.23, 0.23]),
    ornament("tile-medallion", [5.68, -6.38], 0.23, [0.23, 0.23], Math.PI / 4),
    ornament("tile-medallion", [-5.68, 6.38], 0.23, [0.23, 0.23], Math.PI / 2),
    ornament("tile-medallion", [5.68, 6.38], 0.23, [0.23, 0.23], Math.PI * 0.75),
    ornament("water-swirl", [-5.38, -0.64], 0.18, [0.18, 0.18], -Math.PI / 5),
    ornament("water-swirl", [5.38, 0.64], 0.18, [0.18, 0.18], Math.PI * 0.8),
  ];

  for (const x of [-4.2, -2.8, -1.4, 1.4, 2.8, 4.2]) {
    const jitter = (random() - 0.5) * 0.08;
    const rotation = (random() - 0.5) * 0.16;
    placements.push(
      ornament("brick-impression", [x + jitter, -5.9], 0.09, [0.23, 0.08], rotation),
      ornament("brick-impression", [-x + jitter, 5.9], 0.09, [0.23, 0.08], -rotation),
    );
  }
  for (const z of [-4, -2.6, 2.6, 4]) {
    const jitter = (random() - 0.5) * 0.08;
    const rotation = (random() - 0.5) * 0.16;
    placements.push(
      ornament("brick-impression", [-5.32, z + jitter], 0.09, [0.08, 0.23], rotation),
      ornament("brick-impression", [5.32, -z + jitter], 0.09, [0.08, 0.23], -rotation),
    );
  }
  return placements;
}
