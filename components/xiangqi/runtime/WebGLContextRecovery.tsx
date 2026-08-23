"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

import type { AnimationRegistry } from "../animation/AnimationRegistry";
import type { PresentationStore } from "../presentation/PresentationStore";

export function WebGLContextRecovery({
  animations,
  presentation,
}: {
  animations: AnimationRegistry;
  presentation: PresentationStore;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      presentation.skip("error");
      animations.clearUrgentAnimations();
    };
    const handleRestored = () => invalidate();
    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", handleRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, [animations, gl, invalidate, presentation]);

  return null;
}
