"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { useMemo } from "react";
import * as THREE from "three";
import { clone as cloneObject3D } from "three/examples/jsm/utils/SkeletonUtils.js";

import { usePieceAsset } from "../pieces/asset-loader";

export const PROTOTYPE_MARSHAL_URL = "/models/red-marshal-runtime.glb";
const PROTOTYPE_MARSHAL_SCALE = 0.36;

export function PrototypeMarshal() {
  const { scene } = usePieceAsset(PROTOTYPE_MARSHAL_URL);
  const prepared = useMemo(() => {
    const model = cloneObject3D(scene);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const bounds = new THREE.Box3().setFromObject(model);
    return { model, localY: -bounds.min.y * PROTOTYPE_MARSHAL_SCALE };
  }, [scene]);

  return (
    <group name="prototype-red-marshal">
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.43, 0.49, 48]} />
        <meshBasicMaterial color={0xb63c2f} depthWrite={false} opacity={0.72} transparent />
      </mesh>
      <primitive
        object={prepared.model}
        position={[0, prepared.localY, 0]}
        rotation={[0, Math.PI, 0]}
        scale={PROTOTYPE_MARSHAL_SCALE}
      />
    </group>
  );
}
