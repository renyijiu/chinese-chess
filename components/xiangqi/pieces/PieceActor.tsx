"use client";

/* oxlint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import type { ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { Piece, Side } from "../../../lib/xiangqi/index";
import type { AnimationRegistry } from "../animation/AnimationRegistry";
import type { PresentationStore } from "../presentation/PresentationStore";
import { resolvePieceMotion, type PieceMotion } from "../presentation/piece-motion";
import type { PieceLod } from "../runtime/quality";
import { usePieceAsset } from "./asset-loader";
import { factionGeometry } from "./faction-geometry";
import { FACTION_MARKER_STYLES } from "./faction-marker";
import { preparePieceBounds } from "./piece-bounds";
import { pieceAssetUrl } from "./piece-catalog";
import { QIN_DIORAMA_THEME } from "../scene/scene-theme";

const cloneRiggedScene = cloneSkeleton as <T extends THREE.Object3D>(source: T) => T;

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return "isMesh" in object && (object as THREE.Mesh).isMesh;
}

function SelectionAura({ side }: { side: Side }) {
  const style = FACTION_MARKER_STYLES[side];
  return (
    <group name="selection-aura">
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[0.48, 32]} />
        <meshBasicMaterial
          color={QIN_DIORAMA_THEME.factions[side].trim}
          depthWrite={false}
          opacity={0.18}
          toneMapped={false}
          transparent
        />
      </mesh>
      <mesh
        position={[0, 0.014, 0]}
        raycast={() => null}
        rotation={[-Math.PI / 2, 0, style.rotationZ]}
      >
        <ringGeometry args={[0.472, 0.558, style.segments]} />
        <meshBasicMaterial
          color={QIN_DIORAMA_THEME.factions[side].glow}
          depthWrite={false}
          opacity={0.96}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

function RiggedRoleModel({
  actorId,
  actorRef,
  animation,
  animations,
  lod,
  destroyProgress,
  ghost,
  motion,
  presentation,
  piece,
}: {
  actorId: string;
  actorRef: RefObject<THREE.Group | null>;
  animation: string;
  animations: AnimationRegistry;
  lod: PieceLod;
  destroyProgress: number;
  ghost: boolean;
  motion?: PieceMotion | undefined;
  presentation?: PresentationStore | undefined;
  piece: Piece;
}) {
  const url = pieceAssetUrl(piece.role, lod);
  const { animations: clips, scene } = usePieceAsset(url);
  const prepared = useMemo(() => {
    const localY = preparePieceBounds(scene);
    const model = cloneRiggedScene(scene);
    const mixer = new THREE.AnimationMixer(model);
    const materials: THREE.Material[] = [];
    model.traverse((child) => {
      if (!isMesh(child)) return;
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
          clone.transparent = false;
        }
        return clone;
      });
      child.material = Array.isArray(child.material) ? clones : clones[0]!;
      // Thirty-two individually skinned shadow casters exceed the scene draw-call
      // budget. The board layer supplies one instanced contact-shadow pass.
      child.castShadow = false;
      child.receiveShadow = true;
    });
    return { localY, materials, mixer, model };
  }, [piece.side, scene]);

  useEffect(
    () => () => {
      prepared.mixer.stopAllAction();
      prepared.mixer.uncacheRoot(prepared.model);
      const skeletons = new Set<THREE.Skeleton>();
      prepared.model.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) skeletons.add(child.skeleton);
      });
      skeletons.forEach((skeleton) => skeleton.dispose());
      prepared.materials.forEach((material) => material.dispose());
    },
    [prepared],
  );
  useLayoutEffect(
    () => animations.register(actorId, prepared.mixer, clips),
    [actorId, animations, clips, prepared.mixer],
  );
  useLayoutEffect(() => {
    const update = () => {
      const visual =
        motion && presentation
          ? resolvePieceMotion(motion, presentation.getProgress())
          : { animation, destroyProgress };
      const opacity = 1 - visual.destroyProgress;
      if (actorRef.current) {
        actorRef.current.scale.setScalar(Math.max(0.035, 1 - visual.destroyProgress * 0.965));
        actorRef.current.visible = !ghost || visual.destroyProgress < 0.99;
      }
      prepared.materials.forEach((material) => {
        const transparent = opacity < 1;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
      });
      animations.play(actorId, visual.animation);
    };
    update();
    return motion && presentation ? presentation.subscribeFrame(update) : undefined;
  }, [
    actorId,
    actorRef,
    animation,
    animations,
    destroyProgress,
    ghost,
    motion,
    presentation,
    prepared,
  ]);

  return <primitive object={prepared.model} position={[0, prepared.localY, 0]} />;
}

export const PieceActor = memo(function PieceActor({
  actorId,
  animation = "idle_loop",
  animations,
  disabled,
  destroyProgress = 0,
  ghost = false,
  lod = 1,
  motion,
  presentation,
  onPress,
  piece,
  selected,
}: {
  actorId: string;
  animation?: string;
  animations: AnimationRegistry;
  disabled: boolean;
  destroyProgress?: number;
  ghost?: boolean;
  lod?: PieceLod;
  motion?: PieceMotion | undefined;
  presentation?: PresentationStore | undefined;
  onPress: (piece: Piece) => void;
  piece: Piece;
  selected: boolean;
}) {
  const actorRef = useRef<THREE.Group>(null);
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (disabled || event.delta > 6) return;
    onPress(piece);
  };

  return (
    <group
      ref={actorRef}
      name={`piece-actor:${actorId}`}
      onClick={handleClick}
      scale={Math.max(0.035, 1 - destroyProgress * 0.965)}
      visible={!ghost || destroyProgress < 0.99}
    >
      {selected ? <SelectionAura side={piece.side} /> : null}
      <RiggedRoleModel
        actorId={actorId}
        actorRef={actorRef}
        animation={animation}
        animations={animations}
        lod={lod}
        destroyProgress={destroyProgress}
        ghost={ghost}
        motion={motion}
        presentation={presentation}
        piece={piece}
      />
    </group>
  );
});
