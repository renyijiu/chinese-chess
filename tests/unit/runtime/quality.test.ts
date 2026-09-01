import { describe, expect, it, vi } from "vitest";

import {
  isScheduledFrameDue,
  runScheduledFrameTasks,
  type ScheduledFrameRegistration,
} from "../../../components/xiangqi/runtime/FrameScheduler";
import {
  QUALITY_PROFILES,
  getQualityProfile,
  resolveEnvironmentMotion,
} from "../../../components/xiangqi/runtime/quality";

describe("quality profiles", () => {
  it("isolates a failed ambient task and keeps the remaining tasks scheduled", () => {
    const failed = vi.fn(() => {
      throw new Error("optional layer failed");
    });
    const healthy = vi.fn();
    const onError = vi.fn();
    const tasks = new Set<ScheduledFrameRegistration>([
      { onError, task: failed },
      { task: healthy },
    ]);

    runScheduledFrameTasks(tasks, 1, 1 / 60);
    runScheduledFrameTasks(tasks, 2, 1 / 60);

    expect(failed).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(tasks.size).toBe(1);
  });

  it("does not halve a 60 Hz request because RAF timestamps are fractional", () => {
    expect(isScheduledFrameDue(16.65, 60)).toBe(true);
    expect(isScheduledFrameDue(12, 60)).toBe(false);
  });

  it("exposes the three stable public tiers", () => {
    expect(Object.keys(QUALITY_PROFILES)).toEqual(["high", "medium", "low"]);
  });

  it("reduces every expensive dimension monotonically", () => {
    const high = getQualityProfile("high");
    const medium = getQualityProfile("medium");
    const low = getQualityProfile("low");

    expect(high.dpr[1]).toBeGreaterThan(medium.dpr[1]);
    expect(medium.dpr[1]).toBeGreaterThan(low.dpr[1]);
    expect(high.shadowMapSize).toBeGreaterThan(medium.shadowMapSize);
    expect(medium.shadowMapSize).toBeGreaterThan(low.shadowMapSize);
    expect(high.particleScale).toBeGreaterThan(medium.particleScale);
    expect(medium.particleScale).toBeGreaterThan(low.particleScale);
    expect(high.ambientFps).toBeGreaterThan(medium.ambientFps);
    expect(medium.ambientFps).toBeGreaterThan(low.ambientFps);
    expect(high.environment.detailLevel).toBeGreaterThan(medium.environment.detailLevel);
    expect(medium.environment.detailLevel).toBeGreaterThan(low.environment.detailLevel);

    const panoramaCost = { high: 3, medium: 2, low: 1 } as const;
    expect(panoramaCost[high.environment.panorama]).toBeGreaterThan(
      panoramaCost[medium.environment.panorama],
    );
    expect(panoramaCost[medium.environment.panorama]).toBeGreaterThan(
      panoramaCost[low.environment.panorama],
    );
  });

  it("classifies environment shadows and dynamic lights for every tier", () => {
    expect(getQualityProfile("high").environment).toMatchObject({
      dynamicLightStrategy: "animated",
      shadowStrategy: "static-full",
    });
    expect(getQualityProfile("medium").environment).toMatchObject({
      dynamicLightStrategy: "static",
      shadowStrategy: "static-reduced",
    });
    expect(getQualityProfile("low").environment).toMatchObject({
      dynamicLightStrategy: "none",
      shadowStrategy: "none",
    });
  });

  it("turns off ambient environment motion without changing piece LOD or static detail", () => {
    for (const tier of ["high", "medium", "low"] as const) {
      const profile = getQualityProfile(tier);
      const lod = profile.lod;
      const detailLevel = profile.environment.detailLevel;
      const panorama = profile.environment.panorama;

      expect(resolveEnvironmentMotion(profile, false)).toBe(profile.environment.motion);
      const reducedMotion = resolveEnvironmentMotion(profile, true);
      expect(reducedMotion).toEqual({
        dust: false,
        dynamicLightUpdates: false,
        flags: false,
        river: false,
      });
      expect(Object.isFrozen(reducedMotion)).toBe(true);
      expect(profile.lod).toBe(lod);
      expect(profile.environment.detailLevel).toBe(detailLevel);
      expect(profile.environment.panorama).toBe(panorama);
    }
  });

  it("keeps advanced presentation exclusive to high quality", () => {
    expect(getQualityProfile("high")).toMatchObject({
      lod: 1,
      postprocessing: true,
      dynamicEffectLights: true,
      shadows: true,
    });
    expect(getQualityProfile("medium")).toMatchObject({ lod: 1, postprocessing: false });
    expect(getQualityProfile("low")).toMatchObject({
      lod: 2,
      postprocessing: false,
      dynamicEffectLights: false,
      shadows: false,
    });
  });

  it("returns immutable shared profiles rather than mutable copies", () => {
    expect(Object.isFrozen(getQualityProfile("high"))).toBe(true);
    expect(Object.isFrozen(getQualityProfile("high").dpr)).toBe(true);
    expect(Object.isFrozen(getQualityProfile("high").environment)).toBe(true);
    expect(Object.isFrozen(getQualityProfile("high").environment.motion)).toBe(true);
    expect(getQualityProfile("high")).toBe(QUALITY_PROFILES.high);
  });
});
