"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import type { AudioEngine } from "./AudioEngine";

const POSITION = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const UP = new THREE.Vector3();

export function AudioListenerBridge({ audio }: { audio: AudioEngine }) {
  const elapsed = useRef(Number.NEGATIVE_INFINITY);
  const lastPosition = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  const lastForward = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  const lastUp = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  useFrame(({ camera, clock }) => {
    if (audio.state === "locked") return;
    const now = clock.getElapsedTime();
    if (now - elapsed.current < 1 / 20) return;
    elapsed.current = now;
    camera.getWorldPosition(POSITION);
    camera.getWorldDirection(FORWARD);
    UP.copy(camera.up).applyQuaternion(camera.quaternion).normalize();
    if (
      lastPosition.current.distanceToSquared(POSITION) < 1e-10 &&
      lastForward.current.distanceToSquared(FORWARD) < 1e-10 &&
      lastUp.current.distanceToSquared(UP) < 1e-10
    ) return;
    lastPosition.current.copy(POSITION);
    lastForward.current.copy(FORWARD);
    lastUp.current.copy(UP);
    audio.setListenerPose(
      [POSITION.x, POSITION.y, POSITION.z],
      [FORWARD.x, FORWARD.y, FORWARD.z],
      [UP.x, UP.y, UP.z],
    );
  });
  return null;
}
