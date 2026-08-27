import { isSquare } from "../engine";
import { POPULAR_RULESET_ID, XIANGQI_SCHEMA_VERSION } from "../types";
import type { Side, Square } from "../types";
import {
  MAX_ONLINE_FRAME_BYTES,
  ONLINE_PROTOCOL_VERSION,
  type MovePayloadV1,
  type OnlineErrorCodeV1,
  type OnlineFeatureV1,
  type OnlineMessageV1,
  type WireCodecErrorCode,
  type WireCodecResult,
} from "./types";

const IDENTITY_KEYS = ["v", "type", "pairingId", "sessionId", "matchId", "senderPeerId", "seq"] as const;
const MESSAGE_KEYS = {
  hello: [...IDENTITY_KEYS, "intent", "signalingRole", "side", "gameSchemaVersion", "ruleset", "revision", "positionHash", "features"],
  ready: [...IDENTITY_KEYS, "revision", "positionHash"],
  command: [...IDENTITY_KEYS, "commandId", "actorSide", "expectedRevision", "beforeHash", "command", "afterRevision", "afterHash"],
  ack: [...IDENTITY_KEYS, "ackedMessageId", "ackedSeq", "status", "revision", "positionHash"],
  "snapshot-request": [...IDENTITY_KEYS, "requestId", "reason", "knownRevision", "knownHash"],
  snapshot: [...IDENTITY_KEYS, "requestId", "revision", "positionHash", "serializedGame"],
  ping: [...IDENTITY_KEYS, "nonce", "revision", "positionHash"],
  pong: [...IDENTITY_KEYS, "nonce", "revision", "positionHash"],
  "resign-request": [...IDENTITY_KEYS, "action", "proposalId", "resigningSide", "knownRevision", "knownHash"],
  "resign-commit": [...IDENTITY_KEYS, "action", "proposalId", "commandId", "resigningSide", "expectedRevision", "beforeHash", "afterRevision", "afterHash"],
  rematch: [...IDENTITY_KEYS, "action", "proposalId", "nextMatchId", "nextRematchIndex", "hostSide", "terminalRevision", "terminalHash"],
  error: [...IDENTITY_KEYS, "code", "fatal", "relatedSeq"],
} as const;

const FEATURES = new Set<OnlineFeatureV1>(["snapshot-v1", "rematch-v1"]);
const ERROR_CODES = new Set<OnlineErrorCodeV1>([
  "invalid-message",
  "unsupported-version",
  "identity-mismatch",
  "sequence-gap",
  "stale-revision",
  "position-mismatch",
  "invalid-command",
  "snapshot-required",
  "protocol-violation",
  "internal-error",
  "message-too-large",
  "rate-limit",
  "recovery-conflict",
]);

export type OnlineWireFrame = string | Uint8Array | ArrayBuffer;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

export function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

export function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isPositionHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isSide(value: unknown): value is Side {
  return value === "red" || value === "black";
}

function failure<T>(code: WireCodecErrorCode): WireCodecResult<T> {
  return { ok: false, error: { code } };
}

export function decodeUtf8Frame(
  frame: OnlineWireFrame,
  maximumBytes: number,
): WireCodecResult<string> {
  if (typeof frame === "string") {
    if (new TextEncoder().encode(frame).byteLength > maximumBytes) return failure("size");
    return { ok: true, value: frame };
  }

  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength > maximumBytes) return failure("size");
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return failure("encoding");
  }
}

function decodeSquare(value: unknown): Square | null {
  if (!isRecord(value) || !hasExactKeys(value, ["file", "rank"])) return null;
  if (typeof value.file !== "number" || typeof value.rank !== "number") return null;
  const square = { file: value.file, rank: value.rank };
  return isSquare(square) ? square : null;
}

function decodeMove(value: unknown): MovePayloadV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "from", "to"]) || value.type !== "move") {
    return null;
  }
  const from = decodeSquare(value.from);
  const to = decodeSquare(value.to);
  return from && to ? { type: "move", from, to } : null;
}

function hasValidIdentity(value: Record<string, unknown>): boolean {
  return isBoundedId(value.pairingId)
    && isBoundedId(value.sessionId)
    && isBoundedId(value.matchId)
    && isBoundedId(value.senderPeerId)
    && isSafeNonnegativeInteger(value.seq)
    && value.seq >= 1;
}

function hasCanonicalFeatures(value: unknown): value is ReadonlyArray<OnlineFeatureV1> {
  if (!Array.isArray(value) || value.length > FEATURES.size) return false;
  let previous = "";
  for (const feature of value) {
    if (typeof feature !== "string" || !FEATURES.has(feature as OnlineFeatureV1) || feature <= previous) {
      return false;
    }
    previous = feature;
  }
  return true;
}

function isBoundedReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function hasNextRevision(expectedRevision: unknown, afterRevision: unknown): boolean {
  return isSafeNonnegativeInteger(expectedRevision)
    && isSafeNonnegativeInteger(afterRevision)
    && expectedRevision < Number.MAX_SAFE_INTEGER
    && afterRevision === expectedRevision + 1;
}

