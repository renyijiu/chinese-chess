export type RendererPerformanceSample = Readonly<{
  drawCalls: number;
  frameIntervalMs: number;
  geometries: number;
  textures: number;
  triangles: number;
}>;

export type RuntimePerformanceSnapshot = Readonly<{
  averageFrameIntervalMs: number;
  currentDrawCalls: number;
  currentTriangles: number;
  geometries: number;
  maximumFrameIntervalMs: number;
  p50FrameIntervalMs: number;
  p90FrameIntervalMs: number;
  peakDrawCalls: number;
  peakTriangles: number;
  /** Rendered-frame interval, not CPU/GPU render duration. */
  p95FrameIntervalMs: number;
  sampleCount: number;
  textures: number;
}>;

export type FrameIntervalSummary = Readonly<{
  averageFrameIntervalMs: number;
  maximumFrameIntervalMs: number;
  p50FrameIntervalMs: number;
  p90FrameIntervalMs: number;
  p95FrameIntervalMs: number;
}>;

export function summarizeFrameIntervals(intervals: readonly number[]): FrameIntervalSummary {
  const sorted = [...intervals].sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
  return {
    averageFrameIntervalMs:
      sorted.length > 0
        ? sorted.reduce((total, interval) => total + interval, 0) / sorted.length
        : 0,
    maximumFrameIntervalMs: sorted.at(-1) ?? 0,
    p50FrameIntervalMs: percentile(0.5),
    p90FrameIntervalMs: percentile(0.9),
    p95FrameIntervalMs: percentile(0.95),
  };
}

const EMPTY_SNAPSHOT: RuntimePerformanceSnapshot = Object.freeze({
  averageFrameIntervalMs: 0,
  currentDrawCalls: 0,
  currentTriangles: 0,
  geometries: 0,
  maximumFrameIntervalMs: 0,
  p50FrameIntervalMs: 0,
  p90FrameIntervalMs: 0,
  peakDrawCalls: 0,
  peakTriangles: 0,
  p95FrameIntervalMs: 0,
  sampleCount: 0,
  textures: 0,
});

export class PerformanceMetrics {
  private current: RendererPerformanceSample | null = null;
  private readonly intervals: number[] = [];
  private peakDrawCalls = 0;
  private peakTriangles = 0;

  constructor(private readonly maximumSamples = 300) {}

  record(sample: RendererPerformanceSample) {
    this.current = sample;
    this.peakDrawCalls = Math.max(this.peakDrawCalls, sample.drawCalls);
    this.peakTriangles = Math.max(this.peakTriangles, sample.triangles);
    if (
      Number.isFinite(sample.frameIntervalMs) &&
      sample.frameIntervalMs > 0 &&
      sample.frameIntervalMs <= 250
    ) {
      this.intervals.push(sample.frameIntervalMs);
      while (this.intervals.length > Math.max(1, this.maximumSamples)) this.intervals.shift();
    }
  }

  reset() {
    this.current = null;
    this.intervals.length = 0;
    this.peakDrawCalls = 0;
    this.peakTriangles = 0;
  }

  snapshot(): RuntimePerformanceSnapshot {
    if (!this.current) return EMPTY_SNAPSHOT;
    const intervalSummary = summarizeFrameIntervals(this.intervals);
    return {
      ...intervalSummary,
      currentDrawCalls: this.current.drawCalls,
      currentTriangles: this.current.triangles,
      geometries: this.current.geometries,
      peakDrawCalls: this.peakDrawCalls,
      peakTriangles: this.peakTriangles,
      sampleCount: this.intervals.length,
      textures: this.current.textures,
    };
  }
}
