export {
  createOpponentErrorV1,
  decodeOpponentErrorV1,
  decodeOpponentOutputV1,
  decodeOpponentRequestV1,
  decodeOpponentResultV1,
  decodeOpponentStopV1,
  decodeOpponentStoppedV1,
  isLightweightTier,
  validateOpponentRequestPosition,
} from "./protocol";
export type { PositionDigest, PositionValidationResult } from "./protocol";
export {
  LIGHTWEIGHT_BATCH_NODES,
  LIGHTWEIGHT_TIER_LIMITS,
  ResumableLightweightSearch,
  createLightweightSearch,
  evaluatePosition,
  getDeterministicFallbackCandidate,
  runLightweightSearchBatched,
  yieldToEventLoopTask,
} from "./lightweight";
export type {
  BatchedLightweightSearchOptions,
  LightweightSearchOptions,
  LightweightSearchProgress,
  LightweightSearchReason,
  LightweightSearchResult,
} from "./lightweight";
export { OPPONENT_PROTOCOL_VERSION } from "./types";
export type {
  CandidateMove,
  LightweightTier,
  OpponentErrorCode,
  OpponentErrorV1,
  OpponentIdentityV1,
  OpponentOutputV1,
  OpponentPositionIdentityV1,
  OpponentProvider,
  OpponentProviderFailure,
  OpponentProviderOutcome,
  OpponentRequestV1,
  OpponentResultV1,
  OpponentStopV1,
  OpponentStoppedV1,
  OpponentTier,
  ValidatedOpponentPosition,
} from "./types";
