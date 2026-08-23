import { describe, expect, it, vi } from "vitest";

import { TimelineDirector } from "../../../components/xiangqi/animation/TimelineDirector";

describe("TimelineDirector", () => {
  it("fires every crossed marker exactly once across a large frame", async () => {
    const onMarker = vi.fn();
    const director = new TimelineDirector();
    const finished = director.play({
      durationMs: 1_000,
      id: "12:0",
      markers: [
        { at: 0, id: "telegraph" },
        { at: 0.2, id: "release" },
        { at: 0.55, id: "impact" },
        { at: 1, id: "complete" },
      ],
      onMarker,
    });

    director.tick(600);
    director.tick(50);
    director.tick(500);

    await expect(finished).resolves.toMatchObject({ id: "12:0", reason: "complete" });
    expect(onMarker.mock.calls.map(([marker]) => marker.id)).toEqual([
      "telegraph",
      "release",
      "impact",
      "complete",
    ]);
  });

  it("settles immediately when skipped without replaying pending cues", async () => {
    const onMarker = vi.fn();
    const director = new TimelineDirector();
    const finished = director.play({
      durationMs: 1_000,
      id: "13:0",
      markers: [{ at: 0.8, id: "vanish" }],
      onMarker,
    });

    director.tick(100);
    director.skip("13:0");

    await expect(finished).resolves.toMatchObject({ progress: 1, reason: "skipped" });
    expect(onMarker).not.toHaveBeenCalled();
    expect(director.activeCount).toBe(0);
  });

  it("times out and converges instead of leaving an action active", async () => {
    const director = new TimelineDirector();
    const finished = director.play({ durationMs: 500, id: "14:0", markers: [], timeoutMs: 700 });

    director.tick(701);

    await expect(finished).resolves.toMatchObject({ progress: 1, reason: "timeout" });
    expect(director.activeCount).toBe(0);
  });

  it("contains cue errors and still settles the visual state", async () => {
    const director = new TimelineDirector();
    const finished = director.play({
      durationMs: 500,
      id: "15:0",
      markers: [{ at: 0.2, id: "release" }],
      onMarker: () => {
        throw new Error("asset callback failed");
      },
    });

    director.tick(150);

    await expect(finished).resolves.toMatchObject({ progress: 1, reason: "error" });
    expect(director.activeCount).toBe(0);
  });
});
