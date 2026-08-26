"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { PresentationStore } from "../presentation/PresentationStore";
import { AnimationRegistry } from "./AnimationRegistry";

export function AnimationDirector({
  animations,
  presentation,
}: {
  animations: AnimationRegistry;
  presentation: PresentationStore;
}) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => presentation.subscribe(() => invalidate()), [invalidate, presentation]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        invalidate();
        return;
      }
      presentation.skip("visibility-hidden");
      animations.clearUrgentAnimations();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [animations, invalidate, presentation]);

  // This is the only per-render-frame animation callback for every piece mixer.
  useFrame((_, deltaSeconds) => {
    try {
      presentation.tick(Math.min(2_000, Math.max(0, deltaSeconds * 1_000)));
      animations.update(deltaSeconds);
    } catch {
      presentation.skip("presentation-error");
      animations.clearUrgentAnimations();
    }
    if (presentation.active || animations.hasUrgentAnimation) invalidate();
  });

  return null;
}
