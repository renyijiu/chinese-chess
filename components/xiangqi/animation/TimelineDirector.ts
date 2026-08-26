export type TimelineMarker = Readonly<{
  /** Normalized time in the inclusive range 0..1. */
  at: number;
  id: string;
}>;

export type TimelineEndReason =
  | "complete"
  | "user-skip"
  | "timeout"
  | "presentation-error"
  | "visibility-hidden"
  | "match-reset"
  | "game-replaced"
  | "dispose";

export type TimelineInterruptionReason = Exclude<TimelineEndReason, "complete">;

export type TimelineResult = Readonly<{
  id: string;
  progress: 1;
  reason: TimelineEndReason;
}>;

export type TimelineSpec = Readonly<{
  durationMs: number;
  id: string;
  markers: readonly TimelineMarker[];
  onMarker?: (marker: TimelineMarker) => void;
  onProgress?: (progress: number) => void;
  timeoutMs?: number;
}>;

type ActiveTimeline = {
  elapsedMs: number;
  fired: Set<string>;
  markers: readonly TimelineMarker[];
  resolve: (result: TimelineResult) => void;
  spec: TimelineSpec;
};

const EPSILON = Number.EPSILON;

function normalized(value: number) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Clock-agnostic timeline runner. The render runtime owns the clock so tests,
 * hidden-tab recovery, and demand rendering all share the same semantics.
 */
export class TimelineDirector {
  private readonly active = new Map<string, ActiveTimeline>();

  get activeCount() {
    return this.active.size;
  }

  play(spec: TimelineSpec): Promise<TimelineResult> {
    this.skip(spec.id, "game-replaced");
    const durationMs = Math.max(1, spec.durationMs);
    const markers = [...spec.markers]
      .map((marker) => ({ ...marker, at: normalized(marker.at) }))
      .sort((left, right) => left.at - right.at);

    return new Promise<TimelineResult>((resolve) => {
      this.active.set(spec.id, {
        elapsedMs: 0,
        fired: new Set(),
        markers,
        resolve,
        spec: { ...spec, durationMs },
      });
    });
  }

  tick(deltaMs: number) {
    const safeDelta = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
    for (const timeline of [...this.active.values()]) {
      const { spec } = timeline;
      const timeoutMs = Math.max(spec.durationMs, spec.timeoutMs ?? spec.durationMs + 1_000);
      const previous = timeline.elapsedMs;
      const next = previous + safeDelta;

      if (next >= timeoutMs && timeoutMs > spec.durationMs) {
        this.settle(spec.id, "timeout");
        continue;
      }

      timeline.elapsedMs = Math.min(next, spec.durationMs);
      const progress = normalized(timeline.elapsedMs / spec.durationMs);
      try {
        spec.onProgress?.(progress);
        for (const marker of timeline.markers) {
          const markerMs = marker.at * spec.durationMs;
          if (timeline.fired.has(marker.id)) continue;
          if (markerMs >= previous - EPSILON && markerMs <= timeline.elapsedMs) {
            timeline.fired.add(marker.id);
            spec.onMarker?.(marker);
          }
        }
      } catch {
        this.settle(spec.id, "presentation-error");
        continue;
      }

      if (progress >= 1) this.settle(spec.id, "complete");
    }
  }

  skip(id?: string, reason: TimelineInterruptionReason = "user-skip") {
    if (id) {
      this.settle(id, reason);
      return;
    }
    for (const activeId of [...this.active.keys()]) this.settle(activeId, reason);
  }

  private settle(id: string, reason: TimelineEndReason) {
    const timeline = this.active.get(id);
    if (!timeline) return;
    this.active.delete(id);
    try {
      timeline.spec.onProgress?.(1);
    } catch {
      // Rule state already committed; settling must never be blocked by visuals.
    }
    timeline.resolve({ id, progress: 1, reason });
  }
}
