"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { useLayoutEffect, useMemo, useRef } from "react";
import { Select } from "@react-three/postprocessing";
import * as THREE from "three";

import type { Role, Side, Square } from "../../../lib/xiangqi/index";
import type { QualityProfile } from "../runtime/quality";
import { squareToWorld } from "../runtime/board-coordinates";
import { getPieceVfxProfile, type VfxPayload } from "./piece-vfx-profiles";

function clampedRange(value: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (value - start) / Math.max(0.001, end - start)));
}

function PayloadGeometry({ payload }: { payload: VfxPayload }) {
  if (payload === "bolt") return <cylinderGeometry args={[0.018, 0.028, 0.62, 8]} />;
  if (payload === "tally") return <boxGeometry args={[0.24, 0.055, 0.055]} />;
  if (payload === "wheel") return <torusGeometry args={[0.15, 0.025, 6, 18]} />;
  if (payload === "lance") return <cylinderGeometry args={[0.012, 0.025, 0.72, 7]} />;
  if (payload === "earthshock") return <coneGeometry args={[0.15, 0.5, 8, 1, true]} />;
  if (payload === "spear") return <boxGeometry args={[0.035, 0.48, 0.035]} />;
  return <cylinderGeometry args={[0.018, 0.09, 0.6, 8]} />;
}

