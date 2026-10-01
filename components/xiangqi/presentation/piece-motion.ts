export type PieceMotion = "move" | "capture" | "captured" | "defeat";

export function moveLandingProgress(progress: number, capture: boolean) {
  const value = capture ? Math.min(1, Math.max(0, (progress - 0.58) / 0.36)) : progress;
  return value * value * (3 - 2 * value);
}

export function resolvePieceMotion(motion: PieceMotion, progress: number) {
  if (motion === "captured" || motion === "defeat") {
    return {
      animation: progress < 0.48 ? "idle_loop" : progress < 0.62 ? "hit_react" : "destroy",
      destroyProgress:
        motion === "captured"
          ? Math.min(0.99, Math.max(0, (progress - 0.61) / 0.34))
          : Math.min(0.98, Math.max(0, (progress - 0.52) / 0.42)),
    };
  }
  if (motion === "capture") {
    return {
      animation: progress < 0.58 ? "attack_primary" : progress < 0.88 ? "move_loop" : "move_end",
      destroyProgress: 0,
    };
  }
  return {
    animation: progress < 0.18 ? "move_start" : progress < 0.82 ? "move_loop" : "move_end",
    destroyProgress: 0,
  };
}
