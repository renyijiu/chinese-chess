import * as THREE from "three";

const groundOffsets = new WeakMap<THREE.Object3D, number>();

/** Prime immutable GLTF rest bounds before SkeletonUtils clones them for each actor. */
export function preparePieceBounds(source: THREE.Object3D) {
  const cached = groundOffsets.get(source);
  if (cached !== undefined) return cached;

  source.updateMatrixWorld(true);
  source.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh && child.boundingSphere === null) {
      child.computeBoundingSphere();
    }
  });
  const localY = -new THREE.Box3().setFromObject(source).min.y;
  groundOffsets.set(source, localY);
  return localY;
}
