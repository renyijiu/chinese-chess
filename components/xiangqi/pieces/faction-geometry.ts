import * as THREE from "three";

import type { Side } from "../../../lib/xiangqi/index";
import { semanticColor } from "./piece-palette";

const factionGeometryCache = new WeakMap<
  THREE.BufferGeometry,
  Partial<Record<Side, THREE.BufferGeometry>>
>();

/**
 * Recolor COLOR_0 once per source geometry and faction. All other GLTF buffers are
 * immutable and shared for the loader cache's lifetime. Do not dispose individual
 * variants: Three would also delete GPU buffers still used by the other faction.
 */
export function factionGeometry(source: THREE.BufferGeometry, side: Side) {
  const cached = factionGeometryCache.get(source)?.[side];
  if (cached) return cached;
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  geometry.index = source.index;
  geometry.attributes = { ...source.attributes };
  geometry.morphAttributes = { ...source.morphAttributes };
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.groups = source.groups.map((group) => ({ ...group }));
  geometry.drawRange = { ...source.drawRange };
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData = source.userData;
  const sourceColor = source.getAttribute("color");
  if (sourceColor) {
    const colors = new Float32Array(sourceColor.count * 4);
    const original = new THREE.Color();
    for (let index = 0; index < sourceColor.count; index += 1) {
      original.setRGB(sourceColor.getX(index), sourceColor.getY(index), sourceColor.getZ(index));
      const color = semanticColor(original, side);
      colors[index * 4] = color.r;
      colors[index * 4 + 1] = color.g;
      colors[index * 4 + 2] = color.b;
      colors[index * 4 + 3] = 1;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  }
  const variants = factionGeometryCache.get(source) ?? {};
  variants[side] = geometry;
  factionGeometryCache.set(source, variants);
  return geometry;
}
