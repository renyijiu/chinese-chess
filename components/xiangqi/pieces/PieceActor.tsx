"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { Piece, Side } from "../../../lib/xiangqi/index";
import type { AnimationRegistry } from "../animation/AnimationRegistry";
import type { PieceLod } from "../runtime/quality";
import { usePieceAsset } from "./asset-loader";
import { pieceAssetUrl } from "./piece-catalog";
import { FACTION_COLORS, semanticColor } from "./piece-palette";

const SELECTION_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xffd27a,
  depthWrite: false,
  opacity: 0.9,
  transparent: true,
});

const factionGeometryCache = new WeakMap<THREE.BufferGeometry, Partial<Record<Side, THREE.BufferGeometry>>>();

/** Recolor COLOR_0 once per source geometry and faction, never mutating GLTF cache data. */
function factionGeometry(source: THREE.BufferGeometry, side: Side) {
  const cached = factionGeometryCache.get(source)?.[side];
  if (cached) return cached;
  const geometry = source.clone();
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
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  }
  const variants = factionGeometryCache.get(source) ?? {};
  variants[side] = geometry;
  factionGeometryCache.set(source, variants);
  return geometry;
}

function SelectionAura({ side }: { side: Side }) {
  return (
    <group name="selection-aura">
      <mesh material={SELECTION_MATERIAL} position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.46, 0.53, 40]} />
      </mesh>
      <pointLight color={FACTION_COLORS[side].glow} distance={2.4} intensity={0.7} position={[0, 0.5, 0]} />
    </group>
  );
}

function RiggedRoleModel({ actorId, animation, animations, lod, opacity, piece }: {
  actorId: string;
  animation: string;
  animations: AnimationRegistry;
  lod: PieceLod;
  opacity: number;
  piece: Piece;
}) {
  const url = pieceAssetUrl(piece.role, lod);
  const { animations: clips, scene } = usePieceAsset(url);
  const prepared = useMemo(() => {
    const model = cloneSkeleton(scene);
    const mixer = new THREE.AnimationMixer(model);
    const materials: THREE.Material[] = [];
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry = factionGeometry(child.geometry, piece.side);
      const source = Array.isArray(child.material) ? child.material : [child.material];
      const clones = source.map((material) => {
        const clone = material.clone();
        materials.push(clone);
        if (clone instanceof THREE.MeshStandardMaterial) {
          clone.vertexColors = true;
          clone.color.set(0xffffff);
          clone.emissive.set(piece.side === "red" ? 0x170706 : 0x05100d);
          clone.emissiveIntensity = 0.035;
          // One opaque skinned primitive carries the excavated-clay body and
          // sparse mineral-pigment marks. A dry response is essential: these
          // figures must read as terracotta, never lacquered toys or chrome.
          clone.metalness = 0.04;
          clone.roughness = 0.94;
          clone.transparent = true;
        }
        return clone;
      });
      child.material = Array.isArray(child.material) ? clones : clones[0]!;
      // Thirty-two individually skinned shadow casters exceed the scene draw-call
      // budget. The board layer supplies one instanced contact-shadow pass.
      child.castShadow = false;
      child.receiveShadow = true;
    });
    const bounds = new THREE.Box3().setFromObject(model);
    return { localY: -bounds.min.y, materials, mixer, model };
  }, [piece.side, scene]);

  useEffect(() => () => prepared.materials.forEach((material) => material.dispose()), [prepared]);
  useEffect(() => animations.register(actorId, prepared.mixer, clips), [actorId, animations, clips, prepared.mixer]);
  useEffect(() => {
    prepared.materials.forEach((material) => {
      material.opacity = opacity;
    });
  }, [opacity, prepared.materials]);
  useEffect(() => {
    animations.play(actorId, animation);
  }, [actorId, animation, animations]);

  return <primitive object={prepared.model} position={[0, prepared.localY, 0]} />;
}

export function PieceActor({
  actorId,
  animation = "idle_loop",
  animations,
  disabled,
  destroyProgress = 0,
  ghost = false,
  lod = 1,
  onPress,
  piece,
  selected,
  visualOffset = [0, 0, 0],
}: {
  actorId: string;
  animation?: string;
  animations: AnimationRegistry;
  disabled: boolean;
  destroyProgress?: number;
  ghost?: boolean;
  lod?: PieceLod;
  onPress: (piece: Piece) => void;
  piece: Piece;
  selected: boolean;
  visualOffset?: readonly [number, number, number];
}) {
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (disabled || event.delta > 6) return;
    onPress(piece);
  };

  return (
    <group
      name={`piece-actor:${actorId}`}
      onClick={handleClick}
      position={visualOffset}
      scale={Math.max(0.035, 1 - destroyProgress * 0.965)}
      visible={!ghost || destroyProgress < 0.99}
    >
      {selected ? <SelectionAura side={piece.side} /> : null}
      <RiggedRoleModel
        actorId={actorId}
        animation={animation}
        animations={animations}
        lod={lod}
        opacity={1 - destroyProgress}
        piece={piece}
      />
    </group>
  );
}
