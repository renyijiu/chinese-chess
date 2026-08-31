import { dispatch, getLegalMoves, getPieceAt, isInCheck } from "../engine";
import type { GameState, Role, Side, Square } from "../types";
import { LIGHTWEIGHT_TIER_LIMITS } from "./search-limits";
import type { CandidateMove, LightweightTier } from "./types";

const MATE_SCORE = 1_000_000;
const NEGATIVE_INFINITY = -2_000_000;
const POSITIVE_INFINITY = 2_000_000;

const MATERIAL: Readonly<Record<Role, number>> = {
  general: 100_000,
  advisor: 200,
  elephant: 220,
  chariot: 900,
  horse: 420,
  cannon: 450,
  soldier: 100,
};

export const LIGHTWEIGHT_BATCH_NODES = 128;

interface SearchTransition {
  readonly candidate: CandidateMove;
  readonly state: GameState;
  readonly orderScore: number;
}

interface RootScore {
  readonly candidate: CandidateMove;
  readonly score: number;
}

interface SearchFrame {
  readonly state: GameState;
  readonly depth: number;
  readonly ply: number;
  readonly parentCandidate: CandidateMove | null;
  alpha: number;
  readonly beta: number;
  stage: "enter" | "explore";
  moves: ReadonlyArray<SearchTransition>;
  moveIndex: number;
  bestScore: number;
  bestCandidate: CandidateMove | null;
  readonly rootScores: RootScore[];
}

export interface LightweightSearchOptions {
  readonly tier: LightweightTier;
  readonly seed: string;
  readonly nodeBudget?: number;
  readonly depthCeiling?: number;
  readonly safetyDeadlineMs?: number;
  readonly now?: () => number;
}

export type LightweightSearchReason = "complete" | "budget" | "deadline" | "cancelled";

export interface LightweightSearchResult {
  readonly candidate: CandidateMove | null;
  readonly completedDepth: number;
  readonly nodes: number;
  readonly score: number;
  readonly source: "search" | "fallback" | "none";
  readonly reason: LightweightSearchReason;
}

export interface LightweightSearchProgress {
  readonly done: boolean;
  readonly completedDepth: number;
  readonly nodes: number;
}

export interface BatchedLightweightSearchOptions extends LightweightSearchOptions {
  readonly batchNodes?: number;
  readonly yieldTask?: () => Promise<void>;
  readonly isCancelled: () => boolean;
}

function opposite(side: Side): Side {
  return side === "red" ? "black" : "red";
}

function squareKey(square: Square): number {
  return square.rank * 9 + square.file;
}

function compareCandidates(left: CandidateMove, right: CandidateMove): number {
  return squareKey(left.from) - squareKey(right.from)
    || squareKey(left.to) - squareKey(right.to);
}

function positionalValue(role: Role, side: Side, square: Square): number {
  const center = 4 - Math.abs(4 - square.file);
  switch (role) {
    case "soldier": {
      const progress = side === "red" ? square.rank : 9 - square.rank;
      return progress * 12 + (progress >= 5 ? center * 3 : 0);
    }
    case "horse": return center * 5;
    case "cannon": return center * 2;
    case "chariot": return center;
    case "advisor":
    case "elephant":
    case "general": return 0;
  }
}

function terminalScore(state: GameState, ply: number): number | null {
  if (state.status.kind !== "ended") return null;
  if (!state.status.winner) return 0;
  return state.status.winner === state.sideToMove
    ? MATE_SCORE - ply
    : -MATE_SCORE + ply;
}

export function evaluatePosition(state: GameState): number {
  const terminal = terminalScore(state, 0);
  if (terminal !== null) return terminal;
  let red = 0;
  let black = 0;
  for (const piece of state.board) {
    if (!piece) continue;
    const value = MATERIAL[piece.role] + positionalValue(piece.role, piece.side, piece.square);
    if (piece.side === "red") red += value;
    else black += value;
  }
  let score = state.sideToMove === "red" ? red - black : black - red;
  if (isInCheck(state, state.sideToMove)) score -= 45;
  if (isInCheck(state, opposite(state.sideToMove))) score += 45;
  return score;
}

function evaluateLeaf(state: GameState, ply: number): number {
  return terminalScore(state, ply) ?? evaluatePosition(state);
}

