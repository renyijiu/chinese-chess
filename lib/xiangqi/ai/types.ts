import type { GameState, Side, Square } from "../types";

export const OPPONENT_PROTOCOL_VERSION = 1 as const;

export type LightweightTier = "lightweight-easy" | "lightweight-normal" | "lightweight-hard";

export type OpponentTier = LightweightTier | "fairy-master";

export interface CandidateMove {
  readonly from: Square;
  readonly to: Square;
}

export interface OpponentIdentityV1 {
  readonly matchId: string;
  readonly generation: number;
  readonly requestId: string;
}

export interface OpponentPositionIdentityV1 extends OpponentIdentityV1 {
  readonly positionRevision: number;
  readonly positionFingerprint: string;
  readonly sideToMove: Side;
}

export interface OpponentRequestV1 extends OpponentPositionIdentityV1 {
  readonly protocolVersion: typeof OPPONENT_PROTOCOL_VERSION;
  readonly type: "search";
  readonly serializedGame: string;
  readonly tier: OpponentTier;
  readonly seed: string;
  readonly nodeBudget: number;
  readonly depthCeiling: number;
  readonly safetyDeadlineMs: number;
}

export interface OpponentResultV1 extends OpponentPositionIdentityV1 {
  readonly protocolVersion: typeof OPPONENT_PROTOCOL_VERSION;
  readonly type: "result";
  readonly candidate: CandidateMove;
  readonly completedDepth: number;
  readonly nodes: number;
  readonly score: number;
}

export interface OpponentStopV1 extends OpponentIdentityV1 {
  readonly protocolVersion: typeof OPPONENT_PROTOCOL_VERSION;
  readonly type: "stop";
}

export interface OpponentStoppedV1 extends OpponentIdentityV1 {
  readonly protocolVersion: typeof OPPONENT_PROTOCOL_VERSION;
  readonly type: "stopped";
}

export type OpponentErrorCode =
  | "invalid-position"
  | "unsupported-tier"
  | "no-legal-move"
  | "search-failed";

export interface OpponentErrorV1 extends OpponentIdentityV1 {
  readonly protocolVersion: typeof OPPONENT_PROTOCOL_VERSION;
  readonly type: "error";
  readonly code: OpponentErrorCode;
  readonly message: string;
}

export type OpponentOutputV1 = OpponentResultV1 | OpponentStoppedV1 | OpponentErrorV1;

export type OpponentProviderFailure = Readonly<{
  code: "unavailable" | "invalid-request" | "cancelled" | "timeout" | "failed";
  recoverable: boolean;
  message: string;
}>;

export type OpponentProviderOutcome =
  | Readonly<{ ok: true; result: OpponentResultV1 }>
  | Readonly<{ ok: false; failure: OpponentProviderFailure }>;

export interface OpponentProvider {
  search(request: OpponentRequestV1): Promise<OpponentProviderOutcome>;
  stop(identity: OpponentIdentityV1): Promise<void>;
  dispose(): void;
}

export type ValidatedOpponentPosition = Readonly<{
  request: OpponentRequestV1;
  game: GameState;
}>;
