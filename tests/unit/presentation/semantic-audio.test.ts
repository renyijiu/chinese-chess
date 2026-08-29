import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SemanticAudioDirector,
  deriveSemanticCuePlan,
} from "../../../components/xiangqi/audio/SemanticAudioDirector";
import type { AudioEngine } from "../../../components/xiangqi/audio/AudioEngine";
import type { AudioTransientCueId } from "../../../components/xiangqi/audio/audio-types";
import { handlePresentationAudioCue } from "../../../components/xiangqi/audio/presentation-audio";
import type { GameActionTransition } from "../../../components/xiangqi/game/actions";
import { squareToWorld } from "../../../components/xiangqi/runtime/board-coordinates";
import { createInitialGame, dispatch, type DomainEvent, type GameState, type Side } from "../../../lib/xiangqi/index";

afterEach(() => vi.useRealTimers());

function endedGame(winner: Side | null): GameState & {
  status: Extract<GameState["status"], { kind: "ended" }>;
} {
  const game = createInitialGame();
  return {
    ...game,
    status: {
      kind: "ended",
      outcome: winner === "red" ? "red-win" : winner === "black" ? "black-win" : "draw",
      reason: winner === null ? "repetition" : "checkmate",
      winner,
    },
  };
}

function transition({
  actionId = "1:1:0",
  capture = false,
  check = false,
  undo = false,
  viewSide = "red",
  winner,
}: {
  actionId?: string;
  capture?: boolean;
  check?: boolean;
  undo?: boolean;
  viewSide?: Side;
  winner?: Side | null;
} = {}): GameActionTransition {
  const before = createInitialGame();
  if (undo) {
    const moved = dispatch(before, {
      expectedRevision: before.revision,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
      type: "move",
    });
    if (moved.error) throw new Error(moved.error.message);
    const undone = dispatch(moved.state, { expectedRevision: moved.state.revision, type: "undo" });
    if (undone.error) throw new Error(undone.error.message);
    return { actionId, after: undone.state, before: moved.state, events: undone.events, reducedMotion: false, viewSide };
  }
  const after = winner === undefined ? createInitialGame() : endedGame(winner);
  const events: DomainEvent[] = [];
  if (capture) {
    events.push({
      byPieceId: "red:soldier:0",
      eventId: "1:1",
      piece: { id: "black:soldier:0", role: "soldier", side: "black", square: { file: 0, rank: 6 } },
      revision: 1,
      type: "PieceCaptured",
    });
  }
  if (check) {
    events.push({ byPieceId: "red:chariot:0", eventId: "1:2", revision: 1, side: "black", type: "CheckDeclared" });
  }
  if (winner !== undefined) {
    events.push({ eventId: "1:3", revision: 1, status: endedGame(winner).status, type: "GameEnded" });
  }
  return { actionId, after, before, events, reducedMotion: false, viewSide };
}

function harness(eligible = true) {
  let canPlay = eligible;
  const played: AudioTransientCueId[] = [];
  const director = new SemanticAudioDirector({
    isTransientEligible: () => canPlay,
    playTransient: (cue) => {
      played.push(cue);
      return true;
    },
  });
  return {
    director,
    played,
    setEligible(next: boolean) { canPlay = next; },
  };
}

describe("semantic audio event selection", () => {
  it("selects capture plus non-terminal check and gives terminal results priority", () => {
    expect(deriveSemanticCuePlan(transition({ capture: true, check: true }))).toEqual({
      capture: "system.capture",
      completion: "system.check",
    });
    expect(deriveSemanticCuePlan(transition({ capture: true, check: true, viewSide: "red", winner: "red" }))).toEqual({
      capture: "system.capture",
      completion: "system.victory",
    });
    expect(deriveSemanticCuePlan(transition({ check: true, viewSide: "black", winner: "red" }))).toEqual({
      capture: null,
      completion: "system.defeat",
    });
    expect(deriveSemanticCuePlan(transition({ viewSide: "black", winner: null }))).toEqual({
      capture: null,
      completion: "system.draw",
    });
  });

  it("does not create semantic cues for undo", () => {
    expect(deriveSemanticCuePlan(transition({ undo: true }))).toEqual({ capture: null, completion: null });
  });

  it("leaves check and result playback out of the role-marker audio handler", () => {
    const play = vi.fn();
    const engine = { play, speak: vi.fn() } as unknown as AudioEngine;
    const action = transition({ capture: true, check: true, winner: "red" });

    handlePresentationAudioCue(engine, {
      actionId: action.actionId,
      marker: "complete",
      transition: action,
    });

    expect(play).not.toHaveBeenCalled();
  });

  it("spatializes undo cues along the reversed visual move", () => {
    const play = vi.fn();
    const engine = { play, speak: vi.fn() } as unknown as AudioEngine;
    const action = transition({ undo: true });

    handlePresentationAudioCue(engine, {
      actionId: action.actionId,
      marker: "telegraph",
      transition: action,
    });
    handlePresentationAudioCue(engine, {
      actionId: action.actionId,
      marker: "impact",
      transition: action,
    });

    expect(play.mock.calls[0]?.[1]).toEqual({ position: squareToWorld({ file: 0, rank: 4 }) });
    expect(play.mock.calls[1]?.[1]).toEqual({ position: squareToWorld({ file: 0, rank: 3 }) });
  });
});

