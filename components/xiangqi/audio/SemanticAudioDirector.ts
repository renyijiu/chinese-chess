import type { TimelineEndReason, TimelineInterruptionReason } from "../animation/TimelineDirector";
import type { GameActionTransition } from "../game/actions";
import type { PresentationMarker } from "../presentation/PresentationStore";
import type { AudioTransientCueId } from "./audio-types";

type SemanticCuePlan = Readonly<{
  capture: Extract<AudioTransientCueId, "system.capture"> | null;
  completion: Exclude<AudioTransientCueId, "system.capture"> | null;
}>;

type ScheduleHandle = ReturnType<typeof setTimeout> | number;

type SemanticAudioOutput = Readonly<{
  isTransientEligible(): boolean;
  playTransient(cue: AudioTransientCueId): boolean;
}>;

type SemanticAudioDirectorOptions = Readonly<{
  captureDurationMs?: number;
  clearScheduled?: (handle: ScheduleHandle) => void;
  completionGapMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ScheduleHandle;
}>;

type SemanticLedger = {
  captureConsumed: boolean;
  completionConsumed: boolean;
  plan: SemanticCuePlan;
  scheduled: ScheduleHandle | null;
  settling: boolean;
};

const COMPENSATING_CAUSES = new Set<TimelineEndReason>([
  "user-skip",
  "timeout",
  "presentation-error",
]);
const MAX_COMPLETED_ACTIONS = 256;
const AUDITED_CAPTURE_DURATION_MS = 420;
const DEFAULT_COMPLETION_GAP_MS = 80;

export function deriveSemanticCuePlan(transition: GameActionTransition): SemanticCuePlan {
  if (transition.events.some((event) => event.type === "MoveUndone")) {
    return { capture: null, completion: null };
  }

  const capture = transition.events.some((event) => event.type === "PieceCaptured")
    ? "system.capture"
    : null;
  const ended = transition.events.find((event) => event.type === "GameEnded");
  if (ended?.type === "GameEnded") {
    const winner = ended.status.winner;
    return {
      capture,
      completion:
        winner === null
          ? "system.draw"
          : winner === transition.viewSide
            ? "system.victory"
            : "system.defeat",
    };
  }

  return {
    capture,
    completion: transition.events.some((event) => event.type === "CheckDeclared")
      ? "system.check"
      : null,
  };
}

/**
 * Owns match-scoped semantic audio only. Role, voice, animation, and VFX cues
 * remain marker-driven consumers and are intentionally never compensated.
 */
export class SemanticAudioDirector {
  private readonly captureCompletionDelayMs: number;
  private readonly clearScheduled: (handle: ScheduleHandle) => void;
  private readonly completedIds = new Set<string>();
  private readonly ledgers = new Map<string, SemanticLedger>();
  private readonly output: SemanticAudioOutput;
  private readonly schedule: (callback: () => void, delayMs: number) => ScheduleHandle;

  constructor(output: SemanticAudioOutput, options: SemanticAudioDirectorOptions = {}) {
    this.output = output;
    this.captureCompletionDelayMs =
      Math.max(0, options.captureDurationMs ?? AUDITED_CAPTURE_DURATION_MS) +
      Math.max(0, options.completionGapMs ?? DEFAULT_COMPLETION_GAP_MS);
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearScheduled =
      options.clearScheduled ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get activeCount() {
    return this.ledgers.size;
  }

  begin(transition: GameActionTransition) {
    if (this.completedIds.has(transition.actionId) || this.ledgers.has(transition.actionId))
      return false;
    const plan = deriveSemanticCuePlan(transition);
    if (!plan.capture && !plan.completion) {
      this.rememberCompleted(transition.actionId);
      return false;
    }
    this.ledgers.set(transition.actionId, {
      captureConsumed: !plan.capture,
      completionConsumed: !plan.completion,
      plan,
      scheduled: null,
      settling: false,
    });
    return true;
  }

  marker(actionId: string, marker: PresentationMarker) {
    const ledger = this.ledgers.get(actionId);
    if (!ledger || ledger.settling) return;
    if (marker === "impact") this.consumeCapture(ledger);
    if (marker === "complete") this.consumeCompletion(ledger);
  }

  settle(actionId: string, cause: TimelineEndReason) {
    const ledger = this.ledgers.get(actionId);
    if (!ledger) return;

    if (ledger.settling) {
      if (cause === "match-reset" || cause === "game-replaced" || cause === "dispose") {
        this.finish(actionId, ledger);
      }
      return;
    }

    ledger.settling = true;
    if (!COMPENSATING_CAUSES.has(cause) || !this.eligible()) {
      ledger.captureConsumed = true;
      ledger.completionConsumed = true;
      this.finish(actionId, ledger);
      return;
    }

    const captureWasMissing = !ledger.captureConsumed;
    this.consumeCapture(ledger);
    if (ledger.completionConsumed) {
      this.finish(actionId, ledger);
      return;
    }
    if (!captureWasMissing) {
      this.consumeCompletion(ledger);
      this.finish(actionId, ledger);
      return;
    }

    try {
      ledger.scheduled = this.schedule(() => {
        const current = this.ledgers.get(actionId);
        if (current !== ledger) return;
        ledger.scheduled = null;
        this.consumeCompletion(ledger);
        this.finish(actionId, ledger);
      }, this.captureCompletionDelayMs);
    } catch {
      this.consumeCompletion(ledger);
      this.finish(actionId, ledger);
    }
  }

  cancelAll(
    cause: Extract<TimelineInterruptionReason, "match-reset" | "game-replaced" | "dispose">,
  ) {
    for (const actionId of [...this.ledgers.keys()]) this.settle(actionId, cause);
  }

  dispose() {
    this.cancelAll("dispose");
    this.completedIds.clear();
  }

  private consumeCapture(ledger: SemanticLedger) {
    if (ledger.captureConsumed) return;
    ledger.captureConsumed = true;
    if (ledger.plan.capture && this.eligible()) {
      try {
        this.output.playTransient(ledger.plan.capture);
      } catch {
        /* Audio cannot reject presentation. */
      }
    }
  }

  private consumeCompletion(ledger: SemanticLedger) {
    if (ledger.completionConsumed) return;
    ledger.completionConsumed = true;
    if (ledger.plan.completion && this.eligible()) {
      try {
        this.output.playTransient(ledger.plan.completion);
      } catch {
        /* Audio cannot reject presentation. */
      }
    }
  }

  private finish(actionId: string, ledger: SemanticLedger) {
    if (ledger.scheduled !== null) {
      this.clearScheduled(ledger.scheduled);
      ledger.scheduled = null;
    }
    if (this.ledgers.get(actionId) !== ledger) return;
    this.ledgers.delete(actionId);
    this.rememberCompleted(actionId);
  }

  private rememberCompleted(actionId: string) {
    this.completedIds.add(actionId);
    if (this.completedIds.size <= MAX_COMPLETED_ACTIONS) return;
    const oldest = this.completedIds.values().next().value;
    if (oldest) this.completedIds.delete(oldest);
  }

  private eligible() {
    try {
      return this.output.isTransientEligible();
    } catch {
      return false;
    }
  }
}
