import { deserializeGame, serializeGame } from "../persistence";
import { isSquare } from "../engine";
import type { Side, Square } from "../types";
import {
  OPPONENT_PROTOCOL_VERSION,
  type CandidateMove,
  type LightweightTier,
  type OpponentErrorCode,
  type OpponentErrorV1,
  type OpponentIdentityV1,
  type OpponentOutputV1,
  type OpponentRequestV1,
  type OpponentResultV1,
  type OpponentStopV1,
  type OpponentStoppedV1,
  type OpponentTier,
  type ValidatedOpponentPosition,
} from "./types";

const REQUEST_KEYS = [
  "depthCeiling",
  "generation",
  "matchId",
  "nodeBudget",
  "positionFingerprint",
  "positionRevision",
  "protocolVersion",
  "requestId",
  "safetyDeadlineMs",
  "seed",
  "serializedGame",
  "sideToMove",
  "tier",
  "type",
] as const;

const RESULT_KEYS = [
  "candidate",
  "completedDepth",
  "generation",
  "matchId",
  "nodes",
  "positionFingerprint",
  "positionRevision",
  "protocolVersion",
  "requestId",
  "score",
  "sideToMove",
  "type",
] as const;

const STOP_KEYS = ["generation", "matchId", "protocolVersion", "requestId", "type"] as const;
const ERROR_KEYS = [
  "code",
  "generation",
  "matchId",
  "message",
  "protocolVersion",
  "requestId",
  "type",
] as const;

const LIGHTWEIGHT_TIERS = new Set<LightweightTier>([
  "lightweight-easy",
  "lightweight-normal",
  "lightweight-hard",
]);
const ALL_TIERS = new Set<OpponentTier>([...LIGHTWEIGHT_TIERS, "fairy-master"]);
const ERROR_CODES = new Set<OpponentErrorCode>([
  "invalid-position",
  "unsupported-tier",
  "no-legal-move",
  "search-failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isSide(value: unknown): value is Side {
  return value === "red" || value === "black";
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isTier(value: unknown): value is OpponentTier {
  return typeof value === "string" && ALL_TIERS.has(value as OpponentTier);
}

export function isLightweightTier(value: unknown): value is LightweightTier {
  return typeof value === "string" && LIGHTWEIGHT_TIERS.has(value as LightweightTier);
}

function decodeSquare(value: unknown): Square | null {
  if (!isRecord(value) || !hasExactKeys(value, ["file", "rank"])) return null;
  if (typeof value.file !== "number" || typeof value.rank !== "number") return null;
  const square = { file: value.file, rank: value.rank };
  return isSquare(square) ? square : null;
}

function decodeCandidate(value: unknown): CandidateMove | null {
  if (!isRecord(value) || !hasExactKeys(value, ["from", "to"])) return null;
  const from = decodeSquare(value.from);
  const to = decodeSquare(value.to);
  return from && to ? { from, to } : null;
}

function hasValidIdentity(value: Record<string, unknown>): boolean {
  return isNonemptyString(value.matchId)
    && isIntegerAtLeast(value.generation, 0)
    && isNonemptyString(value.requestId);
}

export function decodeOpponentRequestV1(value: unknown): OpponentRequestV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) return null;
  if (
    value.protocolVersion !== OPPONENT_PROTOCOL_VERSION
    || value.type !== "search"
    || !hasValidIdentity(value)
    || !isIntegerAtLeast(value.positionRevision, 0)
    || !isNonemptyString(value.serializedGame)
    || !isFingerprint(value.positionFingerprint)
    || !isSide(value.sideToMove)
    || !isTier(value.tier)
    || !isNonemptyString(value.seed)
    || !isIntegerAtLeast(value.nodeBudget, 1)
    || !isIntegerAtLeast(value.depthCeiling, 1)
    || !isFinitePositive(value.safetyDeadlineMs)
  ) return null;
  return {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "search",
    matchId: value.matchId as string,
    generation: value.generation as number,
    requestId: value.requestId as string,
    positionRevision: value.positionRevision,
    serializedGame: value.serializedGame,
    positionFingerprint: value.positionFingerprint,
    sideToMove: value.sideToMove,
    tier: value.tier,
    seed: value.seed,
    nodeBudget: value.nodeBudget,
    depthCeiling: value.depthCeiling,
    safetyDeadlineMs: value.safetyDeadlineMs,
  };
}

