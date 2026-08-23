import { describe, expect, it } from "vitest";

import { isScheduledFrameDue } from "../../../components/xiangqi/runtime/FrameScheduler";
import { QUALITY_PROFILES, getQualityProfile } from "../../../components/xiangqi/runtime/quality";

describe("quality profiles", () => {
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
    expect(getQualityProfile("high")).toBe(QUALITY_PROFILES.high);
  });
});
