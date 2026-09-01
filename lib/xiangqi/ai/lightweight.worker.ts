import {
  LIGHTWEIGHT_BATCH_NODES,
  createOpponentErrorV1,
  decodeOpponentRequestV1,
  decodeOpponentStopV1,
  isLightweightTier,
  runLightweightSearchBatched,
  validateOpponentRequestPosition,
} from "./index";
import {
  OPPONENT_PROTOCOL_VERSION,
  type OpponentErrorCode,
  type OpponentIdentityV1,
  type OpponentRequestV1,
  type OpponentStoppedV1,
} from "./types";

type ActiveSearch = OpponentIdentityV1 & { cancelled: boolean; stopAcknowledged: boolean };

const scope = globalThis as typeof globalThis & {
  postMessage(message: unknown): void;
};

let active: ActiveSearch | null = null;

function sameIdentity(left: OpponentIdentityV1, right: OpponentIdentityV1): boolean {
  return (
    left.matchId === right.matchId &&
    left.generation === right.generation &&
    left.requestId === right.requestId
  );
}

function postError(request: OpponentIdentityV1, code: OpponentErrorCode, message: string): void {
  scope.postMessage(createOpponentErrorV1(request, code, message));
}

function acknowledgeStop(search: ActiveSearch): void {
  if (search.stopAcknowledged) return;
  search.stopAcknowledged = true;
  const stopped: OpponentStoppedV1 = {
    protocolVersion: OPPONENT_PROTOCOL_VERSION,
    type: "stopped",
    matchId: search.matchId,
    generation: search.generation,
    requestId: search.requestId,
  };
  scope.postMessage(stopped);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function execute(request: OpponentRequestV1, search: ActiveSearch): Promise<void> {
  try {
    if (!isLightweightTier(request.tier)) {
      postError(
        request,
        "unsupported-tier",
        "The lightweight engine cannot run the requested tier.",
      );
      return;
    }
    const validated = await validateOpponentRequestPosition(request, sha256Hex);
    if (!validated.ok) {
      postError(request, "invalid-position", `Position validation failed: ${validated.code}.`);
      return;
    }
    const result = await runLightweightSearchBatched(validated.game, {
      tier: request.tier,
      seed: request.seed,
      nodeBudget: request.nodeBudget,
      depthCeiling: request.depthCeiling,
      safetyDeadlineMs: request.safetyDeadlineMs,
      batchNodes: LIGHTWEIGHT_BATCH_NODES,
      isCancelled: () => search.cancelled || active !== search,
    });
    if (search.cancelled || active !== search) return;
    if (!result.candidate) {
      postError(request, "no-legal-move", "The position has no legal candidate move.");
      return;
    }
    scope.postMessage({
      protocolVersion: OPPONENT_PROTOCOL_VERSION,
      type: "result",
      matchId: request.matchId,
      generation: request.generation,
      requestId: request.requestId,
      positionRevision: request.positionRevision,
      positionFingerprint: request.positionFingerprint,
      sideToMove: request.sideToMove,
      candidate: result.candidate,
      completedDepth: result.completedDepth,
      nodes: result.nodes,
      score: result.score,
    });
  } catch {
    if (!search.cancelled && active === search) {
      postError(request, "search-failed", "The lightweight search failed.");
    }
  } finally {
    if (active === search) active = null;
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const stop = decodeOpponentStopV1(event.data);
  if (stop) {
    if (active && sameIdentity(active, stop)) {
      active.cancelled = true;
      acknowledgeStop(active);
    }
    return;
  }
  const request = decodeOpponentRequestV1(event.data);
  if (!request) return;
  if (active) {
    active.cancelled = true;
    acknowledgeStop(active);
  }
  const search: ActiveSearch = {
    matchId: request.matchId,
    generation: request.generation,
    requestId: request.requestId,
    cancelled: false,
    stopAcknowledged: false,
  };
  active = search;
  void execute(request, search);
});
