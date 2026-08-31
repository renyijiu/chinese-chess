import type { GameActionTransition } from "../game/actions";
import {
  TimelineDirector,
  type TimelineInterruptionReason,
  type TimelineMarker,
  type TimelineResult,
} from "../animation/TimelineDirector";

export type PresentationMarker =
  | "telegraph"
  | "release"
  | "impact"
  | "fracture"
  | "vanish"
  | "complete";

export type ActivePresentation = Readonly<{
  firedMarkers: ReadonlySet<PresentationMarker>;
  progress: number;
  transition: GameActionTransition;
}>;

export type PresentationSnapshot = Readonly<{
  active: ActivePresentation | null;
}>;

export type PresentationCue = Readonly<{
  actionId: string;
  marker: PresentationMarker;
  transition: GameActionTransition;
}>;

const IDLE_SNAPSHOT: PresentationSnapshot = Object.freeze({ active: null });
const MOVE_MARKERS: readonly TimelineMarker[] = [
  { at: 0, id: "telegraph" },
  { at: 0.18, id: "release" },
  { at: 0.78, id: "impact" },
  { at: 1, id: "complete" },
];
const CAPTURE_MARKERS: readonly TimelineMarker[] = [
  { at: 0, id: "telegraph" },
  { at: 0.2, id: "release" },
  { at: 0.5, id: "impact" },
  { at: 0.61, id: "fracture" },
  { at: 0.8, id: "vanish" },
  { at: 1, id: "complete" },
];

function isCapture(transition: GameActionTransition) {
  return transition.events.some((event) => event.type === "PieceCaptured");
}

function isMove(transition: GameActionTransition) {
  return transition.events.some((event) => event.type === "MoveCommitted");
}

function isTerminalDefeat(transition: GameActionTransition) {
  return transition.events.some((event) => event.type === "Resigned" || event.type === "GameEnded");
}

export class PresentationStore {
  private activePromise: Promise<TimelineResult> | null = null;
  private readonly completedIds = new Set<string>();
  private readonly cueListeners = new Set<(cue: PresentationCue) => void>();
  private readonly listeners = new Set<() => void>();
  private readonly timeline = new TimelineDirector();
  private disposed = false;
  private fallbackActionId: string | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: PresentationSnapshot = IDLE_SNAPSHOT;

  readonly getSnapshot = () => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly subscribeCue = (listener: (cue: PresentationCue) => void) => {
    this.cueListeners.add(listener);
    return () => {
      this.cueListeners.delete(listener);
    };
  };

  get active() {
    return this.timeline.activeCount > 0;
  }

  get resourceCounts() {
    return {
      activeTimelines: this.timeline.activeCount,
      cueListeners: this.cueListeners.size,
      listeners: this.listeners.size,
      timers: this.fallbackTimer === null ? 0 : 1,
    } as const;
  }

  debugSnapshot() {
    return {
      activeActionId: this.snapshot.active?.transition.actionId ?? null,
      completedActionIds: [...this.completedIds],
      ...this.resourceCounts,
    } as const;
  }

  play(transition: GameActionTransition): Promise<TimelineResult | { id: string; progress: 1; reason: "duplicate" }> {
    if (this.completedIds.has(transition.actionId)) {
      return Promise.resolve({ id: transition.actionId, progress: 1, reason: "duplicate" });
    }
    if (this.snapshot.active?.transition.actionId === transition.actionId && this.activePromise) {
      return this.activePromise;
    }

    this.clearFallbackTimer();
    this.timeline.skip(undefined, "game-replaced");
    const capture = isCapture(transition);
    const moving = isMove(transition);
    const terminalDefeat = isTerminalDefeat(transition);
    const durationMs = transition.reducedMotion ? 100 : capture ? 1_500 : terminalDefeat ? 900 : moving ? 700 : 550;
    const markers = capture || terminalDefeat ? CAPTURE_MARKERS : MOVE_MARKERS;
    const firedMarkers = new Set<PresentationMarker>();
    this.snapshot = {
      active: { firedMarkers, progress: 0, transition },
    };
    this.emit();

    const timeoutMs = durationMs + 750;
    const pending = this.timeline.play({
      durationMs,
      id: transition.actionId,
      markers,
      onMarker: (marker) => {
        const presentationMarker = marker.id as PresentationMarker;
        firedMarkers.add(presentationMarker);
        this.cueListeners.forEach((listener) => {
          try {
            listener({
              actionId: transition.actionId,
              marker: presentationMarker,
              transition,
            });
          } catch {
            // A future audio/VFX cue consumer cannot stop the authoritative timeline.
          }
        });
        this.publishActive(transition, firedMarkers, this.snapshot.active?.progress ?? 0);
      },
      onProgress: (progress) => this.publishActive(transition, firedMarkers, progress),
      timeoutMs,
    }).then((result) => {
      this.clearFallbackTimer(transition.actionId);
      if (!this.disposed) {
        this.completedIds.add(transition.actionId);
        if (this.completedIds.size > 256) {
          const oldest = this.completedIds.values().next().value;
          if (oldest) this.completedIds.delete(oldest);
        }
      }
      if (this.snapshot.active?.transition.actionId === transition.actionId) {
        this.snapshot = IDLE_SNAPSHOT;
        this.activePromise = null;
        this.emit();
      }
      return result;
    });
    this.fallbackTimer = setTimeout(() => {
      if (this.snapshot.active?.transition.actionId === transition.actionId) {
        this.timeline.skip(transition.actionId, "timeout");
      }
    }, timeoutMs);
    this.fallbackActionId = transition.actionId;
    this.activePromise = pending;
    return pending;
  }

  tick(deltaMs: number) {
    this.timeline.tick(deltaMs);
  }

  skip(reason: TimelineInterruptionReason = "user-skip") {
    this.clearFallbackTimer();
    this.timeline.skip(undefined, reason);
  }

  dispose() {
    this.disposed = true;
    this.skip("dispose");
    this.completedIds.clear();
    this.cueListeners.clear();
    this.listeners.clear();
    this.snapshot = IDLE_SNAPSHOT;
    this.activePromise = null;
  }

  private clearFallbackTimer(expectedActionId?: string) {
    if (expectedActionId && this.fallbackActionId !== expectedActionId) return;
    if (this.fallbackTimer === null) return;
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.fallbackActionId = null;
  }

  private publishActive(
    transition: GameActionTransition,
    markers: ReadonlySet<PresentationMarker>,
    progress: number,
  ) {
    if (this.snapshot.active?.transition.actionId !== transition.actionId) return;
    this.snapshot = {
      active: {
        firedMarkers: new Set(markers),
        progress,
        transition,
      },
    };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
