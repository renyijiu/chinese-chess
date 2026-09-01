import { describe, expect, it } from "vitest";

import {
  PerformanceMetrics,
  summarizeFrameIntervals,
} from "../../../components/xiangqi/runtime/performance-metrics";

describe("PerformanceMetrics", () => {
  it("summarizes empty and nearest-rank frame interval distributions", () => {
    expect(summarizeFrameIntervals([])).toEqual({
      averageFrameIntervalMs: 0,
      maximumFrameIntervalMs: 0,
      p50FrameIntervalMs: 0,
      p90FrameIntervalMs: 0,
      p95FrameIntervalMs: 0,
    });
    expect(summarizeFrameIntervals([20, 12, 16, 14, 14])).toEqual({
      averageFrameIntervalMs: 15.2,
      maximumFrameIntervalMs: 20,
      p50FrameIntervalMs: 14,
      p90FrameIntervalMs: 20,
      p95FrameIntervalMs: 20,
    });
  });

  it("records bounded frame intervals, p95, renderer peaks, and latest resource counts", () => {
    const metrics = new PerformanceMetrics(5);
    [10, 12, 20, 16, 18].forEach((frameIntervalMs, index) => {
      metrics.record({
        drawCalls: 60 + index * 10,
        frameIntervalMs,
        geometries: 20 + index,
        textures: 8 + index,
        triangles: 100_000 + index * 10_000,
      });
    });

    expect(metrics.snapshot()).toEqual({
      averageFrameIntervalMs: 15.2,
      currentDrawCalls: 100,
      currentTriangles: 140_000,
      geometries: 24,
      maximumFrameIntervalMs: 20,
      peakDrawCalls: 100,
      peakTriangles: 140_000,
      p50FrameIntervalMs: 16,
      p90FrameIntervalMs: 20,
      p95FrameIntervalMs: 20,
      sampleCount: 5,
      textures: 12,
    });
  });

  it("ignores invalid intervals, bounds its sample window, and can reset measurements", () => {
    const metrics = new PerformanceMetrics(2);
    metrics.record({
      drawCalls: 5,
      frameIntervalMs: Number.NaN,
      geometries: 1,
      textures: 1,
      triangles: 10,
    });
    metrics.record({
      drawCalls: 8,
      frameIntervalMs: 10,
      geometries: 2,
      textures: 2,
      triangles: 20,
    });
    metrics.record({
      drawCalls: 9,
      frameIntervalMs: 12,
      geometries: 3,
      textures: 3,
      triangles: 30,
    });
    metrics.record({
      drawCalls: 10,
      frameIntervalMs: 14,
      geometries: 4,
      textures: 4,
      triangles: 40,
    });

    expect(metrics.snapshot().sampleCount).toBe(2);
    expect(metrics.snapshot().p95FrameIntervalMs).toBe(14);
    metrics.reset();
    expect(metrics.snapshot()).toMatchObject({
      peakDrawCalls: 0,
      p95FrameIntervalMs: 0,
      sampleCount: 0,
    });
  });
});
