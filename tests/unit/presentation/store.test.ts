import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialGame, dispatch } from "../../../lib/xiangqi/index";
import { PresentationStore } from "../../../components/xiangqi/presentation/PresentationStore";

afterEach(() => vi.useRealTimers());

function firstSoldierMove() {
  const before = createInitialGame();
  const result = dispatch(before, {
    expectedRevision: before.revision,
    from: { file: 0, rank: 3 },
    to: { file: 0, rank: 4 },
    type: "move",
  });
  if (result.error) throw new Error(result.error.message);
  return {
    actionId: result.events[0]!.eventId,
    after: result.state,
    before,
    events: result.events,
    reducedMotion: false,
    viewSide: "red",
  } as const;
}

describe("PresentationStore", () => {
  it("keeps the committed rule snapshots separate from interpolated visual progress", async () => {
    const store = new PresentationStore();
    const transition = firstSoldierMove();
    const finished = store.play(transition);

    expect(store.getSnapshot().active?.transition.before).toBe(transition.before);
    expect(store.getSnapshot().active?.transition.after).toBe(transition.after);
    expect(store.getSnapshot().active?.progress).toBe(0);

    store.tick(350);
    expect(store.getSnapshot().active?.progress).toBeGreaterThan(0);
    expect(transition.after.board[4 * 9]?.id).toBe("red:soldier:0");

    store.skip("user-skip");
    await finished;
    expect(store.getSnapshot().active).toBeNull();
  });

  it("deduplicates a completed domain action id", async () => {
    const store = new PresentationStore();
    const transition = { ...firstSoldierMove(), reducedMotion: true };
    const first = store.play(transition);
    store.tick(100);
    await first;

    await expect(store.play(transition)).resolves.toMatchObject({ reason: "duplicate" });
    expect(store.getSnapshot().active).toBeNull();
  });

  it("does not restart an in-flight domain action id", async () => {
    const store = new PresentationStore();
    const transition = firstSoldierMove();
    const first = store.play(transition);
    const duplicate = store.play(transition);

    expect(duplicate).toBe(first);
    store.skip("user-skip");
    await first;
  });

  it("uses a wall-clock fail-safe when no render frame can advance", async () => {
    vi.useFakeTimers();
    const store = new PresentationStore();
    const finished = store.play(firstSoldierMove());

    await vi.advanceTimersByTimeAsync(1_451);

    await expect(finished).resolves.toMatchObject({ progress: 1, reason: "timeout" });
    expect(store.getSnapshot().active).toBeNull();
  });

  it("disposes an active timeline, pending timer, and every subscriber", async () => {
    vi.useFakeTimers();
    const store = new PresentationStore();
    const stateListener = vi.fn();
    const cueListener = vi.fn();
    store.subscribe(stateListener);
    store.subscribeCue(cueListener);
    const finished = store.play(firstSoldierMove());

    expect(store.resourceCounts).toEqual({ activeTimelines: 1, cueListeners: 1, listeners: 1, timers: 1 });
    store.dispose();

    await expect(finished).resolves.toMatchObject({ reason: "dispose" });
    expect(store.resourceCounts).toEqual({ activeTimelines: 0, cueListeners: 0, listeners: 0, timers: 0 });
    expect(store.debugSnapshot().completedActionIds).toEqual([]);
    await vi.runAllTimersAsync();
    expect(cueListener).not.toHaveBeenCalled();
  });

  it("keeps resource counts stable across 100 presentation attach/play/detach cycles", async () => {
    vi.useFakeTimers();
    const store = new PresentationStore();

    for (let index = 0; index < 100; index += 1) {
      const unsubscribeState = store.subscribe(() => undefined);
      const unsubscribeCue = store.subscribeCue(() => undefined);
      const transition = { ...firstSoldierMove(), actionId: `cycle:${index}`, reducedMotion: true };
      const finished = store.play(transition);
      store.skip("user-skip");
      await finished;
      unsubscribeCue();
      unsubscribeState();
      expect(store.resourceCounts).toEqual({ activeTimelines: 0, cueListeners: 0, listeners: 0, timers: 0 });
    }
  });

  it("preserves the classified early-settlement reason", async () => {
    const store = new PresentationStore();
    const transition = firstSoldierMove();

    const hidden = store.play(transition);
    store.skip("visibility-hidden");
    await expect(hidden).resolves.toMatchObject({ reason: "visibility-hidden" });

    const replacement = store.play({ ...transition, actionId: "2:1:0" });
    store.skip("game-replaced");
    await expect(replacement).resolves.toMatchObject({ reason: "game-replaced" });
  });

  it("classifies an in-flight action displaced by a new action as game replacement", async () => {
    const store = new PresentationStore();
    const first = store.play(firstSoldierMove());
    const second = store.play({ ...firstSoldierMove(), actionId: "2:1:0" });

    await expect(first).resolves.toMatchObject({ reason: "game-replaced" });
    store.skip("user-skip");
    await second;
  });
});
