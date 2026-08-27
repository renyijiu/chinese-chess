import { createInitialGame, type GameState, type Side } from "../../../lib/xiangqi/index";

export const ONLINE_MATCH_PROTOCOL_VERSION = 1 as const;

export type MatchMode = "local" | "computer" | "online";
export type ComputerDifficulty = "easy" | "normal" | "hard" | "master";
export type DieResult = 1 | 2 | 3 | 4 | 5 | 6;
export type OpponentTier =
  | "lightweight-easy"
  | "lightweight-normal"
  | "lightweight-hard"
  | "fairy-master";

export type LocalMatchConfig = Readonly<{
  mode: "local";
}>;

export type ComputerMatchConfig = Readonly<{
  mode: "computer";
  matchId: string;
  seed: string;
  dieResult: DieResult;
  humanSide: Side;
  requestedDifficulty: ComputerDifficulty;
  effectiveTier: OpponentTier;
}>;

export type OnlineMatchConfig = Readonly<{
  mode: "online";
  protocolVersion: typeof ONLINE_MATCH_PROTOCOL_VERSION;
  pairingId: string;
  matchId: string;
  rematchIndex: number;
  localPeerId: string;
  remotePeerId: string;
  localSide: Side;
  signalingRole: "host" | "guest";
}>;

export type MatchConfig = LocalMatchConfig | ComputerMatchConfig | OnlineMatchConfig;

export type SavedMatch = Readonly<{
  config: MatchConfig;
  game: GameState;
  revision: number;
}>;

export type EntropySource = (target: Uint8Array) => void;

export class MatchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchConfigError";
  }
}

const DIFFICULTIES = new Set<ComputerDifficulty>(["easy", "normal", "hard", "master"]);
const TIERS = new Set<OpponentTier>([
  "lightweight-easy",
  "lightweight-normal",
  "lightweight-hard",
  "fairy-master",
]);
const COMPUTER_KEYS = [
  "dieResult",
  "effectiveTier",
  "humanSide",
  "matchId",
  "mode",
  "requestedDifficulty",
  "seed",
] as const;
const ONLINE_KEYS = [
  "localPeerId",
  "localSide",
  "matchId",
  "mode",
  "pairingId",
  "protocolVersion",
  "rematchIndex",
  "remotePeerId",
  "signalingRole",
] as const;

