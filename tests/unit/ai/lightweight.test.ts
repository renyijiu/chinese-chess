import { describe, expect, it } from "vitest";
import {
  createInitialGame,
  dispatch,
  getLegalMoves,
  getPieceAt,
  type GameState,
} from "../../../lib/xiangqi/index";
import {
  LIGHTWEIGHT_TIER_LIMITS,
  createLightweightSearch,
  evaluatePosition,
  getDeterministicFallbackCandidate,
  runLightweightSearchBatched,
} from "../../../lib/xiangqi/ai/index";
import { makeState, piece } from "../xiangqi/fixtures";

function commit(state: GameState, from: [number, number], to: [number, number]): GameState {
  const result = dispatch(state, {
    type: "move",
    expectedRevision: state.revision,
    from: { file: from[0], rank: from[1] },
    to: { file: to[0], rank: to[1] },
  });
  expect(result.error).toBeUndefined();
  return result.state;
}

function assertLegal(state: GameState, candidate: { from: { file: number; rank: number }; to: { file: number; rank: number } }): void {
  const result = dispatch(state, {
    type: "move",
    expectedRevision: state.revision,
    ...candidate,
  });
  expect(result.error).toBeUndefined();
}

describe("lightweight Xiangqi search", () => {
  it("uses strictly increasing Easy, Normal, and Hard budgets", () => {
    const easy = LIGHTWEIGHT_TIER_LIMITS["lightweight-easy"];
    const normal = LIGHTWEIGHT_TIER_LIMITS["lightweight-normal"];
    const hard = LIGHTWEIGHT_TIER_LIMITS["lightweight-hard"];
    expect(easy.nodeBudget).toBeLessThan(normal.nodeBudget);
    expect(normal.nodeBudget).toBeLessThan(hard.nodeBudget);
    expect(easy.depthCeiling).toBeLessThanOrEqual(normal.depthCeiling);
    expect(normal.depthCeiling).toBeLessThanOrEqual(hard.depthCeiling);
  });

  it("returns a fixed-seed repeatable legal move from the last completed depth", async () => {
    const state = createInitialGame();
    const run = () => runLightweightSearchBatched(state, {
      tier: "lightweight-easy",
      seed: "repeatable",
      nodeBudget: 2_000,
      depthCeiling: 3,
      safetyDeadlineMs: 60_000,
      batchNodes: 17,
      now: () => 0,
      yieldTask: async () => undefined,
      isCancelled: () => false,
    });
    const first = await run();
    const second = await run();
    expect(first).toEqual(second);
    expect(["complete", "budget"]).toContain(first.reason);
    expect(first.completedDepth).toBeGreaterThan(0);
    expect(first.candidate).not.toBeNull();
    assertLegal(state, first.candidate!);
  });

  it("uses the seed only for controlled Easy-level choice among near-equal moves", async () => {
    const state = createInitialGame();
    const moves = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) {
      const result = await runLightweightSearchBatched(state, {
        tier: "lightweight-easy",
        seed: `variety-${seed}`,
        nodeBudget: 200,
        depthCeiling: 1,
        safetyDeadlineMs: 60_000,
        batchNodes: 200,
        now: () => 0,
        yieldTask: async () => undefined,
        isCancelled: () => false,
      });
      expect(result.candidate).not.toBeNull();
      assertLegal(state, result.candidate!);
      moves.add(JSON.stringify(result.candidate));
    }
    expect(moves.size).toBeGreaterThan(1);
  });

  it("preserves the frontier across bounded batches and observes cancellation after a real yield seam", async () => {
    let yields = 0;
    let cancelled = false;
    const result = await runLightweightSearchBatched(createInitialGame(), {
      tier: "lightweight-hard",
      seed: "cancel",
      nodeBudget: 50_000,
      depthCeiling: 8,
      safetyDeadlineMs: 60_000,
      batchNodes: 1,
      now: () => 0,
      yieldTask: async () => {
        yields += 1;
        if (yields === 3) cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(yields).toBe(3);
    expect(result.reason).toBe("cancelled");
    expect(result.candidate).toBeNull();
  });

  it("never publishes an incomplete depth and falls back deterministically if no depth completes", () => {
    const state = createInitialGame();
    const search = createLightweightSearch(state, {
      tier: "lightweight-normal",
      seed: "tiny",
      nodeBudget: 1,
      depthCeiling: 5,
      safetyDeadlineMs: 60_000,
      now: () => 0,
    });
    search.step(1);
    const progress = search.step(1);
    expect(progress.done).toBe(true);
    const result = search.result();
    expect(result.completedDepth).toBe(0);
    expect(result.candidate).toEqual(getDeterministicFallbackCandidate(state));
    expect(result.source).toBe("fallback");
  });

  it("unwinds a fully explored depth when its last leaf consumes the exact node budget", () => {
    const state = createInitialGame();
    // Depth one visits the root plus one leaf for every legal move. Derive that
    // exact number through the rules-authoritative fallback walk, not AI rules.
    let exactBudget = 1;
    for (const piece of state.board) {
      if (!piece || piece.side !== state.sideToMove) continue;
      exactBudget += getLegalMoves(state, piece.id).length;
    }
    expect(exactBudget).toBeGreaterThan(1);
    const search = createLightweightSearch(state, {
      tier: "lightweight-normal",
      seed: "exact-budget",
      nodeBudget: exactBudget,
      depthCeiling: 1,
      safetyDeadlineMs: 60_000,
      now: () => 0,
    });
    const progress = search.step(exactBudget);
    expect(progress).toMatchObject({ done: true, completedDepth: 1, nodes: exactBudget });
    expect(search.result()).toMatchObject({ source: "search", reason: "complete" });
  });

  it("uses a real task timer as the default cooperative-yield boundary", async () => {
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 0);
    const result = await runLightweightSearchBatched(createInitialGame(), {
      tier: "lightweight-hard",
      seed: "default-task-yield",
      nodeBudget: 50_000,
      depthCeiling: 8,
      safetyDeadlineMs: 60_000,
      batchNodes: 1,
      now: () => 0,
      isCancelled: () => cancelled,
    });
    expect(result.reason).toBe("cancelled");
    expect(result.nodes).toBe(1);
  });

  it("honors a safety deadline between resumable work units", async () => {
    let clock = 0;
    const result = await runLightweightSearchBatched(createInitialGame(), {
      tier: "lightweight-hard",
      seed: "deadline",
      nodeBudget: 50_000,
      depthCeiling: 8,
      safetyDeadlineMs: 2,
      batchNodes: 2,
      now: () => clock++,
      yieldTask: async () => undefined,
      isCancelled: () => false,
    });
    expect(result.reason).toBe("deadline");
    if (result.candidate) assertLegal(createInitialGame(), result.candidate);
  });

  it("scores material and check from the side-to-move perspective", () => {
    let state = createInitialGame();
    state = commit(state, [1, 2], [1, 9]);
    const capturedHorse = getPieceAt(state, { file: 1, rank: 9 });
    expect(capturedHorse?.side).toBe("red");
    expect(evaluatePosition(state)).toBeLessThan(0);

    const checked = makeState([
      piece("red:general:0", "red", "general", 4, 0),
      piece("black:general:0", "black", "general", 4, 9),
      piece("red:chariot:0", "red", "chariot", 4, 8),
      piece("red:soldier:screen", "red", "soldier", 4, 5),
    ], "black", { status: { kind: "playing", check: "black" } });
    const safe = makeState([
      piece("red:general:0", "red", "general", 4, 0),
      piece("black:general:0", "black", "general", 4, 9),
      piece("red:chariot:0", "red", "chariot", 3, 8),
      piece("red:soldier:screen", "red", "soldier", 4, 5),
    ], "black");
    expect(evaluatePosition(checked)).toBeLessThan(evaluatePosition(safe));
  });

  it("handles a terminal position without inventing a move", () => {
    const resigned = dispatch(createInitialGame(), { type: "resign", expectedRevision: 0 });
    expect(resigned.error).toBeUndefined();
    const search = createLightweightSearch(resigned.state, {
      tier: "lightweight-hard",
      seed: "terminal",
      nodeBudget: 50,
      depthCeiling: 3,
      safetyDeadlineMs: 60_000,
      now: () => 0,
    });
    expect(search.step(50).done).toBe(true);
    expect(search.result()).toMatchObject({ candidate: null, source: "none" });
    expect(evaluatePosition(resigned.state)).toBeLessThan(-900_000);
  });

  it("keeps candidates legal through representative randomized play", () => {
    let state = createInitialGame();
    let random = 0x12345678;
    for (let ply = 0; ply < 18 && state.status.kind === "playing"; ply += 1) {
      const candidate = getDeterministicFallbackCandidate(state);
      expect(candidate).not.toBeNull();
      assertLegal(state, candidate!);
      const legal = state.board.flatMap((pieceAtSquare) => {
        if (!pieceAtSquare || pieceAtSquare.side !== state.sideToMove) return [];
        return getLegalMoves(state, pieceAtSquare.id).map((to) => ({
          from: pieceAtSquare.square,
          to,
        }));
      });
      random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
      const selected = legal[random % legal.length];
      state = commit(
        state,
        [selected.from.file, selected.from.rank],
        [selected.to.file, selected.to.rank],
      );
    }
  });
});
