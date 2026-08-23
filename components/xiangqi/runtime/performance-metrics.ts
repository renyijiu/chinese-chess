export type RendererPerformanceSample = Readonly<{
  drawCalls: number;
  frameIntervalMs: number;
  geometries: number;
  textures: number;
  triangles: number;
}>;

export type RuntimePerformanceSnapshot = Readonly<{
  currentDrawCalls: number;
  currentTriangles: number;
  geometries: number;
  peakDrawCalls: number;
  peakTriangles: number;
  /** Rendered-frame interval, not CPU/GPU render duration. */
  p95FrameIntervalMs: number;
  sampleCount: number;
  textures: number;
}>;

const EMPTY_SNAPSHOT: RuntimePerformanceSnapshot = Object.freeze({
  currentDrawCalls: 0,
  currentTriangles: 0,
  geometries: 0,
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
    if (Number.isFinite(sample.frameIntervalMs) && sample.frameIntervalMs > 0 && sample.frameIntervalMs <= 250) {
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
    const sorted = [...this.intervals].sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return {
      currentDrawCalls: this.current.drawCalls,
      currentTriangles: this.current.triangles,
      geometries: this.current.geometries,
      peakDrawCalls: this.peakDrawCalls,
      peakTriangles: this.peakTriangles,
      p95FrameIntervalMs: sorted[p95Index] ?? 0,
      sampleCount: sorted.length,
      textures: this.current.textures,
    };
  }
}
