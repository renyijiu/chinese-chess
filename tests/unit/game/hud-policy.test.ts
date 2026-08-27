import { describe, expect, it } from "vitest";

import { dispatch } from "../../../lib/xiangqi/index";
import type { OpponentCoordinatorSnapshot } from "../../../components/xiangqi/ai/OpponentCoordinator";
import {
  deriveGameHudPermissions,
  describeOpponentStatus,
} from "../../../components/xiangqi/hud/GameHud";
import {
  createComputerMatch,
  createLocalMatch,
  createOnlineMatch,
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

  it("offers online resignation on either turn only while the peer protocol is healthy", () => {
    const online = createOnlineMatch({
      mode: "online",
      protocolVersion: 1,
      pairingId: "pairing-1",
      matchId: "match-1",
      rematchIndex: 0,
      localPeerId: "peer-host",
      remotePeerId: "peer-guest",
      localSide: "red",
      signalingRole: "host",
    });
    const healthy = {
      peerOpen: true,
      coordinatorPhase: "playable" as const,
      conflict: false,
    };
    expect(deriveGameHudPermissions(online, false, healthy)).toEqual({
      showUndo: false,
      canUndo: false,
      canResign: true,
    });

    const afterLocal = dispatch(online.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });
    if (afterLocal.error) throw new Error("fixture move must be legal");
    const opponentTurn = {
      ...online,
      game: afterLocal.state,
      revision: afterLocal.state.revision,
    };
    expect(deriveGameHudPermissions(opponentTurn, false, healthy).canResign).toBe(true);
    expect(deriveGameHudPermissions(opponentTurn, false, {
      ...healthy,
      peerOpen: false,
    }).canResign).toBe(false);
    expect(deriveGameHudPermissions(opponentTurn, false, {
      ...healthy,
      coordinatorPhase: "stalled",
    }).canResign).toBe(false);
    expect(deriveGameHudPermissions(opponentTurn, false, {
      ...healthy,
      coordinatorPhase: "awaiting-ack",
    }).canResign).toBe(true);
  });
});