describe("SemanticAudioDirector", () => {
  it("delivers impact and completion exactly once across repeated markers and settlement", () => {
    const { director, played } = harness();
    const action = transition({ capture: true, check: true });
    director.begin(action);

    director.marker(action.actionId, "impact");
    director.marker(action.actionId, "impact");
    director.marker(action.actionId, "complete");
    director.marker(action.actionId, "complete");
    director.settle(action.actionId, "complete");
    director.settle(action.actionId, "complete");

    expect(played).toEqual(["system.capture", "system.check"]);
    expect(director.activeCount).toBe(0);
  });

  it("compensates a user skip in capture-then-completion order without overlap", async () => {
    vi.useFakeTimers();
    const { director, played } = harness();
    const action = transition({ capture: true, check: true });
    director.begin(action);

    director.settle(action.actionId, "user-skip");

    expect(played).toEqual(["system.capture"]);
    await vi.advanceTimersByTimeAsync(499);
    expect(played).toEqual(["system.capture"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(played).toEqual(["system.capture", "system.check"]);
    expect(director.activeCount).toBe(0);
  });

  it("compensates only a missing completion after impact", () => {
    const { director, played } = harness();
    const action = transition({ capture: true, check: true });
    director.begin(action);
    director.marker(action.actionId, "impact");

    director.settle(action.actionId, "timeout");

    expect(played).toEqual(["system.capture", "system.check"]);
  });

  it("consumes muted or hidden markers without later catch-up", () => {
    const { director, played, setEligible } = harness(false);
    const action = transition({ capture: true, check: true });
    director.begin(action);
    director.marker(action.actionId, "impact");
    director.settle(action.actionId, "visibility-hidden");

    setEligible(true);
    director.marker(action.actionId, "impact");
    director.marker(action.actionId, "complete");

    expect(played).toEqual([]);
    expect(director.activeCount).toBe(0);
  });

  it("checks eligibility when a delayed completion is actually delivered", async () => {
    vi.useFakeTimers();
    const { director, played, setEligible } = harness();
    const action = transition({ capture: true, check: true });
    director.begin(action);
    director.settle(action.actionId, "presentation-error");
    setEligible(false);

    await vi.advanceTimersByTimeAsync(500);

    expect(played).toEqual(["system.capture"]);
    setEligible(true);
    await vi.runAllTimersAsync();
    expect(played).toEqual(["system.capture"]);
  });

  it("cancels pending compensation before reset or disposal", async () => {
    vi.useFakeTimers();
    const { director, played } = harness();
    const action = transition({ capture: true, check: true });
    director.begin(action);
    director.settle(action.actionId, "user-skip");

    director.cancelAll("match-reset");
    await vi.runAllTimersAsync();

    expect(played).toEqual(["system.capture"]);
    expect(director.activeCount).toBe(0);
  });

  it("cancels a begun ledger when presentation reports a duplicate", () => {
    const { director, played } = harness();
    const action = transition({ capture: true, check: true });
    director.begin(action);

    director.settle(action.actionId, "game-replaced");

    expect(played).toEqual([]);
    expect(director.activeCount).toBe(0);
  });

  it("keeps identical domain event IDs distinct across match epochs", () => {
    const { director, played } = harness();
    for (const actionId of ["1:1:0", "2:1:0"]) {
      const action = transition({ actionId, capture: true });
      director.begin(action);
      director.marker(action.actionId, "impact");
      director.settle(action.actionId, "complete");
    }

    expect(played).toEqual(["system.capture", "system.capture"]);
  });

  it("contains transient playback failures inside the audio boundary", () => {
    const director = new SemanticAudioDirector({
      isTransientEligible: () => true,
      playTransient: () => { throw new Error("source start failed"); },
    });
    const action = transition({ capture: true, check: true });
    director.begin(action);

    expect(() => {
      director.marker(action.actionId, "impact");
      director.marker(action.actionId, "complete");
      director.settle(action.actionId, "complete");
    }).not.toThrow();
    expect(director.activeCount).toBe(0);
  });
});
