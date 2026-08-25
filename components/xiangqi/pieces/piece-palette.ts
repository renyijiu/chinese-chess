import * as THREE from "three";

import type { Side } from "../../../lib/xiangqi/index";
import { FACTION_COLORS } from "./faction-colors";

export { FACTION_COLORS } from "./faction-colors";
export type { FactionPalette } from "./faction-colors";

type PaletteRegion = "bronze" | "clothPrimary" | "clothSecondary" | "trim";

const SEMANTIC_REFERENCE_COLORS: readonly [PaletteRegion, THREE.Color][] = [
  ["clothPrimary", new THREE.Color(0.25, 0.018, 0.01)],
  ["clothSecondary", new THREE.Color(0.065, 0.008, 0.006)],
  ["trim", new THREE.Color(0.38, 0.18, 0.035)],
  ["bronze", new THREE.Color(0.16, 0.078, 0.025)],
  ["clothPrimary", new THREE.Color(0.19, 0.014, 0.009)],
  ["clothSecondary", new THREE.Color(0.055, 0.009, 0.007)],
  ["trim", new THREE.Color(0.28, 0.14, 0.035)],
  ["bronze", new THREE.Color(0.115, 0.068, 0.028)],
];

const MAX_SEMANTIC_COLOR_DISTANCE_SQUARED = 0.00018;

export function semanticColor(original: THREE.Color, side: Side) {
  const faction = FACTION_COLORS[side];
  let nearest: PaletteRegion | null = null;
  let nearestDistance = Infinity;
  for (const [region, reference] of SEMANTIC_REFERENCE_COLORS) {
    const redDelta = original.r - reference.r;
    const greenDelta = original.g - reference.g;
    const blueDelta = original.b - reference.b;
    const distance = redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
    if (distance < nearestDistance) {
      nearest = region;
      nearestDistance = distance;
    }
  }
  if (nearest && nearestDistance <= MAX_SEMANTIC_COLOR_DISTANCE_SQUARED) {
    return new THREE.Color(faction[nearest]);
  }
  return original;
}