export function decodeOnlineMessageValueV1(value: unknown): WireCodecResult<OnlineMessageV1> {
  if (!isRecord(value)) return failure("schema");
  if (Object.hasOwn(value, "v") && value.v !== ONLINE_PROTOCOL_VERSION) return failure("version");
  if (value.v !== ONLINE_PROTOCOL_VERSION || typeof value.type !== "string" || !hasValidIdentity(value)) {
    return failure("schema");
  }

  let valid = false;
  switch (value.type) {
    case "hello":
      valid = hasExactKeys(value, MESSAGE_KEYS.hello)
        && (value.intent === "new" || value.intent === "resume")
        && (value.signalingRole === "host" || value.signalingRole === "guest")
        && isSide(value.side)
        && value.gameSchemaVersion === XIANGQI_SCHEMA_VERSION
        && value.ruleset === POPULAR_RULESET_ID
        && isSafeNonnegativeInteger(value.revision)
        && isPositionHash(value.positionHash)
        && hasCanonicalFeatures(value.features);
      break;
    case "ready":
      valid = hasExactKeys(value, MESSAGE_KEYS.ready)
        && isSafeNonnegativeInteger(value.revision)
        && isPositionHash(value.positionHash);
      break;
    case "command":
      valid = hasExactKeys(value, MESSAGE_KEYS.command)
        && isBoundedId(value.commandId)
        && isSide(value.actorSide)
        && hasNextRevision(value.expectedRevision, value.afterRevision)
        && isPositionHash(value.beforeHash)
        && decodeMove(value.command) !== null
        && isPositionHash(value.afterHash);
      break;
    case "ack":
      valid = hasExactKeys(value, MESSAGE_KEYS.ack)
        && isBoundedId(value.ackedMessageId)
        && isSafeNonnegativeInteger(value.ackedSeq)
        && (value.status === "applied" || value.status === "duplicate")
        && isSafeNonnegativeInteger(value.revision)
        && isPositionHash(value.positionHash);
      break;
    case "snapshot-request":
      valid = hasExactKeys(value, MESSAGE_KEYS["snapshot-request"])
        && isBoundedId(value.requestId)
        && isBoundedReason(value.reason)
        && isSafeNonnegativeInteger(value.knownRevision)
        && isPositionHash(value.knownHash);
      break;
    case "snapshot":
      valid = hasExactKeys(value, MESSAGE_KEYS.snapshot)
        && isBoundedId(value.requestId)
        && isSafeNonnegativeInteger(value.revision)
        && isPositionHash(value.positionHash)
        && typeof value.serializedGame === "string"
        && value.serializedGame.length > 0;
      break;
    case "ping":
    case "pong":
      valid = hasExactKeys(value, MESSAGE_KEYS[value.type])
        && isBoundedId(value.nonce)
        && isSafeNonnegativeInteger(value.revision)
        && isPositionHash(value.positionHash);
      break;
    case "resign":
      if (value.action === "request") {
        valid = hasExactKeys(value, MESSAGE_KEYS["resign-request"])
          && isBoundedId(value.proposalId)
          && isSide(value.resigningSide)
          && isSafeNonnegativeInteger(value.knownRevision)
          && isPositionHash(value.knownHash);
      } else if (value.action === "commit") {
        valid = hasExactKeys(value, MESSAGE_KEYS["resign-commit"])
          && isBoundedId(value.proposalId)
          && isBoundedId(value.commandId)
          && isSide(value.resigningSide)
          && hasNextRevision(value.expectedRevision, value.afterRevision)
          && isPositionHash(value.beforeHash)
          && isPositionHash(value.afterHash);
      }
      break;
    case "rematch":
      valid = hasExactKeys(value, MESSAGE_KEYS.rematch)
        && (value.action === "request" || value.action === "accept" || value.action === "decline" || value.action === "cancel")
        && isBoundedId(value.proposalId)
        && isBoundedId(value.nextMatchId)
        && isSafeNonnegativeInteger(value.nextRematchIndex)
        && isSide(value.hostSide)
        && isSafeNonnegativeInteger(value.terminalRevision)
        && isPositionHash(value.terminalHash);
      break;
    case "error":
      valid = hasExactKeys(value, MESSAGE_KEYS.error)
        && typeof value.code === "string"
        && ERROR_CODES.has(value.code as OnlineErrorCodeV1)
        && typeof value.fatal === "boolean"
        && isSafeNonnegativeInteger(value.relatedSeq);
      break;
    default:
      return failure("schema");
  }

  return valid
    ? { ok: true, value: value as unknown as OnlineMessageV1 }
    : failure("schema");
}

export function decodeOnlineMessageV1(frame: OnlineWireFrame): WireCodecResult<OnlineMessageV1> {
  const decoded = decodeUtf8Frame(frame, MAX_ONLINE_FRAME_BYTES);
  if (!decoded.ok) return decoded;

  let value: unknown;
  try {
    value = JSON.parse(decoded.value);
  } catch {
    return failure("json");
  }
  return decodeOnlineMessageValueV1(value);
}

export function encodeOnlineMessageV1(value: unknown): WireCodecResult<string> {
  const validated = decodeOnlineMessageValueV1(value);
  if (!validated.ok) return validated;

  let frame: string;
  try {
    frame = JSON.stringify(validated.value);
  } catch {
    return failure("schema");
  }
  const decoded = decodeOnlineMessageV1(frame);
  if (!decoded.ok) return decoded;
  return { ok: true, value: frame };
}
