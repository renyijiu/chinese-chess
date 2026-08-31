import {
  MAX_SIGNALING_FRAME_BYTES,
  SIGNALING_VERSION,
  type SignalingKind,
  type SignalingMessageV1,
  type WireCodecErrorCode,
  type WireCodecResult,
} from "./types";
import {
  decodeUtf8Frame,
  hasExactKeys,
  isBoundedId,
  isRecord,
  isSafeNonnegativeInteger,
  type OnlineWireFrame,
} from "./protocol";

const OFFER_KEYS = [
  "signalVersion",
  "kind",
  "sessionId",
  "pairingId",
  "matchId",
  "hostPeerId",
  "intent",
  "createdAt",
  "expiresAt",
  "description",
] as const;
const ANSWER_KEYS = [...OFFER_KEYS, "guestPeerId"] as const;

function failure<T>(code: WireCodecErrorCode): WireCodecResult<T> {
  return { ok: false, error: { code } };
}

function hasOneApplicationMediaSection(sdp: unknown): sdp is string {
  if (typeof sdp !== "string" || sdp.length === 0) return false;
  const mediaLines = sdp.split(/\r\n|\n|\r/).filter((line) => line.startsWith("m="));
  const mediaLine = mediaLines[0];
  return mediaLines.length === 1
    && mediaLine !== undefined
    && /^m=application(?:\s|$)/.test(mediaLine);
}

function hasValidDescription(value: unknown, kind: SignalingKind): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["type", "sdp"])
    && value.type === kind
    && hasOneApplicationMediaSection(value.sdp);
}

function hasValidCommonFields(value: Record<string, unknown>): boolean {
  return isBoundedId(value.sessionId)
    && isBoundedId(value.pairingId)
    && isBoundedId(value.matchId)
    && isBoundedId(value.hostPeerId)
    && (value.intent === "new" || value.intent === "resume")
    && isSafeNonnegativeInteger(value.createdAt)
    && isSafeNonnegativeInteger(value.expiresAt)
    && value.expiresAt > value.createdAt;
}

export function decodeSignalingMessageValueV1(
  value: unknown,
  expectedKind?: SignalingKind,
): WireCodecResult<SignalingMessageV1> {
  if (!isRecord(value)) return failure("schema");
  if (Object.hasOwn(value, "signalVersion") && value.signalVersion !== SIGNALING_VERSION) {
    return failure("version");
  }
  if (value.signalVersion !== SIGNALING_VERSION || !hasValidCommonFields(value)) {
    return failure("schema");
  }
  if (value.kind !== "offer" && value.kind !== "answer") return failure("schema");
  if (expectedKind !== undefined && value.kind !== expectedKind) return failure("kind");

  const valid = value.kind === "offer"
    ? hasExactKeys(value, OFFER_KEYS) && hasValidDescription(value.description, "offer")
    : hasExactKeys(value, ANSWER_KEYS)
      && isBoundedId(value.guestPeerId)
      && value.guestPeerId !== value.hostPeerId
      && hasValidDescription(value.description, "answer");

  return valid
    ? { ok: true, value: value as unknown as SignalingMessageV1 }
    : failure("schema");
}

export function decodeSignalingMessageV1(
  frame: OnlineWireFrame,
  expectedKind?: SignalingKind,
): WireCodecResult<SignalingMessageV1> {
  const decoded = decodeUtf8Frame(frame, MAX_SIGNALING_FRAME_BYTES);
  if (!decoded.ok) return decoded;

  let value: unknown;
  try {
    value = JSON.parse(decoded.value);
  } catch {
    return failure("json");
  }
  return decodeSignalingMessageValueV1(value, expectedKind);
}

export function encodeSignalingMessageV1(value: unknown): WireCodecResult<string> {
  const validated = decodeSignalingMessageValueV1(value);
  if (!validated.ok) return validated;

  let frame: string;
  try {
    frame = JSON.stringify(validated.value);
  } catch {
    return failure("schema");
  }
  const decoded = decodeSignalingMessageV1(frame, validated.value.kind);
  if (!decoded.ok) return decoded;
  return { ok: true, value: frame };
}

export function isSignalingMessageExpired(
  message: Pick<SignalingMessageV1, "expiresAt">,
  now = Date.now(),
): boolean {
  return now >= message.expiresAt;
}
