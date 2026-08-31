import { describe, expect, it } from "vitest";

import {
  createInitialGame,
  dispatch,
  type GameCommand,
} from "../../../lib/xiangqi/index";
import {
  canIssueHumanCommand,
  deriveBoardCommandsLocked,
  opponentTurnRequestKey,
  shouldRequestOpponentTurn,
} from "../../../components/xiangqi/game/actions";
import {
  AuthoritativeCommandGate,
  type CommandCommit,
} from "../../../components/xiangqi/game/command-gate";
import {
  createComputerMatch,
  createLocalMatch,
  createOnlineMatch,
  type SavedMatch,
} from "../../../components/xiangqi/game/match";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const redSoldierMove = (expectedRevision = 0): GameCommand => ({
  type: "move",
  expectedRevision,
  from: { file: 0, rank: 3 },
  to: { file: 0, rank: 4 },
});

function fixedEntropy(values: number[]) {
  let index = 0;
  return (target: Uint8Array) => {
    target.fill(values[index] ?? values.at(-1) ?? 0);
    index += 1;
  };
}

function gateHarness(initial: SavedMatch, settle?: (commit: CommandCommit) => Promise<void>) {
  let current = initial;
  const commits: CommandCommit[] = [];
  const busy: boolean[] = [];
  const gate = new AuthoritativeCommandGate({
    getCurrentMatch: () => current,
    onBusyChange: (value) => busy.push(value),
    commit: async (commit) => {
      commits.push(commit);
      current = commit.after;
      await settle?.(commit);
    },
  });
  return {
    gate,
    commits,
    busy,
    get current() { return current; },
    replace(next: SavedMatch) { current = next; },
  };
}

describe("AuthoritativeCommandGate", () => {
  it("dispatches the current authoritative match and resolves only after commit work settles", async () => {
    const settled = deferred<void>();
    const harness = gateHarness(createLocalMatch(), () => settled.promise);

    const receiptPromise = harness.gate.execute(redSoldierMove());
    await Promise.resolve();
    expect(harness.commits).toHaveLength(1);
    expect(harness.current.game.revision).toBe(1);
    expect(harness.gate.busy).toBe(true);

    let receiptSettled = false;
    void receiptPromise.then(() => { receiptSettled = true; });
    await Promise.resolve();
    expect(receiptSettled).toBe(false);

    settled.resolve();
    await expect(receiptPromise).resolves.toMatchObject({
      status: "committed",
      beforeRevision: 0,
      afterRevision: 1,
    });
    expect(harness.busy).toEqual([true, false]);
  });

  it("rejects illegal and stale commands without exposing a commit or lock", async () => {
    const harness = gateHarness(createLocalMatch());

    await expect(harness.gate.execute({
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 1, rank: 4 },
    })).resolves.toMatchObject({ status: "rejected", error: { code: "illegal-move" } });
    await expect(harness.gate.execute(redSoldierMove(9)))
      .resolves.toMatchObject({ status: "rejected", error: { code: "stale-revision" } });
    expect(harness.commits).toHaveLength(0);
    expect(harness.busy).toEqual([]);
  });

  it("reads a replacement current state instead of a stale closure", async () => {
    const harness = gateHarness(createLocalMatch());
    const moved = dispatch(harness.current.game, redSoldierMove());
    if (moved.error) throw new Error("fixture move must be legal");
    harness.replace(createLocalMatch(moved.state));

    await expect(harness.gate.execute({
      type: "move",
      expectedRevision: 1,
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    })).resolves.toMatchObject({ status: "committed", beforeRevision: 1, afterRevision: 2 });
    expect(harness.current.game.revision).toBe(2);
  });

  it("supersedes an invalidated action and its old finally cannot unlock a replacement", async () => {
    const firstSettled = deferred<void>();
    const secondSettled = deferred<void>();
    let commitIndex = 0;
    const harness = gateHarness(createLocalMatch(), () => {
      commitIndex += 1;
      return commitIndex === 1 ? firstSettled.promise : secondSettled.promise;
    });

    const first = harness.gate.execute(redSoldierMove());
    await Promise.resolve();
    harness.gate.invalidate();
    const replacement = createLocalMatch();
    harness.replace(replacement);
    const second = harness.gate.execute(redSoldierMove());
    await Promise.resolve();
    expect(harness.gate.busy).toBe(true);

    firstSettled.resolve();
    await expect(first).resolves.toMatchObject({ status: "superseded" });
    expect(harness.gate.busy).toBe(true);

    secondSettled.resolve();
    await expect(second).resolves.toMatchObject({ status: "committed" });
    expect(harness.gate.busy).toBe(false);
    expect(harness.busy).toEqual([true, false, true, false]);
  });

  it("lets a pending opponent candidate wait for the preceding command settlement", async () => {
    const settled = deferred<void>();
    const harness = gateHarness(createLocalMatch(), () => settled.promise);
    const command = harness.gate.execute(redSoldierMove());
    await Promise.resolve();

    let idle = false;
    const wait = harness.gate.whenIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    settled.resolve();
    await command;
    await wait;
    expect(idle).toBe(true);
  });

  it("commits one capture through one event and presentation transaction", async () => {
    const harness = gateHarness(createLocalMatch());
    await harness.gate.execute(redSoldierMove());
    await harness.gate.execute({
      type: "move",
      expectedRevision: 1,
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    });
    await harness.gate.execute({
      type: "move",
      expectedRevision: 2,
      from: { file: 0, rank: 4 },
      to: { file: 0, rank: 5 },
    });

    expect(harness.commits).toHaveLength(3);
    const captureCommit = harness.commits[2];
    if (!captureCommit) throw new Error("Expected the third commit to capture a piece");
    expect(captureCommit.events.filter((event) => event.type === "PieceCaptured"))
      .toHaveLength(1);
  });
});