function systemEntropy(target: Uint8Array): void {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new MatchConfigError("Secure random values are unavailable in this browser.");
  }
  cryptoApi.getRandomValues(target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isDifficulty(value: unknown): value is ComputerDifficulty {
  return typeof value === "string" && DIFFICULTIES.has(value as ComputerDifficulty);
}

function isOpponentTier(value: unknown): value is OpponentTier {
  return typeof value === "string" && TIERS.has(value as OpponentTier);
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 128;
}

function onlineSide(
  rematchIndex: number,
  signalingRole: OnlineMatchConfig["signalingRole"],
): Side {
  const hostSide = rematchIndex % 2 === 0 ? "red" : "black";
  if (signalingRole === "host") return hostSide;
  return hostSide === "red" ? "black" : "red";
}

function defaultTier(difficulty: ComputerDifficulty): OpponentTier {
  switch (difficulty) {
    case "easy": return "lightweight-easy";
    case "normal": return "lightweight-normal";
    case "hard": return "lightweight-hard";
    case "master": return "fairy-master";
  }
}

export function isValidTierTransition(
  requestedDifficulty: ComputerDifficulty,
  effectiveTier: OpponentTier,
): boolean {
  return effectiveTier === defaultTier(requestedDifficulty)
    || (requestedDifficulty === "master" && effectiveTier === "lightweight-hard");
}

export function humanSideForDie(dieResult: number): Side {
  if (!Number.isInteger(dieResult) || dieResult < 1 || dieResult > 6) {
    throw new MatchConfigError("Die result must be an integer from 1 through 6.");
  }
  return dieResult % 2 === 1 ? "red" : "black";
}

export function rollFairDie(entropy: EntropySource = systemEntropy): DieResult {
  const sample = new Uint8Array(1);
  for (;;) {
    entropy(sample);
    // 252 is the largest multiple of six that fits in one byte's 256 outcomes.
    if (sample[0] < 252) return ((sample[0] % 6) + 1) as DieResult;
  }
}

function randomHex(entropy: EntropySource, byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  entropy(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseMatchConfig(value: unknown): MatchConfig {
  if (!isRecord(value) || typeof value.mode !== "string") {
    throw new MatchConfigError("Match config must be a discriminated object.");
  }
  if (value.mode === "local") {
    if (!hasExactKeys(value, ["mode"])) {
      throw new MatchConfigError("Local matches cannot contain computer-only fields.");
    }
    return { mode: "local" };
  }
  if (value.mode === "online") {
    if (!hasExactKeys(value, ONLINE_KEYS)) {
      throw new MatchConfigError("Online match config is incomplete or contains unknown fields.");
    }
    if (
      value.protocolVersion !== ONLINE_MATCH_PROTOCOL_VERSION
      || !isBoundedId(value.pairingId)
      || !isBoundedId(value.matchId)
      || typeof value.rematchIndex !== "number"
      || !Number.isSafeInteger(value.rematchIndex)
      || value.rematchIndex < 0
      || !isBoundedId(value.localPeerId)
      || !isBoundedId(value.remotePeerId)
      || value.localPeerId === value.remotePeerId
      || (value.localSide !== "red" && value.localSide !== "black")
      || (value.signalingRole !== "host" && value.signalingRole !== "guest")
    ) {
      throw new MatchConfigError("Online match config contains an invalid field.");
    }
    if (value.localSide !== onlineSide(value.rematchIndex, value.signalingRole)) {
      throw new MatchConfigError("Online side does not match the signaling role and rematch index.");
    }
    return {
      mode: "online",
      protocolVersion: ONLINE_MATCH_PROTOCOL_VERSION,
      pairingId: value.pairingId,
      matchId: value.matchId,
      rematchIndex: value.rematchIndex,
      localPeerId: value.localPeerId,
      remotePeerId: value.remotePeerId,
      localSide: value.localSide,
      signalingRole: value.signalingRole,
    };
  }
  if (value.mode !== "computer" || !hasExactKeys(value, COMPUTER_KEYS)) {
    throw new MatchConfigError("Computer match config is incomplete or contains unknown fields.");
  }
  if (
    typeof value.matchId !== "string"
    || value.matchId.trim().length === 0
    || typeof value.seed !== "string"
    || value.seed.trim().length === 0
    || !isDifficulty(value.requestedDifficulty)
    || !isOpponentTier(value.effectiveTier)
    || (value.humanSide !== "red" && value.humanSide !== "black")
    || typeof value.dieResult !== "number"
  ) {
    throw new MatchConfigError("Computer match config contains an invalid field.");
  }
  const derivedSide = humanSideForDie(value.dieResult);
  if (value.humanSide !== derivedSide) {
    throw new MatchConfigError("Human side does not match the persisted die result.");
  }
  if (!isValidTierTransition(value.requestedDifficulty, value.effectiveTier)) {
    throw new MatchConfigError("Requested difficulty and effective tier are incompatible.");
  }
  return {
    mode: "computer",
    matchId: value.matchId,
    seed: value.seed,
    dieResult: value.dieResult as DieResult,
    humanSide: value.humanSide,
    requestedDifficulty: value.requestedDifficulty,
    effectiveTier: value.effectiveTier,
  };
}

export function createLocalMatch(game: GameState = createInitialGame()): SavedMatch {
  return { config: { mode: "local" }, game, revision: game.revision };
}

export function createComputerMatch(
  requestedDifficulty: ComputerDifficulty,
  options: Readonly<{ game?: GameState; entropy?: EntropySource }> = {},
): SavedMatch {
  const entropy = options.entropy ?? systemEntropy;
  const game = options.game ?? createInitialGame();
  const dieResult = rollFairDie(entropy);
  const config: ComputerMatchConfig = {
    mode: "computer",
    matchId: `match-${randomHex(entropy)}`,
    seed: randomHex(entropy),
    dieResult,
    humanSide: humanSideForDie(dieResult),
    requestedDifficulty,
    effectiveTier: defaultTier(requestedDifficulty),
  };
  return { config, game, revision: game.revision };
}

export function createOnlineMatch(
  config: OnlineMatchConfig,
  game: GameState = createInitialGame(),
): SavedMatch {
  const parsed = parseMatchConfig(config);
  if (parsed.mode !== "online") {
    throw new MatchConfigError("Expected an online match config.");
  }
  return { config: parsed, game, revision: game.revision };
}

export function setEffectiveOpponentTier(
  savedMatch: SavedMatch,
  effectiveTier: OpponentTier,
): SavedMatch {
  if (savedMatch.config.mode !== "computer") {
    throw new MatchConfigError("A local match has no opponent tier.");
  }
  if (!isValidTierTransition(savedMatch.config.requestedDifficulty, effectiveTier)) {
    throw new MatchConfigError("Requested difficulty and effective tier are incompatible.");
  }
  return {
    ...savedMatch,
    config: { ...savedMatch.config, effectiveTier },
  };
}
