"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type BoardView = "battle" | "overhead";
export type BoardViewSide = "red" | "black";

function CameraRig({ side, view }: { side: BoardViewSide; view: BoardView }) {
  const { camera, invalidate, size } = useThree();
  const moving = useRef(true);
  const destination = useMemo(() => {
    const narrowViewport = size.width / Math.max(size.height, 1) < 0.86;
    if (view === "overhead") {
      return new THREE.Vector3(0, narrowViewport ? 31.5 : 23.5, side === "red" ? 0.001 : -0.001);
    }
    const redDestination = narrowViewport
      ? new THREE.Vector3(13.9, 12.15, 18.3)
      : new THREE.Vector3(9.45, 7.75, 12.75);
    return side === "red"
      ? redDestination
      : new THREE.Vector3(-redDestination.x, redDestination.y, -redDestination.z);
  }, [side, size.height, size.width, view]);

  useEffect(() => {
    moving.current = true;
    camera.up.set(
      0,
      view === "overhead" ? 0 : 1,
      view === "overhead" ? (side === "red" ? -1 : 1) : 0,
    );
    invalidate();
  }, [camera, destination, invalidate, side, view]);

  useFrame((_, delta) => {
    if (!moving.current) return;
    camera.position.lerp(destination, 1 - Math.exp(-delta * 3.5));
    camera.lookAt(0, 0.45, 0);
    moving.current = camera.position.distanceTo(destination) >= 0.025;
    if (moving.current) invalidate();
  });

  return null;
}

export function BoardCamera({ autoTour, side, view }: { autoTour: boolean; side: BoardViewSide; view: BoardView }) {
  return (
    <>
      <CameraRig side={side} view={view} />
      <OrbitControls
        autoRotate={autoTour && view === "battle"}
        autoRotateSpeed={0.35}
        dampingFactor={0.05}
        enableDamping
        makeDefault
        maxDistance={34}
        maxPolarAngle={Math.PI * 0.48}
        minDistance={10}
        minPolarAngle={0.08}
        target={[0, 0.45, 0]}
      />
    </>
  );
}