export function decodeOpponentResultV1(value: unknown): OpponentResultV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  const candidate = decodeCandidate(value.candidate);
  if (
    value.protocolVersion !== OPPONENT_PROTOCOL_VERSION
    || value.type !== "result"
    || !hasValidIdentity(value)
    || !isIntegerAtLeast(value.positionRevision, 0)
    || !isFingerprint(value.positionFingerprint)
    || !isSide(value.sideToMove)
    || !candidate
    || !isIntegerAtLeast(value.completedDepth, 0)
    || !isIntegerAtLeast(value.nodes, 0)
    || typeof value.score !== "number"
    || !Number.isFinite(value.score)
  ) return null;
  return {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "result",
    matchId: value.matchId as string,
    generation: value.generation as number,
    requestId: value.requestId as string,
    positionRevision: value.positionRevision,
    positionFingerprint: value.positionFingerprint,
    sideToMove: value.sideToMove,
    candidate,
    completedDepth: value.completedDepth,
    nodes: value.nodes,
    score: value.score,
  };
}

export function decodeOpponentStopV1(value: unknown): OpponentStopV1 | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, STOP_KEYS)
    || value.protocolVersion !== OPPONENT_PROTOCOL_VERSION
    || value.type !== "stop"
    || !hasValidIdentity(value)
  ) return null;
  return {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "stop",
    matchId: value.matchId as string,
    generation: value.generation as number,
    requestId: value.requestId as string,
  };
}

export function decodeOpponentStoppedV1(value: unknown): OpponentStoppedV1 | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, STOP_KEYS)
    || value.protocolVersion !== OPPONENT_PROTOCOL_VERSION
    || value.type !== "stopped"
    || !hasValidIdentity(value)
  ) return null;
  return {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "stopped",
    matchId: value.matchId as string,
    generation: value.generation as number,
    requestId: value.requestId as string,
  };
}

export function decodeOpponentErrorV1(value: unknown): OpponentErrorV1 | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ERROR_KEYS)
    || value.protocolVersion !== OPPONENT_PROTOCOL_VERSION
    || value.type !== "error"
    || !hasValidIdentity(value)
    || typeof value.code !== "string"
    || !ERROR_CODES.has(value.code as OpponentErrorCode)
    || !isNonemptyString(value.message)
  ) return null;
  return {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "error",
    matchId: value.matchId as string,
    generation: value.generation as number,
    requestId: value.requestId as string,
    code: value.code as OpponentErrorCode,
    message: value.message,
  };
}

export function createOpponentErrorV1(
  identity: OpponentIdentityV1,
  code: OpponentErrorCode,
  message: string,
): OpponentErrorV1 {
  return {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "error",
    matchId: identity.matchId,
    generation: identity.generation,
    requestId: identity.requestId,
    code,
    message,
  };
}

export function decodeOpponentOutputV1(value: unknown): OpponentOutputV1 | null {
  return decodeOpponentResultV1(value)
    ?? decodeOpponentStoppedV1(value)
    ?? decodeOpponentErrorV1(value);
}

export type PositionDigest = (canonicalSerializedGame: string) => string | Promise<string>;

export type PositionValidationResult =
  | Readonly<{ ok: true } & ValidatedOpponentPosition>
  | Readonly<{
      ok: false;
      code: "fingerprint-mismatch" | "invalid-serialization" | "non-canonical" | "identity-mismatch";
    }>;

export async function validateOpponentRequestPosition(
  request: OpponentRequestV1,
  digest: PositionDigest,
): Promise<PositionValidationResult> {
  const actualFingerprint = await digest(request.serializedGame);
  if (actualFingerprint !== request.positionFingerprint) {
    return { ok: false, code: "fingerprint-mismatch" };
  }
  let game;
  try {
    game = deserializeGame(request.serializedGame);
  } catch {
    return { ok: false, code: "invalid-serialization" };
  }
  if (serializeGame(game) !== request.serializedGame) {
    return { ok: false, code: "non-canonical" };
  }
  if (game.revision !== request.positionRevision || game.sideToMove !== request.sideToMove) {
    return { ok: false, code: "identity-mismatch" };
  }
  return { ok: true, request, game };
}
