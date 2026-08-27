import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
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
      await expect(validateOpponentRequestPosition(candidate, async (value) => sha256(value)))
        .resolves.toMatchObject({ ok: false });
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
    expect(decodeOpponentResultV1({ ...validResult, candidate: { from: { file: 9, rank: 0 }, to: { file: 0, rank: 0 } } })).toBeNull();
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