function EffectParticles({ color, count, strength, target }: {
  color: string;
  count: number;
  strength: number;
  target: THREE.Vector3;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new THREE.Object3D();
    for (let index = 0; index < 16; index += 1) {
      const enabled = index < count;
      const angle = index * 2.399;
      const radius = 0.1 + (index % 5) * 0.055;
      transform.position.set(Math.cos(angle) * radius, 0.05 + (index % 4) * 0.055, Math.sin(angle) * radius);
      transform.rotation.set(angle * 0.4, angle, angle * 0.7);
      transform.scale.setScalar(enabled ? 0.65 + (index % 3) * 0.16 : 0);
      transform.updateMatrix();
      mesh.current.setMatrixAt(index, transform.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  return (
    <group position={target} scale={0.55 + strength * 0.75} visible={strength > 0 && strength < 1}>
      <instancedMesh ref={mesh} args={[undefined, undefined, 16]} raycast={() => null}>
        <tetrahedronGeometry args={[0.055, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} metalness={0.03} opacity={1 - strength} roughness={0.92} transparent />
      </instancedMesh>
    </group>
  );
}

/** One reusable graph whose role profile changes its silhouette and timing language. */
export function PieceCombatVfx({
  active,
  capture,
  from,
  progress,
  quality,
  reducedMotion,
  role,
  side,
  to,
}: {
  active: boolean;
  capture: boolean;
  from: Square;
  progress: number;
  quality: QualityProfile;
  reducedMotion: boolean;
  role: Role;
  side: Side;
  to: Square;
}) {
  const profile = getPieceVfxProfile(role, side);
  const fromWorld = useMemo(() => new THREE.Vector3(...squareToWorld(from)), [from]);
  const toWorld = useMemo(() => new THREE.Vector3(...squareToWorld(to)), [to]);
  const payloadProgress = clampedRange(progress, 0.15, capture ? 0.51 : 0.76);
  const payloadPosition = useMemo(() => new THREE.Vector3(), []);
  payloadPosition.copy(fromWorld).lerp(toWorld, payloadProgress);
  const direction = useMemo(() => toWorld.clone().sub(fromWorld), [fromWorld, toWorld]);
  const payloadQuaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  ), [direction]);
  const telegraph = 1 - clampedRange(progress, 0.12, 0.3);
  const release = clampedRange(progress, 0.12, 0.28) * (1 - clampedRange(progress, capture ? 0.5 : 0.76, capture ? 0.61 : 0.86));
  const impact = capture
    ? clampedRange(progress, 0.47, 0.54) * (1 - clampedRange(progress, 0.68, 0.82))
    : clampedRange(progress, 0.72, 0.8) * (1 - clampedRange(progress, 0.87, 1));
  const fracture = capture ? clampedRange(progress, 0.6, 0.95) : 0;
  const particleCount = reducedMotion ? 0 : Math.max(3, Math.round(profile.particleCount * quality.particleScale));
  const intensity = reducedMotion ? 0.34 : 1;
  const angular = profile.pattern === "verdigris-angle";

  return (
    <Select enabled={active}>
      <group name={`piece-combat-vfx:${profile.motif}`} visible={active}>
      <group position={fromWorld} visible={telegraph > 0}>
        <mesh rotation={[-Math.PI / 2, 0, progress * Math.PI * (angular ? -1 : 1)]} scale={0.72 + telegraph * 0.18} raycast={() => null}>
          <ringGeometry args={[0.28, 0.39, angular ? 6 : role === "advisor" ? 8 : 24]} />
          <meshBasicMaterial color={profile.colors.bright} depthWrite={false} opacity={telegraph * 0.72 * intensity} transparent />
        </mesh>
        <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, -progress * 2.2]} raycast={() => null}>
          {role === "advisor"
            ? <torusKnotGeometry args={[0.16, 0.01, 48, 5, 2, 3]} />
            : role === "chariot"
              ? <torusGeometry args={[0.19, 0.026, 5, 16]} />
              : <ringGeometry args={[0.12, 0.18, angular ? 4 : 12]} />}
          <meshBasicMaterial color={profile.colors.core} depthWrite={false} opacity={telegraph * 0.62 * intensity} transparent />
        </mesh>
      </group>

      <group position={payloadPosition} quaternion={payloadQuaternion} visible={!reducedMotion && release > 0}>
        <mesh scale={role === "elephant" ? [1.5, 1, 1.5] : role === "soldier" ? [1, 1.25, 1] : 1} raycast={() => null}>
          <PayloadGeometry payload={profile.payload} />
          <meshBasicMaterial color={profile.colors.bright} depthWrite={false} opacity={release * 0.86} transparent />
        </mesh>
        {role === "cannon" ? (
          <mesh position={[0, 0.36, 0]} raycast={() => null}>
            <coneGeometry args={[0.065, 0.16, 8]} />
            <meshStandardMaterial color={profile.colors.bright} emissive={profile.colors.core} emissiveIntensity={0.22} metalness={0.55} roughness={0.52} transparent opacity={release * 0.9} />
          </mesh>
        ) : null}
        {role === "cannon" ? (
          <mesh position={[0, -0.18, 0]} scale={0.08 + release * 0.06} raycast={() => null}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={profile.colors.smoke} depthWrite={false} opacity={release * 0.26} roughness={1} transparent />
          </mesh>
        ) : null}
      </group>

      <group position={toWorld} visible={impact > 0}>
        <mesh rotation={[-Math.PI / 2, 0, angular ? Math.PI / 4 : 0]} scale={0.48 + impact * profile.impactRadius} raycast={() => null}>
          <ringGeometry args={[0.16, role === "elephant" ? 0.33 : 0.27, angular ? 6 : 28]} />
          <meshBasicMaterial color={profile.colors.bright} depthWrite={false} opacity={impact * 0.78 * intensity} transparent />
        </mesh>
        <mesh position={[0, role === "elephant" ? 0.05 : 0.16, 0]} scale={0.09 + impact * 0.18} raycast={() => null}>
          {role === "elephant" ? <octahedronGeometry args={[1, 0]} /> : role === "cannon" ? <icosahedronGeometry args={[1, 1]} /> : <dodecahedronGeometry args={[1, 0]} />}
          <meshBasicMaterial color={profile.colors.core} depthWrite={false} opacity={impact * 0.46 * intensity} transparent />
        </mesh>
        {quality.dynamicEffectLights && !reducedMotion ? (
          <pointLight color={profile.colors.bright} distance={2} intensity={impact * 1.8} />
        ) : null}
      </group>

        <EffectParticles color={profile.colors.smoke} count={particleCount} strength={fracture} target={toWorld} />
      </group>
    </Select>
  );
}
