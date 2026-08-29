import { describe, expect, it } from "vitest";

import { dispatch, type MoveRecord } from "../../../lib/xiangqi/index";
import type { OpponentCoordinatorSnapshot } from "../../../components/xiangqi/ai/OpponentCoordinator";
import {
  deriveGameHudPermissions,
  deriveCapturedPieceLedger,
  deriveVisibleMoveHistory,
  describeOpponentStatus,
  formatCaptureDetail,
} from "../../../components/xiangqi/hud/GameHud";
import {
  createComputerMatch,
  createLocalMatch,
  setEffectiveOpponentTier,
} from "../../../components/xiangqi/game/match";

function fixedEntropy(first: number) {
  let call = 0;
  return (target: Uint8Array) => {
    target.fill(call++ === 0 ? first : 9);
  };
}

function moveRedSoldier(match: ReturnType<typeof createLocalMatch>) {
  const result = dispatch(match.game, {
    type: "move",
    expectedRevision: match.revision,
    from: { file: 0, rank: 3 },
    to: { file: 0, rank: 4 },
  });
  if (result.error) throw new Error("fixture move must be legal");
  return { ...match, game: result.state, revision: result.state.revision };
}

function snapshot(phase: OpponentCoordinatorSnapshot["phase"]): OpponentCoordinatorSnapshot {
  return {
    phase,
    matchId: "match-test",
    generation: 1,
    requestedTier: "lightweight-hard",
    effectiveTier: "lightweight-hard",
    visible: true,
    turn: null,
    failure: phase === "failed"
      ? { code: "failed", message: "worker stopped", recoverable: true }
      : null,
  };
}

function captureMove(
  revision: number,
  side: MoveRecord["side"],
  role: MoveRecord["role"],
  captured: NonNullable<MoveRecord["captured"]>,
): MoveRecord {
  return {
    revision,
    side,
    role,
    pieceId: `${side}:${role}:fixture`,
    from: { file: 1, rank: side === "red" ? 2 : 7 },
    to: captured.square,
    captured,
    notation: `${side === "red" ? "红" : "黑"}·炮 b7 → b0`,
    beforeNoCapturePlies: 0,
    beforeRepetitionCounts: {},
    beforeStatus: { kind: "playing", check: null },
  };
}

describe("game HUD policy", () => {
  it("keeps local undo visible while hiding it entirely in computer matches", () => {
    const local = createLocalMatch();
    expect(deriveGameHudPermissions(local, false)).toEqual({
      showUndo: true,
      canUndo: false,
      canResign: true,
    });
    expect(deriveGameHudPermissions(moveRedSoldier(local), false).canUndo).toBe(true);

    const computer = createComputerMatch("normal", { entropy: fixedEntropy(0) });
    expect(deriveGameHudPermissions(computer, false)).toEqual({
      showUndo: false,
      canUndo: false,
      canResign: true,
    });
    const afterHuman = dispatch(computer.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });
    if (afterHuman.error) throw new Error("fixture move must be legal");
    expect(deriveGameHudPermissions({
      ...computer,
      game: afterHuman.state,
      revision: afterHuman.state.revision,
    }, false).canResign).toBe(false);
  });

  it("announces active thinking and a persisted Master fallback accurately", () => {
    const hard = createComputerMatch("hard", { entropy: fixedEntropy(0) });
    if (hard.config.mode !== "computer") throw new Error("expected computer match");
    expect(describeOpponentStatus({
      config: hard.config,
      computerOwnsTurn: true,
      snapshot: snapshot("searching"),
    })).toBe("电脑正在思考");

    const requestedMaster = createComputerMatch("master", { entropy: fixedEntropy(0) });
    const fallback = setEffectiveOpponentTier(requestedMaster, "lightweight-hard");
    if (fallback.config.mode !== "computer") throw new Error("expected computer match");
    expect(describeOpponentStatus({
      config: fallback.config,
      computerOwnsTurn: false,
      snapshot: snapshot("ready"),
    })).toContain("已保存并回退至困难");
  });

  it("names the captured piece and groups losses by faction", () => {
    const redHorse = {
      id: "red:horse:0",
      side: "red" as const,
      role: "horse" as const,
      square: { file: 1, rank: 0 },
    };
    const blackCannons = [0, 1].map((ordinal) => ({
      id: `black:cannon:${ordinal}`,
      side: "black" as const,
      role: "cannon" as const,
      square: { file: ordinal ? 7 : 1, rank: 7 },
    }));
    const history = [
      captureMove(1, "black", "cannon", redHorse),
      captureMove(2, "red", "chariot", blackCannons[0]),
      captureMove(3, "red", "chariot", blackCannons[1]),
    ];

    expect(formatCaptureDetail(redHorse)).toBe("吃红傌");
    expect(deriveCapturedPieceLedger(history)).toEqual({
      red: [{ count: 1, glyph: "傌", role: "horse" }],
      black: [{ count: 2, glyph: "砲", role: "cannon" }],
    });
  });

  it("shows all moves only when the history panel is expanded", () => {
    const captured = {
      id: "black:soldier:fixture",
      side: "black" as const,
      role: "soldier" as const,
      square: { file: 0, rank: 6 },
    };
    const history = Array.from({ length: 9 }, (_, index) =>
      captureMove(index + 1, index % 2 === 0 ? "red" : "black", "chariot", captured));

    expect(deriveVisibleMoveHistory(history, false).map((move) => move.revision)).toEqual([
      9, 8, 7, 6, 5, 4, 3, 2,
    ]);
    expect(deriveVisibleMoveHistory(history, true).map((move) => move.revision)).toEqual([
      9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });
});
