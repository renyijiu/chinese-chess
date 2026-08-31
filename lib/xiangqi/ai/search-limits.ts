import type { LightweightTier } from "./types";

export type OpponentSearchLimits = Readonly<{
  nodeBudget: number;
  depthCeiling: number;
  safetyDeadlineMs: number;
}>;

export const LIGHTWEIGHT_TIER_LIMITS: Readonly<Record<LightweightTier, OpponentSearchLimits>> =
  Object.freeze({
    "lightweight-easy": Object.freeze({
      nodeBudget: 2_000,
      depthCeiling: 3,
      safetyDeadlineMs: 250,
    }),
    "lightweight-normal": Object.freeze({
      nodeBudget: 10_000,
      depthCeiling: 5,
      safetyDeadlineMs: 750,
    }),
    "lightweight-hard": Object.freeze({
      nodeBudget: 50_000,
      depthCeiling: 7,
      safetyDeadlineMs: 2_000,
    }),
  });

export const MASTER_SEARCH_LIMITS: OpponentSearchLimits = Object.freeze({
  nodeBudget: 200_000,
  depthCeiling: 12,
  safetyDeadlineMs: 5_000,
});