describe("computer controller policy", () => {
  it("requests an AI opening only when the die assigns the human black", () => {
    const humanBlack = createComputerMatch("easy", { entropy: fixedEntropy([1, 7, 9]) });
    const humanRed = createComputerMatch("easy", { entropy: fixedEntropy([0, 7, 9]) });
    expect(humanBlack.config.mode).toBe("computer");
    expect(humanBlack.config.mode === "computer" && humanBlack.config.humanSide).toBe("black");
    expect(shouldRequestOpponentTurn(humanBlack, "playing", "ready")).toBe(true);
    expect(shouldRequestOpponentTurn(humanRed, "playing", "ready")).toBe(false);
  });

  it("hands a committed human move to the opponent and suppresses terminal/hidden work", () => {
    const match = createComputerMatch("normal", { entropy: fixedEntropy([0, 7, 9]) });
    const moved = dispatch(match.game, redSoldierMove());
    if (moved.error) throw new Error("fixture move must be legal");
    const after = { ...match, game: moved.state, revision: moved.state.revision };
    expect(shouldRequestOpponentTurn(after, "playing", "ready")).toBe(true);
    expect(shouldRequestOpponentTurn(after, "menu", "ready")).toBe(false);
    expect(shouldRequestOpponentTurn(after, "playing", "hidden")).toBe(false);
    expect(shouldRequestOpponentTurn(after, "playing", "terminal")).toBe(false);
    const settledRequest = opponentTurnRequestKey(after, 4);
    expect(shouldRequestOpponentTurn(after, "playing", "ready", 4, settledRequest)).toBe(false);
    expect(shouldRequestOpponentTurn(after, "playing", "ready", 5, settledRequest)).toBe(true);
  });

  it("keeps local controls and enforces human-only computer commands", () => {
    const local = createLocalMatch(createInitialGame());
    expect(canIssueHumanCommand(local, redSoldierMove())).toBe(true);
    expect(canIssueHumanCommand(local, { type: "undo", expectedRevision: 0 })).toBe(true);

    const computer = createComputerMatch("hard", { entropy: fixedEntropy([0, 7, 9]) });
    expect(canIssueHumanCommand(computer, redSoldierMove())).toBe(true);
    expect(canIssueHumanCommand(computer, { type: "undo", expectedRevision: 0 })).toBe(false);
    const afterHuman = dispatch(computer.game, redSoldierMove());
    if (afterHuman.error) throw new Error("fixture move must be legal");
    const opponentTurn = { ...computer, game: afterHuman.state, revision: afterHuman.state.revision };
    expect(canIssueHumanCommand(opponentTurn, {
      type: "resign",
      expectedRevision: opponentTurn.revision,
    })).toBe(false);
    expect(canIssueHumanCommand(opponentTurn, {
      type: "move",
      expectedRevision: opponentTurn.revision,
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    })).toBe(false);
  });

  it("gates online commands to the local side and forbids undo", () => {
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

    expect(canIssueHumanCommand(online, redSoldierMove())).toBe(true);
    expect(canIssueHumanCommand(online, { type: "undo", expectedRevision: 0 })).toBe(false);
    const afterLocal = dispatch(online.game, redSoldierMove());
    if (afterLocal.error) throw new Error("fixture move must be legal");
    const afterOnlineLocal = {
      ...online,
      game: afterLocal.state,
      revision: afterLocal.state.revision,
    };
    expect(canIssueHumanCommand(afterOnlineLocal, {
      type: "resign",
      expectedRevision: afterLocal.state.revision,
      side: "red",
    })).toBe(true);
    expect(canIssueHumanCommand(afterOnlineLocal, {
      type: "resign",
      expectedRevision: afterLocal.state.revision,
      side: "black",
    })).toBe(false);
  });

  it("derives board-only locking without treating a ready human turn as locked", () => {
    expect(deriveBoardCommandsLocked({
      phase: "playing",
      commandBusy: false,
      computerOwnsTurn: false,
      confirmationOpen: false,
      terminal: false,
    })).toBe(false);
    expect(deriveBoardCommandsLocked({
      phase: "playing",
      commandBusy: false,
      computerOwnsTurn: true,
      confirmationOpen: false,
      terminal: false,
    })).toBe(true);
    expect(deriveBoardCommandsLocked({
      phase: "menu",
      commandBusy: false,
      computerOwnsTurn: false,
      confirmationOpen: false,
      terminal: false,
    })).toBe(true);
  });
});
