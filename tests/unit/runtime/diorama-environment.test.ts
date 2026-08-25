import { describe, expect, it } from "vitest";

import {
  getDioramaPropPlacements,
  getPanoramaUrl,
  resolveEnvironmentStatus,
} from "../../../components/xiangqi/scene/diorama-environment";

describe("Qin hybrid diorama environment", () => {
  it("selects exactly one versioned panorama URL for each quality variant", () => {
    expect(getPanoramaUrl("high")).toBe("/background/qin-diorama-panorama-v1-high.webp");
    expect(getPanoramaUrl("medium")).toBe("/background/qin-diorama-panorama-v1-medium.webp");
    expect(getPanoramaUrl("low")).toBe("/background/qin-diorama-panorama-v1-low.webp");
  });

  it("reduces static prop density monotonically while preserving the core Qin silhouette", () => {
    const high = getDioramaPropPlacements(3);
    const medium = getDioramaPropPlacements(2);
    const low = getDioramaPropPlacements(1);

    expect(high.length).toBeGreaterThan(medium.length);
    expect(medium.length).toBeGreaterThan(low.length);
    expect(high.slice(0, medium.length)).toEqual(medium);
    expect(medium.slice(0, low.length)).toEqual(low);
    expect(new Set(low.map(({ kind }) => kind))).toEqual(
      new Set(["wall", "pit-corridor", "mound", "gate"]),
    );
  });

  it("keeps every optional prop outside the playable board safe zone", () => {
    for (const placement of getDioramaPropPlacements(3)) {
      const [x, , z] = placement.position;
      expect(Math.abs(x) >= 6.7 || Math.abs(z) >= 6.9).toBe(true);
    }
  });

  it("reports a terminal status only after every optional layer settles", () => {
    expect(resolveEnvironmentStatus(["loading", "ready"])).toBe("loading");
    expect(resolveEnvironmentStatus(["ready", "ready"])).toBe("ready");
    expect(resolveEnvironmentStatus(["degraded", "loading"])).toBe("loading");
    expect(resolveEnvironmentStatus(["ready", "degraded"])).toBe("degraded");
  });
});
