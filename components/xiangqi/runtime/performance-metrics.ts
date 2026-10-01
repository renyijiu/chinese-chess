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
  renderedFrames: number;
  longFrames50Ms: number;
  longFrames100Ms: number;
  longFrames250Ms: number;
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
  renderedFrames: 0,
  longFrames50Ms: 0,
  longFrames100Ms: 0,
  longFrames250Ms: 0,
  textures: 0,
});

export class PerformanceMetrics {
  private current: RendererPerformanceSample | null = null;
  private readonly intervals: number[] = [];
  private peakDrawCalls = 0;
  private peakTriangles = 0;
  private renderedFrames = 0;
  private longFrames50Ms = 0;
  private longFrames100Ms = 0;
  private longFrames250Ms = 0;

  constructor(private readonly maximumSamples = 300) {}

  record(sample: RendererPerformanceSample, continuous = true) {
    this.current = sample;
    this.renderedFrames += 1;
    this.peakDrawCalls = Math.max(this.peakDrawCalls, sample.drawCalls);
    this.peakTriangles = Math.max(this.peakTriangles, sample.triangles);
    if (continuous && Number.isFinite(sample.frameIntervalMs) && sample.frameIntervalMs > 0) {
      if (sample.frameIntervalMs > 50) this.longFrames50Ms += 1;
      if (sample.frameIntervalMs > 100) this.longFrames100Ms += 1;
      if (sample.frameIntervalMs > 250) this.longFrames250Ms += 1;
      this.intervals.push(sample.frameIntervalMs);
      while (this.intervals.length > Math.max(1, this.maximumSamples)) this.intervals.shift();
    }
  }

  reset() {
    this.current = null;
    this.intervals.length = 0;
    this.peakDrawCalls = 0;
    this.peakTriangles = 0;
    this.renderedFrames = 0;
    this.longFrames50Ms = 0;
    this.longFrames100Ms = 0;
    this.longFrames250Ms = 0;
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
      renderedFrames: this.renderedFrames,
      longFrames50Ms: this.longFrames50Ms,
      longFrames100Ms: this.longFrames100Ms,
      longFrames250Ms: this.longFrames250Ms,
      textures: this.current.textures,
    };
  }
}
