import type { Side, Square } from "../types";

export const ONLINE_PROTOCOL_VERSION = 1 as const;
export const SIGNALING_VERSION = 1 as const;
export const MAX_ONLINE_FRAME_BYTES = 16_384 as const;
export const MAX_SIGNALING_FRAME_BYTES = 65_536 as const;

export type WireCodecErrorCode = "size" | "encoding" | "json" | "schema" | "version" | "kind";

export type WireCodecResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: WireCodecErrorCode }> }>;

export type OnlineFeatureV1 = "snapshot-v1" | "rematch-v1";
export type OnlineIntentV1 = "new" | "resume";
export type SignalingRole = "host" | "guest";
export type OnlineMessageTypeV1 =
  | "hello"
  | "ready"
  | "command"
  | "ack"
  | "snapshot-request"
  | "snapshot"
  | "ping"
  | "pong"
  | "resign"
  | "rematch"
  | "error";

export type OnlineErrorCodeV1 =
  | "invalid-message"
  | "unsupported-version"
  | "identity-mismatch"
  | "sequence-gap"
  | "stale-revision"
  | "position-mismatch"
  | "invalid-command"
  | "snapshot-required"
  | "protocol-violation"
  | "internal-error"
  | "message-too-large"
  | "rate-limit"
  | "recovery-conflict";

export interface OnlineIdentityV1 {
  readonly v: typeof ONLINE_PROTOCOL_VERSION;
  readonly type: OnlineMessageTypeV1;
  readonly pairingId: string;
  readonly sessionId: string;
  readonly matchId: string;
  readonly senderPeerId: string;
  readonly seq: number;
}

export interface MovePayloadV1 {
  readonly type: "move";
  readonly from: Square;
  readonly to: Square;
}

export interface HelloMessageV1 extends OnlineIdentityV1 {
  readonly type: "hello";
  readonly intent: OnlineIntentV1;
  readonly signalingRole: SignalingRole;
  readonly side: Side;
  readonly gameSchemaVersion: 1;
  readonly ruleset: "popular-v1";
  readonly revision: number;
  readonly positionHash: string;
  readonly features: ReadonlyArray<OnlineFeatureV1>;
}

export interface ReadyMessageV1 extends OnlineIdentityV1 {
  readonly type: "ready";
  readonly revision: number;
  readonly positionHash: string;
}

export interface CommandMessageV1 extends OnlineIdentityV1 {
  readonly type: "command";
  readonly commandId: string;
  readonly actorSide: Side;
  readonly expectedRevision: number;
  readonly beforeHash: string;
  readonly command: MovePayloadV1;
  readonly afterRevision: number;
  readonly afterHash: string;
}

export interface AckMessageV1 extends OnlineIdentityV1 {
  readonly type: "ack";
  readonly ackedMessageId: string;
  readonly ackedSeq: number;
  readonly status: "applied" | "duplicate";
  readonly revision: number;
  readonly positionHash: string;
}

export interface SnapshotRequestMessageV1 extends OnlineIdentityV1 {
  readonly type: "snapshot-request";
  readonly requestId: string;
  readonly reason: string;
  readonly knownRevision: number;
  readonly knownHash: string;
}

export interface SnapshotMessageV1 extends OnlineIdentityV1 {
  readonly type: "snapshot";
  readonly requestId: string;
  readonly revision: number;
  readonly positionHash: string;
  readonly serializedGame: string;
}

export interface PingMessageV1 extends OnlineIdentityV1 {
  readonly type: "ping";
  readonly nonce: string;
  readonly revision: number;
  readonly positionHash: string;
}

export interface PongMessageV1 extends OnlineIdentityV1 {
  readonly type: "pong";
  readonly nonce: string;
  readonly revision: number;
  readonly positionHash: string;
}

export interface ResignMessageV1 extends OnlineIdentityV1 {
  readonly type: "resign";
  readonly commandId: string;
  readonly resigningSide: Side;
  readonly expectedRevision: number;
  readonly beforeHash: string;
  readonly afterRevision: number;
  readonly afterHash: string;
}

export interface RematchMessageV1 extends OnlineIdentityV1 {
  readonly type: "rematch";
  readonly action: "request" | "accept" | "decline" | "cancel";
  readonly proposalId: string;
  readonly nextMatchId: string;
  readonly nextRematchIndex: number;
  readonly hostSide: Side;
  readonly terminalRevision: number;
  readonly terminalHash: string;
}

export interface ErrorMessageV1 extends OnlineIdentityV1 {
  readonly type: "error";
  readonly code: OnlineErrorCodeV1;
  readonly fatal: boolean;
  readonly relatedSeq: number;
}

export type OnlineMessageV1 =
  | HelloMessageV1
  | ReadyMessageV1
  | CommandMessageV1
  | AckMessageV1
  | SnapshotRequestMessageV1
  | SnapshotMessageV1
  | PingMessageV1
  | PongMessageV1
  | ResignMessageV1
  | RematchMessageV1
  | ErrorMessageV1;

export type SignalingKind = "offer" | "answer";

export interface SignalingDescriptionV1 {
  readonly type: SignalingKind;
  readonly sdp: string;
}

interface SignalingIdentityV1 {
  readonly signalVersion: typeof SIGNALING_VERSION;
  readonly sessionId: string;
  readonly pairingId: string;
  readonly matchId: string;
  readonly hostPeerId: string;
  readonly intent: OnlineIntentV1;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface SignalingOfferV1 extends SignalingIdentityV1 {
  readonly kind: "offer";
  readonly description: Readonly<{ type: "offer"; sdp: string }>;
}

export interface SignalingAnswerV1 extends SignalingIdentityV1 {
  readonly kind: "answer";
  readonly guestPeerId: string;
  readonly description: Readonly<{ type: "answer"; sdp: string }>;
}

export type SignalingMessageV1 = SignalingOfferV1 | SignalingAnswerV1;