function transitionOrder(state: GameState, candidate: CandidateMove, next: GameState): number {
  const captured = getPieceAt(state, candidate.to);
  let score = captured ? MATERIAL[captured.role] * 10 : 0;
  if (next.status.kind === "ended" && next.status.winner === state.sideToMove) score += MATE_SCORE;
  else if (next.status.kind === "playing" && next.status.check === next.sideToMove) score += 5_000;
  const mover = getPieceAt(state, candidate.from);
  if (mover) score -= MATERIAL[mover.role];
  return score;
}

function legalTransitions(state: GameState): SearchTransition[] {
  if (state.status.kind !== "playing") return [];
  const transitions: SearchTransition[] = [];
  for (const piece of state.board) {
    if (!piece || piece.side !== state.sideToMove) continue;
    for (const to of getLegalMoves(state, piece.id)) {
      const candidate = {
        from: { ...piece.square },
        to: { ...to },
      };
      const result = dispatch(state, {
        type: "move",
        expectedRevision: state.revision,
        ...candidate,
      });
      if (!result.error) {
        transitions.push({
          candidate,
          state: result.state,
          orderScore: transitionOrder(state, candidate, result.state),
        });
      }
    }
  }
  return transitions.sort((left, right) =>
    right.orderScore - left.orderScore || compareCandidates(left.candidate, right.candidate));
}

