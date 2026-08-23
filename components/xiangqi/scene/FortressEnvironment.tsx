"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { Environment, Lightformer, useTexture } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { useScheduledFrame } from "../runtime/FrameScheduler";
import type { QualityProfile } from "../runtime/quality";

export const FORTRESS_BACKDROP_URL = "/background/fortress-valley-v1.jpg";

function FortressMatteBackdrop() {
  const texture = useTexture(FORTRESS_BACKDROP_URL);
  const preparedTexture = useMemo(() => {
    const backdrop = texture.clone();
    backdrop.colorSpace = THREE.SRGBColorSpace;
    backdrop.anisotropy = 8;
    backdrop.needsUpdate = true;
    return backdrop;
  }, [texture]);

  useEffect(() => () => preparedTexture.dispose(), [preparedTexture]);
  return <primitive attach="background" object={preparedTexture} />;
}

function Brazier({
  animate,
  dynamicLight,
  position,
}: {
  animate: boolean;
  dynamicLight: boolean;
  position: [number, number, number];
}) {
  const flameRef = useRef<THREE.Mesh>(null);
  const phase = (position[0] * 0.91 + position[2] * 1.73) % (Math.PI * 2);

  useScheduledFrame((elapsed) => {
    if (!flameRef.current) return;
    const pulse = 1 + Math.sin(elapsed * 5.8 + phase) * 0.11;
    flameRef.current.scale.set(0.9 / pulse, pulse, 0.9 / pulse);
    flameRef.current.rotation.y = elapsed * 0.8 + phase;
  }, animate);

  return (
    <group position={position}>
      <mesh position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.22, 0.31, 0.54, 12]} />
        <meshStandardMaterial color={0x332a23} metalness={0.72} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.57, 0]}>
        <cylinderGeometry args={[0.43, 0.27, 0.2, 16]} />
        <meshStandardMaterial color={0x58402b} metalness={0.78} roughness={0.35} />
      </mesh>
      <mesh ref={flameRef} position={[0, 0.98, 0]}>
        <coneGeometry args={[0.19, 0.78, 9]} />
        <meshBasicMaterial color={0xffa331} toneMapped={false} />
      </mesh>
      {dynamicLight ? (
        <pointLight color={0xff8735} decay={2} distance={4.2} intensity={24} position={[0, 1.15, 0]} />
      ) : null}
    </group>
  );
}

function FlagCloth({ animate, color }: { animate: boolean; color: number }) {
  const clothRef = useRef<THREE.Mesh>(null);

  useScheduledFrame((elapsed) => {
    const position = clothRef.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const attachment = Math.max(0, x + 0.5);
      const ripple = Math.sin(elapsed * 1.6 + x * 4.8 + y * 1.2) * 0.055;
      position.setZ(index, attachment * (0.09 + ripple));
    }
    position.needsUpdate = true;
  }, animate);

  return (
    <mesh ref={clothRef} position={[0.48, 2.73, 0]}>
      <planeGeometry args={[0.94, 1.38, 8, 8]} />
      <meshStandardMaterial color={color} metalness={0.03} roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Banner({
  animate,
  color,
  emblem,
  position,
  rotation,
}: {
  animate: boolean;
  color: number;
  emblem: number;
  position: [number, number, number];
  rotation: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.05, 0]}>
        <cylinderGeometry args={[0.045, 0.065, 3.75, 10]} />
        <meshStandardMaterial color={0x6c5838} metalness={0.65} roughness={0.43} />
      </mesh>
      <FlagCloth animate={animate} color={color} />
      <mesh position={[0.48, 2.73, 0.047]}>
        <ringGeometry args={[0.14, 0.175, 32]} />
        <meshBasicMaterial color={emblem} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <coneGeometry args={[0.12, 0.34, 8]} />
        <meshStandardMaterial color={0x9d7a3e} metalness={0.85} roughness={0.28} />
      </mesh>
    </group>
  );
}

export function FortressEnvironment({
  animate,
  quality,
}: {
  animate: boolean;
  quality: QualityProfile;
}) {
  const environmentResolution = quality.dpr[1] > 1.25 ? 128 : quality.dpr[1] > 1 ? 64 : 32;
  const bannerProps = { animate };
  const brazierProps = {
    animate,
    dynamicLight: quality.dynamicEffectLights,
  };

  return (
    <>
      <color attach="background" args={[0x151b1a]} />
      <fogExp2 attach="fog" args={[0x161d1c, 0.019]} />
      <hemisphereLight args={[0xd5d4c5, 0x111514, 2.25]} />
      <directionalLight
        castShadow={quality.shadows}
        color={0xffd2a0}
        intensity={3.9}
        position={[-8, 15, 9]}
        shadow-bias={-0.0004}
        shadow-camera-bottom={-12}
        shadow-camera-far={45}
        shadow-camera-left={-12}
        shadow-camera-near={1}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-mapSize-width={quality.shadowMapSize}
      />
      <directionalLight color={0x78a0a1} intensity={1.35} position={[10, 7, -11]} />
      <Environment resolution={environmentResolution}>
        <Lightformer color={0xffd7ad} intensity={2.4} position={[-4, 8, 8]} scale={[8, 3, 1]} />
        <Lightformer color={0x6f9996} intensity={1.8} position={[8, 3, -7]} scale={[5, 5, 1]} />
      </Environment>

      <Suspense fallback={null}><FortressMatteBackdrop /></Suspense>
      <Brazier {...brazierProps} position={[-5.53, 0.4, -6.2]} />
      <Brazier {...brazierProps} position={[5.53, 0.4, -6.2]} />
      <Brazier {...brazierProps} position={[-5.53, 0.4, 6.2]} />
      <Brazier {...brazierProps} position={[5.53, 0.4, 6.2]} />

      <Banner {...bannerProps} color={0x5f211c} emblem={0xbf9556} position={[-6.05, 0.45, 5.35]} rotation={0.18} />
      <Banner {...bannerProps} color={0x5f211c} emblem={0xbf9556} position={[6.05, 0.45, 5.35]} rotation={Math.PI - 0.18} />
      <Banner {...bannerProps} color={0x182925} emblem={0x6e9189} position={[-6.05, 0.45, -5.35]} rotation={0.18} />
      <Banner {...bannerProps} color={0x182925} emblem={0x6e9189} position={[6.05, 0.45, -5.35]} rotation={Math.PI - 0.18} />
    </>
  );
}

useTexture.preload(FORTRESS_BACKDROP_URL);
