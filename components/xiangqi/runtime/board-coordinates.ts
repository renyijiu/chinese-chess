export const BOARD_FILES = 9;
export const BOARD_RANKS = 10;
export const BOARD_SPACING = 1.14;
export const BOARD_SURFACE_Y = 0.69;

export type BoardSquare = Readonly<{
  file: number;
  rank: number;
}>;

export type WorldPosition = readonly [x: number, y: number, z: number];

function assertCoordinate(name: "file" | "rank", value: number, limit: number) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  if (value < 0 || value >= limit) {
    throw new RangeError(`${name} must be between 0 and ${limit - 1}`);
  }
}

/**
 * The sole logical-board to scene-space mapping.
 *
 * File 0 is the left edge and rank 0 is the near (+Z) red home rank
 * when the camera is in the default battle view.
 */
export function squareToWorld(square: BoardSquare): WorldPosition {
  assertCoordinate("file", square.file, BOARD_FILES);
  assertCoordinate("rank", square.rank, BOARD_RANKS);

  return [
    (square.file - (BOARD_FILES - 1) / 2) * BOARD_SPACING,
    BOARD_SURFACE_Y,
    ((BOARD_RANKS - 1) / 2 - square.rank) * BOARD_SPACING,
  ];
}

export const BOARD_FILE_POSITIONS = Object.freeze(
  Array.from({ length: BOARD_FILES }, (_, file) => squareToWorld({ file, rank: 0 })[0]),
);

export const BOARD_RANK_POSITIONS = Object.freeze(
  Array.from({ length: BOARD_RANKS }, (_, rank) => squareToWorld({ file: 0, rank })[2]),
);
