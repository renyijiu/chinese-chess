import { describe, expect, it } from "vitest";

import { createInitialGame } from "../../../lib/xiangqi/index";
import {
  createComputerMatch,
  createLocalMatch,
  createOnlineMatch,
  parseMatchConfig,
  rollFairDie,
  setEffectiveOpponentTier,
  type EntropySource,
} from "../../../components/xiangqi/game/match";

function byteStream(bytes: ReadonlyArray<number>): EntropySource {
  let offset = 0;
  return (target) => {
    for (let index = 0; index < target.length; index += 1) {
      const value = bytes[offset];
      if (value === undefined) throw new Error("Entropy stream exhausted");
      target[index] = value;
      offset += 1;
    }
  };
}

describe("computer match creation", () => {
  it("maps odd dice to red and even dice to black", () => {
    const odd = createComputerMatch("easy", {
      entropy: byteStream([4, ...Array(32).fill(1)]),
    });
    const even = createComputerMatch("hard", {
      entropy: byteStream([3, ...Array(32).fill(2)]),
    });

    expect(odd.config).toMatchObject({
      mode: "computer",
      dieResult: 5,
      humanSide: "red",
      requestedDifficulty: "easy",
      effectiveTier: "lightweight-easy",
    });
    expect(even.config).toMatchObject({
      mode: "computer",
      dieResult: 4,
      humanSide: "black",
      requestedDifficulty: "hard",
      effectiveTier: "lightweight-hard",
    });
  });

  it("uses rejection sampling instead of modulo bias", () => {
    expect(rollFairDie(byteStream([252, 0]))).toBe(1);

    const entropy = byteStream(Array.from({ length: 252 }, (_, index) => index));
    const counts = new Map<number, number>();
    for (let index = 0; index < 252; index += 1) {
      const result = rollFairDie(entropy);
      counts.set(result, (counts.get(result) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([42, 42, 42, 42, 42, 42]);
  });

  it("creates fresh cryptographic identities and a new die for each restart", () => {
    const entropy = byteStream([
      0,
      ...Array(16).fill(1),
      ...Array(16).fill(2),
      1,
      ...Array(16).fill(3),
      ...Array(16).fill(4),
    ]);

    const first = createComputerMatch("normal", { entropy });
    const restarted = createComputerMatch("normal", { entropy });

    expect(first.config.mode).toBe("computer");
    expect(restarted.config.mode).toBe("computer");
    if (first.config.mode !== "computer" || restarted.config.mode !== "computer") return;
    expect(restarted.config.dieResult).not.toBe(first.config.dieResult);
    expect(restarted.config.matchId).not.toBe(first.config.matchId);
    expect(restarted.config.seed).not.toBe(first.config.seed);
  });

  it("persists Master to Hard as the only cross-tier fallback", () => {
    const master = createComputerMatch("master", {
      entropy: byteStream([0, ...Array(32).fill(8)]),
    });
    const fallback = setEffectiveOpponentTier(master, "lightweight-hard");

    expect(fallback.config).toMatchObject({
      requestedDifficulty: "master",
      effectiveTier: "lightweight-hard",
    });
    expect(() => setEffectiveOpponentTier(master, "lightweight-normal")).toThrow(/tier/i);

    const hard = createComputerMatch("hard", {
      entropy: byteStream([0, ...Array(32).fill(9)]),
    });
    expect(() => setEffectiveOpponentTier(hard, "fairy-master")).toThrow(/tier/i);
  });

  it("creates an explicit local match", () => {
    const match = createLocalMatch(createInitialGame());
    expect(match).toMatchObject({
      config: { mode: "local" },
      revision: 0,
      game: { revision: 0 },
    });
  });
});

describe("match config validation", () => {
  const validComputer = {
    mode: "computer",
    matchId: "match-0123456789abcdef",
    seed: "0123456789abcdef",
    dieResult: 5,
    humanSide: "red",
    requestedDifficulty: "master",
    effectiveTier: "fairy-master",
  } as const;
  const validOnline = {
    mode: "online",
    protocolVersion: 1,
    pairingId: "pairing-1",
    matchId: "match-1",
    rematchIndex: 0,
    localPeerId: "peer-host",
    remotePeerId: "peer-guest",
    localSide: "red",
    signalingRole: "host",
  } as const;

  it("accepts complete local, computer, and online discriminants", () => {
    expect(parseMatchConfig({ mode: "local" })).toEqual({ mode: "local" });
    expect(parseMatchConfig(validComputer)).toEqual(validComputer);
    expect(parseMatchConfig(validOnline)).toEqual(validOnline);
  });

  it("rejects unknown, extra, and cross-field values", () => {
    expect(() => parseMatchConfig({ mode: "local", dieResult: 1 })).toThrow();
    expect(() => parseMatchConfig({ ...validComputer, extra: true })).toThrow();
    expect(() => parseMatchConfig({ ...validComputer, dieResult: 0 })).toThrow();
    expect(() => parseMatchConfig({ ...validComputer, dieResult: 4 })).toThrow();
    expect(() => parseMatchConfig({ ...validComputer, matchId: "" })).toThrow();
    expect(() => parseMatchConfig({ ...validComputer, seed: "" })).toThrow();
    expect(() => parseMatchConfig({
      ...validComputer,
      requestedDifficulty: "normal",
      effectiveTier: "lightweight-hard",
    })).toThrow();
  });

  it("strictly validates online identities, protocol, peers, and rematch index", () => {
    for (const invalid of [
      { ...validOnline, extra: true },
      { ...validOnline, protocolVersion: 2 },
      { ...validOnline, pairingId: "" },
      { ...validOnline, matchId: "x".repeat(129) },
      { ...validOnline, rematchIndex: -1 },
      { ...validOnline, rematchIndex: 0.5 },
      { ...validOnline, remotePeerId: validOnline.localPeerId },
      { ...validOnline, localSide: "black" },
      { ...validOnline, signalingRole: "caller" },
    ]) {
      expect(() => parseMatchConfig(invalid)).toThrow();
    }
  });

  it("alternates host and guest sides deterministically across rematches", () => {
    const firstHost = createOnlineMatch(validOnline);
    const firstGuest = createOnlineMatch({
      ...validOnline,
      localPeerId: validOnline.remotePeerId,
      remotePeerId: validOnline.localPeerId,
      localSide: "black",
      signalingRole: "guest",
    });
    const rematchHost = createOnlineMatch({
      ...validOnline,
      rematchIndex: 1,
      localSide: "black",
    });
    const rematchGuest = createOnlineMatch({
      ...validOnline,
      rematchIndex: 1,
      localPeerId: validOnline.remotePeerId,
      remotePeerId: validOnline.localPeerId,
      localSide: "red",
      signalingRole: "guest",
    });

    expect(firstHost.config).toEqual(validOnline);
    expect(firstGuest.config).toMatchObject({ signalingRole: "guest", localSide: "black" });
    expect(rematchHost.config).toMatchObject({ signalingRole: "host", localSide: "black" });
    expect(rematchGuest.config).toMatchObject({ signalingRole: "guest", localSide: "red" });
    expect(firstHost.game.revision).toBe(0);
  });
});
