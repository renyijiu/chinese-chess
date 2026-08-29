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

/**
 * Interpolates a move in world space so faction-facing rotations can never
 * reverse the board path. The caller may pass an eased progress value.
 */
export function interpolateSquareToWorld(
  from: BoardSquare,
  to: BoardSquare,
  progress: number,
): WorldPosition {
  const start = squareToWorld(from);
  const end = squareToWorld(to);
  const amount = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  if (amount === 0) return start;
  if (amount === 1) return end;

  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

export const BOARD_FILE_POSITIONS = Object.freeze(
  Array.from({ length: BOARD_FILES }, (_, file) => squareToWorld({ file, rank: 0 })[0]),
);

export const BOARD_RANK_POSITIONS = Object.freeze(
  Array.from({ length: BOARD_RANKS }, (_, rank) => squareToWorld({ file: 0, rank })[2]),
);
