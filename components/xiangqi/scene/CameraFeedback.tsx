"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { PresentationStore } from "../presentation/PresentationStore";
import type { QualityTier } from "../runtime/quality";

/** Cue-driven camera impulse. It is deliberately presentation-only and cannot delay a rule transition. */
export function CameraFeedback({ presentation, quality, reducedMotion }: {
  presentation: PresentationStore;
  quality: QualityTier;
  reducedMotion: boolean;
}) {
  const { camera, invalidate } = useThree();
  const amplitude = useRef(0);
  const elapsed = useRef(0);
  const lastOffset = useRef(new THREE.Vector3());

  useEffect(() => presentation.subscribeCue((cue) => {
    if (reducedMotion || quality === "low") return;
    if (cue.marker !== "impact" && cue.marker !== "fracture") return;
    amplitude.current = Math.max(amplitude.current, cue.marker === "fracture" ? 0.055 : 0.035);
    elapsed.current = 0;
    invalidate();
  }), [invalidate, presentation, quality, reducedMotion]);

  useFrame((_, delta) => {
    camera.position.sub(lastOffset.current);
    lastOffset.current.set(0, 0, 0);
    if (amplitude.current <= 0.0005) return;
    elapsed.current += delta;
    const decay = Math.exp(-elapsed.current * 10);
    const shake = amplitude.current * decay;
    lastOffset.current.set(
      Math.sin(elapsed.current * 83) * shake,
      Math.cos(elapsed.current * 67) * shake * 0.55,
      Math.sin(elapsed.current * 47) * shake * 0.4,
    );
    camera.position.add(lastOffset.current);
    if (decay < 0.02) {
      amplitude.current = 0;
      lastOffset.current.set(0, 0, 0);
    } else {
      invalidate();
    }
  });

  useEffect(() => () => {
    camera.position.sub(lastOffset.current);
    lastOffset.current.set(0, 0, 0);
  }, [camera]);

  return null;
}
