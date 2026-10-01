"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

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
  const previousActionId = useRef<string | null>(null);

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
    const actionId = presentation.getSnapshot().active?.transition.actionId ?? null;
    // A demand-rendered scene's first delta includes the time spent asleep.
    const delta = actionId !== previousActionId.current ? 0 : deltaSeconds;
    previousActionId.current = actionId;
    try {
      presentation.tick(Math.min(2_000, Math.max(0, delta * 1_000)));
      animations.update(delta);
    } catch {
      presentation.skip("presentation-error");
      animations.clearUrgentAnimations();
    }
    if (presentation.active || animations.hasUrgentAnimation) invalidate();
  });

  return null;
}