export function getDeterministicFallbackCandidate(state: GameState): CandidateMove | null {
  return legalTransitions(state)[0]?.candidate ?? null;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function chooseCompletedMove(
  scores: ReadonlyArray<RootScore>,
  tier: LightweightTier,
  seed: string,
  depth: number,
): RootScore | null {
  if (scores.length === 0) return null;
  const ordered = [...scores].sort((left, right) =>
    right.score - left.score || compareCandidates(left.candidate, right.candidate));
  const strongest = ordered[0];
  if (!strongest) return null;
  if (tier !== "lightweight-easy") return strongest;
  const best = strongest.score;
  const choices = ordered.filter(({ score }) => score >= best - 80).slice(0, 3);
  return choices[hashSeed(`${seed}:${depth}`) % choices.length] ?? strongest;
}

function createFrame(
  state: GameState,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  parentCandidate: CandidateMove | null,
): SearchFrame {
  return {
    state,
    depth,
    ply,
    parentCandidate,
    alpha,
    beta,
    stage: "enter",
    moves: [],
    moveIndex: 0,
    bestScore: NEGATIVE_INFINITY,
    bestCandidate: null,
    rootScores: [],
  };
}

export class ResumableLightweightSearch {
  readonly #state: GameState;
  readonly #tier: LightweightTier;
  readonly #seed: string;
  readonly #nodeBudget: number;
  readonly #depthCeiling: number;
  readonly #now: () => number;
  readonly #deadlineAt: number;
  #stack: SearchFrame[];
  #nodes = 0;
  #completedDepth = 0;
  #completedCandidate: CandidateMove | null = null;
  #completedScore = 0;
  #reason: Exclude<LightweightSearchReason, "cancelled"> | null = null;

  constructor(state: GameState, options: LightweightSearchOptions) {
    const defaults = LIGHTWEIGHT_TIER_LIMITS[options.tier];
    this.#state = state;
    this.#tier = options.tier;
    this.#seed = options.seed;
    this.#nodeBudget = Math.max(1, Math.floor(options.nodeBudget ?? defaults.nodeBudget));
    this.#depthCeiling = Math.max(1, Math.floor(options.depthCeiling ?? defaults.depthCeiling));
    this.#now = options.now ?? (() => performance.now());
    this.#deadlineAt = this.#now() + Math.max(1, options.safetyDeadlineMs ?? defaults.safetyDeadlineMs);
    this.#stack = [createFrame(state, 1, 0, NEGATIVE_INFINITY, POSITIVE_INFINITY, null)];
  }

  step(maxNodes: number): LightweightSearchProgress {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
      throw new RangeError("A search batch must contain at least one node.");
    }
    if (this.#reason) return this.progress();
    const batchStart = this.#nodes;
    while (!this.#reason) {
      const frame = this.#stack.at(-1);
      if (!frame) {
        this.#reason = "complete";
        break;
      }
      if (frame.stage === "enter") {
        if (this.#nodes >= this.#nodeBudget) {
          this.#reason = "budget";
          break;
        }
        if (this.#now() >= this.#deadlineAt) {
          this.#reason = "deadline";
          break;
        }
        if (this.#nodes - batchStart >= maxNodes) break;
        this.#nodes += 1;
        const leaf = terminalScore(frame.state, frame.ply);
        if (leaf !== null || frame.depth === 0) {
          this.completeFrame(leaf ?? evaluateLeaf(frame.state, frame.ply));
          continue;
        }
        frame.moves = legalTransitions(frame.state);
        if (frame.moves.length === 0) {
          this.completeFrame(evaluateLeaf(frame.state, frame.ply));
          continue;
        }
        frame.stage = "explore";
        continue;
      }
      if (frame.moveIndex >= frame.moves.length) {
        this.completeFrame(frame.bestScore);
        continue;
      }
      const transition = frame.moves[frame.moveIndex];
      frame.moveIndex += 1;
      if (!transition) continue;
      const childAlpha = frame.ply === 0 ? NEGATIVE_INFINITY : -frame.beta;
      const childBeta = frame.ply === 0 ? POSITIVE_INFINITY : -frame.alpha;
      this.#stack.push(createFrame(
        transition.state,
        frame.depth - 1,
        frame.ply + 1,
        childAlpha,
        childBeta,
        transition.candidate,
      ));
    }
    return this.progress();
  }

  result(): LightweightSearchResult {
    const fallback = this.#completedCandidate ?? getDeterministicFallbackCandidate(this.#state);
    return {
      candidate: fallback,
      completedDepth: this.#completedDepth,
      nodes: this.#nodes,
      score: this.#completedScore,
      source: this.#completedCandidate ? "search" : fallback ? "fallback" : "none",
      reason: this.#reason ?? "complete",
    };
  }

  private progress(): LightweightSearchProgress {
    return {
      done: this.#reason !== null,
      completedDepth: this.#completedDepth,
      nodes: this.#nodes,
    };
  }

  private completeFrame(score: number): void {
    const frame = this.#stack.pop();
    if (!frame) return;
    const parent = this.#stack.at(-1);
    if (!parent) {
      const chosen = chooseCompletedMove(frame.rootScores, this.#tier, this.#seed, frame.ply + frame.depth);
      this.#completedDepth = frame.depth;
      this.#completedCandidate = chosen?.candidate ?? frame.bestCandidate;
      this.#completedScore = chosen?.score ?? score;
      if (this.#completedDepth >= this.#depthCeiling) {
        this.#reason = "complete";
      } else {
        const nextDepth = this.#completedDepth + 1;
        this.#stack.push(createFrame(
          this.#state,
          nextDepth,
          0,
          NEGATIVE_INFINITY,
          POSITIVE_INFINITY,
          null,
        ));
      }
      return;
    }
    const parentScore = -score;
    if (parent.ply === 0 && frame.parentCandidate) {
      parent.rootScores.push({ candidate: frame.parentCandidate, score: parentScore });
    }
    if (
      parentScore > parent.bestScore
      || (parentScore === parent.bestScore
        && frame.parentCandidate
        && (!parent.bestCandidate || compareCandidates(frame.parentCandidate, parent.bestCandidate) < 0))
    ) {
      parent.bestScore = parentScore;
      parent.bestCandidate = frame.parentCandidate;
    }
    if (parentScore > parent.alpha) parent.alpha = parentScore;
    if (parent.alpha >= parent.beta) parent.moveIndex = parent.moves.length;
  }
}

export function createLightweightSearch(
  state: GameState,
  options: LightweightSearchOptions,
): ResumableLightweightSearch {
  return new ResumableLightweightSearch(state, options);
}

export async function runLightweightSearchBatched(
  state: GameState,
  options: BatchedLightweightSearchOptions,
): Promise<LightweightSearchResult> {
  const search = createLightweightSearch(state, options);
  const batchNodes = options.batchNodes ?? LIGHTWEIGHT_BATCH_NODES;
  const yieldTask = options.yieldTask ?? yieldToEventLoopTask;
  for (;;) {
    if (options.isCancelled()) {
      const partial = search.result();
      return { ...partial, candidate: null, source: "none", reason: "cancelled" };
    }
    const progress = search.step(batchNodes);
    if (progress.done) return search.result();
    await yieldTask();
  }
}

export function yieldToEventLoopTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
