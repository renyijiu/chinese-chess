import type { PanoramaVariant } from "../runtime/quality";

export type EnvironmentStatus = "loading" | "ready" | "degraded";
export type EnvironmentLayerStatus = EnvironmentStatus;

export type DioramaPropKind =
  | "wall"
  | "pit-corridor"
  | "mound"
  | "gate"
  | "tent"
  | "brazier"
  | "banner"
  | "weapon-rack";

export type DioramaPropPlacement = Readonly<{
  kind: DioramaPropKind;
  position: readonly [x: number, y: number, z: number];
  rotation: number;
  scale: readonly [x: number, y: number, z: number];
}>;

const PANORAMA_URLS: Readonly<Record<PanoramaVariant, string>> = Object.freeze({
  high: "/background/qin-diorama-panorama-v1-high.webp",
  medium: "/background/qin-diorama-panorama-v1-medium.webp",
  low: "/background/qin-diorama-panorama-v1-low.webp",
});

function prop(
  kind: DioramaPropKind,
  position: DioramaPropPlacement["position"],
  scale: DioramaPropPlacement["scale"],
  rotation = 0,
): DioramaPropPlacement {
  return Object.freeze({ kind, position, rotation, scale });
}

const CORE_PROPS = Object.freeze([
  prop("wall", [-8.1, 0.35, -7.4], [4.6, 0.75, 0.5], 0.06),
  prop("wall", [8.1, 0.35, -7.4], [4.6, 0.75, 0.5], -0.06),
  prop("wall", [-8.1, 0.35, 7.4], [4.6, 0.75, 0.5], -0.06),
  prop("wall", [8.1, 0.35, 7.4], [4.6, 0.75, 0.5], 0.06),
  prop("pit-corridor", [-8.8, 0.12, -1.9], [3.7, 0.26, 1.05], 0.12),
  prop("pit-corridor", [8.8, 0.12, 1.9], [3.7, 0.26, 1.05], 0.12),
  prop("mound", [-10.3, 0.1, 5.3], [2.2, 1.15, 1.8]),
  prop("mound", [10.3, 0.1, -5.3], [2.2, 1.15, 1.8]),
  prop("gate", [0, 0.45, -8.15], [2.6, 1.9, 0.55]),
  prop("gate", [0, 0.45, 8.15], [2.6, 1.9, 0.55], Math.PI),
]);

const MEDIUM_PROPS = Object.freeze([
  prop("tent", [-9.3, 0.25, -4.8], [1.2, 1.1, 1.2], 0.28),
  prop("tent", [9.3, 0.25, 4.8], [1.2, 1.1, 1.2], Math.PI + 0.28),
  prop("brazier", [-6.7, 0.45, -7.25], [1, 1, 1]),
  prop("brazier", [6.7, 0.45, 7.25], [1, 1, 1]),
  prop("banner", [-7.5, 0.45, 6.9], [1, 1, 1], 0.12),
  prop("banner", [7.5, 0.45, -6.9], [1, 1, 1], Math.PI + 0.12),
  prop("weapon-rack", [-8.1, 0.45, 2.8], [1, 1, 1], Math.PI / 2),
  prop("weapon-rack", [8.1, 0.45, -2.8], [1, 1, 1], -Math.PI / 2),
]);

const HIGH_PROPS = Object.freeze([
  prop("wall", [-10.6, 0.25, -8.8], [3.5, 0.55, 0.42], 0.2),
  prop("wall", [10.6, 0.25, 8.8], [3.5, 0.55, 0.42], 0.2),
  prop("pit-corridor", [-9.8, 0.12, 1.25], [2.8, 0.22, 0.84], -0.16),
  prop("pit-corridor", [9.8, 0.12, -1.25], [2.8, 0.22, 0.84], -0.16),
  prop("tent", [-10.5, 0.25, 3.2], [0.92, 0.86, 0.92], -0.38),
  prop("tent", [10.5, 0.25, -3.2], [0.92, 0.86, 0.92], Math.PI - 0.38),
  prop("brazier", [6.7, 0.45, -7.25], [1, 1, 1]),
  prop("brazier", [-6.7, 0.45, 7.25], [1, 1, 1]),
  prop("banner", [-7.5, 0.45, -6.9], [1, 1, 1], 0.12),
  prop("banner", [7.5, 0.45, 6.9], [1, 1, 1], Math.PI + 0.12),
  prop("weapon-rack", [-9.4, 0.45, -3.1], [0.88, 0.88, 0.88], Math.PI / 2),
  prop("weapon-rack", [9.4, 0.45, 3.1], [0.88, 0.88, 0.88], -Math.PI / 2),
]);

export function getDioramaPropPlacements(detailLevel: 3 | 2 | 1) {
  if (detailLevel === 1) return CORE_PROPS;
  if (detailLevel === 2) return Object.freeze([...CORE_PROPS, ...MEDIUM_PROPS]);
  return Object.freeze([...CORE_PROPS, ...MEDIUM_PROPS, ...HIGH_PROPS]);
}

export function getPanoramaUrl(variant: PanoramaVariant) {
  return PANORAMA_URLS[variant];
}

export function resolveEnvironmentStatus(
  layers: readonly EnvironmentLayerStatus[],
): EnvironmentStatus {
  if (layers.some((status) => status === "loading")) return "loading";
  if (layers.some((status) => status === "degraded")) return "degraded";
  return "ready";
}
