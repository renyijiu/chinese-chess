import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as engine from "../../../lib/xiangqi/engine";
import { GameReplayValidator } from "../../../lib/xiangqi/persistence";
import { createInitialGame, dispatch, serializeGame } from "../../../lib/xiangqi/index";
import {
  createOpponentErrorV1,
  decodeOpponentRequestV1,
  decodeOpponentResultV1,
  decodeOpponentStopV1,
  decodeOpponentOutputV1,
  validateOpponentRequestPosition,
  type OpponentRequestV1,
} from "../../../lib/xiangqi/ai/index";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function request(overrides: Partial<OpponentRequestV1> = {}): OpponentRequestV1 {
  const serializedGame = serializeGame(createInitialGame());
  return {
    protocolVersion: 1,
    type: "search",
    matchId: "match-1",
    generation: 2,
    requestId: "request-3",
    positionRevision: 0,
    serializedGame,
    positionFingerprint: sha256(serializedGame),
    sideToMove: "red",
    tier: "lightweight-normal",
    seed: "fixed-seed",
    nodeBudget: 10_000,
    depthCeiling: 4,
    safetyDeadlineMs: 5_000,
    ...overrides,
  };
}

describe("opponent protocol v1", () => {
  it("strictly decodes a complete search request from unknown", () => {
    expect(decodeOpponentRequestV1(request())).toEqual(request());
    expect(decodeOpponentRequestV1({ ...request(), surprise: true })).toBeNull();
    expect(decodeOpponentRequestV1({ ...request(), nodeBudget: Number.NaN })).toBeNull();
    expect(decodeOpponentRequestV1({ ...request(), generation: -1 })).toBeNull();
    expect(decodeOpponentRequestV1({ ...request(), positionFingerprint: "abc" })).toBeNull();
    expect(decodeOpponentRequestV1({ ...request(), sideToMove: "green" })).toBeNull();
  });

  it("reconstructs the canonical game and verifies fingerprint, revision, and side", async () => {
    const valid = await validateOpponentRequestPosition(request(), async (value) => sha256(value));
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.game.revision).toBe(0);

    const moved = dispatch(createInitialGame(), {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });
    expect(moved.error).toBeUndefined();
    const nonCanonical = JSON.stringify(JSON.parse(serializeGame(moved.state)), null, 2);
    const invalidCases = [
      request({ positionFingerprint: "0".repeat(64) }),
      request({ positionRevision: 1 }),
      request({ sideToMove: "black" }),
      request({ serializedGame: nonCanonical, positionFingerprint: sha256(nonCanonical) }),
      request({ serializedGame: "not-json", positionFingerprint: sha256("not-json") }),
    ];
    for (const candidate of invalidCases) {
      await expect(
        validateOpponentRequestPosition(candidate, async (value) => sha256(value)),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it("strictly decodes result and stop identities", () => {
    const validResult = {
      protocolVersion: 1,
      type: "result",
      matchId: "match-1",
      generation: 2,
      requestId: "request-3",
      positionRevision: 0,
      positionFingerprint: request().positionFingerprint,
      sideToMove: "red",
      candidate: { from: { file: 0, rank: 3 }, to: { file: 0, rank: 4 } },
      completedDepth: 3,
      nodes: 1234,
      score: 18,
    };
    expect(decodeOpponentResultV1(validResult)).toEqual(validResult);
    expect(decodeOpponentResultV1({ ...validResult, score: Number.POSITIVE_INFINITY })).toBeNull();
    expect(
      decodeOpponentResultV1({
        ...validResult,
        candidate: { from: { file: 9, rank: 0 }, to: { file: 0, rank: 0 } },
      }),
    ).toBeNull();
    expect(decodeOpponentResultV1({ ...validResult, extra: 1 })).toBeNull();

    const stop = {
      protocolVersion: 1,
      type: "stop",
      matchId: "match-1",
      generation: 2,
      requestId: "request-3",
    };
    expect(decodeOpponentStopV1(stop)).toEqual(stop);
    expect(decodeOpponentStopV1({ ...stop, generation: 2.5 })).toBeNull();
  });

  it("replays only new commands while still rejecting tampered, divergent, and invalid inputs", async () => {
    const validator = new GameReplayValidator();
    const initial = createInitialGame();
    const moved = dispatch(initial, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state;
    const undone = dispatch(moved, { type: "undo", expectedRevision: 1 }).state;
    const makeRequest = (game: typeof initial) => {
      const serializedGame = serializeGame(game);
      return request({
        serializedGame,
        positionFingerprint: sha256(serializedGame),
        positionRevision: game.revision,
        sideToMove: game.sideToMove,
      });
    };
    const validate = (candidate: OpponentRequestV1) =>
      validateOpponentRequestPosition(candidate, sha256, validator);
    const replay = vi.spyOn(engine, "dispatch");
    try {
      await expect(validate(makeRequest(moved))).resolves.toMatchObject({ ok: true, game: moved });
      replay.mockClear();
      await expect(validate(makeRequest(undone))).resolves.toMatchObject({
        ok: true,
        game: undone,
      });
      expect(replay).toHaveBeenCalledTimes(1);
      replay.mockClear();
      await expect(validate(makeRequest(undone))).resolves.toMatchObject({ ok: true });
      expect(replay).not.toHaveBeenCalled();

      const alternate = dispatch(initial, {
        type: "move",
        expectedRevision: 0,
        from: { file: 2, rank: 3 },
        to: { file: 2, rank: 4 },
      }).state;
      await expect(validate(makeRequest(alternate))).resolves.toMatchObject({
        ok: true,
        game: alternate,
      });
      const invalid = serializeGame({
        ...alternate,
        commandLog: [...alternate.commandLog, alternate.commandLog[0]!],
      });
      await expect(
        validate(request({ serializedGame: invalid, positionFingerprint: sha256(invalid) })),
      ).resolves.toMatchObject({ ok: false, code: "invalid-serialization" });
      await expect(
        validate({ ...makeRequest(alternate), positionFingerprint: "0".repeat(64) }),
      ).resolves.toMatchObject({ ok: false, code: "fingerprint-mismatch" });
      await expect(
        validate({ ...makeRequest(alternate), sideToMove: "red" }),
      ).resolves.toMatchObject({ ok: false, code: "identity-mismatch" });
      const nonCanonical = JSON.stringify(JSON.parse(serializeGame(alternate)), null, 2);
      await expect(
        validate({
          ...makeRequest(alternate),
          serializedGame: nonCanonical,
          positionFingerprint: sha256(nonCanonical),
        }),
      ).resolves.toMatchObject({ ok: false, code: "non-canonical" });
      await expect(validate(makeRequest(alternate))).resolves.toMatchObject({
        ok: true,
        game: alternate,
      });
    } finally {
      replay.mockRestore();
    }
  });

  it("strictly decodes stopped and error output variants from unknown", () => {
    const stopped = {
      protocolVersion: 1,
      type: "stopped",
      matchId: "match-1",
      generation: 2,
      requestId: "request-3",
    };
    expect(decodeOpponentOutputV1(stopped)).toEqual(stopped);
    expect(decodeOpponentOutputV1({ ...stopped, unknown: true })).toBeNull();

    const failure = {
      protocolVersion: 1,
      type: "error",
      matchId: "match-1",
      generation: 2,
      requestId: "request-3",
      code: "search-failed",
      message: "Search failed safely.",
    };
    expect(decodeOpponentOutputV1(failure)).toEqual(failure);
    expect(decodeOpponentOutputV1({ ...failure, message: "" })).toBeNull();
    expect(decodeOpponentOutputV1({ ...failure, generation: Number.NaN })).toBeNull();
    expect(decodeOpponentOutputV1({ ...failure, code: "other" })).toBeNull();
    expect(decodeOpponentOutputV1({ ...failure, extra: 1 })).toBeNull();
  });

  it("builds errors from identity fields without leaking search payload fields", () => {
    const failure = createOpponentErrorV1(request(), "search-failed", "Search failed safely.");

    expect(failure).toEqual({
      protocolVersion: 1,
      type: "error",
      matchId: "match-1",
      generation: 2,
      requestId: "request-3",
      code: "search-failed",
      message: "Search failed safely.",
    });
    expect(decodeOpponentOutputV1(failure)).toEqual(failure);
  });
});
