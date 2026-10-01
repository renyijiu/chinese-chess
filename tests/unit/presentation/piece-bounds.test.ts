import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

import { preparePieceBounds } from "../../../components/xiangqi/pieces/piece-bounds";
import { ASSET_ROLE_BY_GAME_ROLE } from "../../../components/xiangqi/pieces/piece-catalog";

function skinnedMeshes(scene: THREE.Object3D) {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) meshes.push(child);
  });
  return meshes;
}

it("computes source bounds once and gives clones independent bounds and skeletons", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 2, 0], 3),
  );
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const source = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geometry);
  const bone = new THREE.Bone();
  source.add(mesh, bone);
  mesh.bind(new THREE.Skeleton([bone]));
  const boxComputation = vi.spyOn(mesh, "computeBoundingBox");
  const sphereComputation = vi.spyOn(mesh, "computeBoundingSphere");
  const matrixUpdate = vi.spyOn(source, "updateMatrixWorld");

  const localY = preparePieceBounds(source);
  const first = skinnedMeshes(clone(source))[0]!;
  expect(preparePieceBounds(source)).toBe(localY);
  const second = skinnedMeshes(clone(source))[0]!;
  expect(localY).toBe(-0);
  expect(boxComputation).toHaveBeenCalledTimes(1);
  expect(sphereComputation).toHaveBeenCalledTimes(1);
  expect(matrixUpdate).toHaveBeenCalledTimes(1);
  for (const copy of [first, second]) {
    expect(copy.boundingBox).toEqual(mesh.boundingBox);
    expect(copy.boundingBox).not.toBe(mesh.boundingBox);
    expect(copy.boundingSphere).toEqual(mesh.boundingSphere);
    expect(copy.boundingSphere).not.toBe(mesh.boundingSphere);
    expect(copy.skeleton).not.toBe(mesh.skeleton);
    expect(copy.skeleton.bones[0]).not.toBe(bone);
    expect(copy.geometry).toBe(geometry);
  }
  first.boundingBox!.min.y = -5;
  first.boundingSphere!.radius = 10;
  first.skeleton.bones[0]!.position.y = 3;
  expect(second.boundingBox).toEqual(mesh.boundingBox);
  expect(second.boundingSphere).toEqual(mesh.boundingSphere);
  expect(second.skeleton.bones[0]!.position.y).toBe(0);
  expect(bone.position.y).toBe(0);

  const shifted = new THREE.Group();
  shifted.position.y = -3;
  shifted.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  expect(preparePieceBounds(shifted)).toBe(4);
});

it("preserves exact rest bounds, ground offsets, and idle picking for every production LOD1/2 role", async () => {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (const role of Object.values(ASSET_ROLE_BY_GAME_ROLE)) {
    for (const lod of [1, 2]) {
      const bytes = await readFile(
        new URL(`../../../public/models/pieces/v1/${role}/${role}-lod${lod}.glb`, import.meta.url),
      );
      const { scene, animations } = await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        "",
      );
      const baseline = clone(scene);
      const oldBox = new THREE.Box3().setFromObject(baseline);
      baseline.updateMatrixWorld(true);
      const oldMeshes = skinnedMeshes(baseline);
      oldMeshes.forEach((mesh) => mesh.computeBoundingSphere());

      expect(preparePieceBounds(scene), `${role} LOD${lod} ground`).toBe(-oldBox.min.y);
      const cached = clone(scene);
      expect(new THREE.Box3().setFromObject(cached)).toEqual(oldBox);
      const meshes = skinnedMeshes(cached);
      expect(meshes.length).toBeGreaterThan(0);
      meshes.forEach((mesh, index) => {
        expect(mesh.boundingBox).toEqual(oldMeshes[index]!.boundingBox);
        expect(mesh.boundingSphere).toEqual(oldMeshes[index]!.boundingSphere);
      });

      const idle = animations.find((clip) => clip.name === "idle_loop")!;
      const mixers = [baseline, cached].map((model) => {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
        mixer.update(0);
        model.updateMatrixWorld(true);
        return mixer;
      });
      // The renderer originally computed the sphere after the first idle pose.
      oldMeshes.forEach((mesh) => mesh.computeBoundingSphere());
      let hits = 0;
      for (const height of [0.25, 0.5, 0.75]) {
        const y = THREE.MathUtils.lerp(oldBox.min.y, oldBox.max.y, height);
        for (const direction of [1, -1]) {
          const ray = new THREE.Raycaster(
            new THREE.Vector3(0, y, direction * 3),
            new THREE.Vector3(0, 0, -direction),
          );
          const original = ray.intersectObject(baseline);
          const reused = ray.intersectObject(cached);
          hits += original.length;
          expect(reused.map((hit) => [hit.distance, hit.faceIndex, hit.point.toArray()])).toEqual(
            original.map((hit) => [hit.distance, hit.faceIndex, hit.point.toArray()]),
          );
        }
      }
      expect(hits, `${role} LOD${lod} picks`).toBeGreaterThan(0);
      mixers.forEach((mixer) => mixer.stopAllAction());
    }
  }
});
