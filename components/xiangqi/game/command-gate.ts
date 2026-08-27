import {
  dispatch,
  type CommandError,
  type DomainEvent,
  type GameCommand,
} from "../../../lib/xiangqi/index";
import type { SavedMatch } from "./match";

export type CommandCommit = Readonly<{
  token: string;
  command: GameCommand;
  before: SavedMatch;
  after: SavedMatch;
  events: readonly DomainEvent[];
}>;

export type CommandGateReceipt =
  | Readonly<{
      status: "committed";
      token: string;
      beforeRevision: number;
      afterRevision: number;
    }>
  | Readonly<{
      status: "rejected";
      error: CommandError;
    }>
  | Readonly<{
      status: "superseded";
      reason: "busy" | "guard" | "invalidated" | "commit-failed";
    }>;

export type CommandGateExecution = Readonly<{
  guard?: (current: SavedMatch) => boolean;
  beforeCommit?: (commit: CommandCommit) => void;
}>;

export interface AuthoritativeCommandGateOptions {
  getCurrentMatch(): SavedMatch;
  commit(commit: CommandCommit): void | Promise<void>;
  onBusyChange?(busy: boolean): void;
}

/**
 * The sole asynchronous boundary around a rules command. It deliberately owns
 * no game policy: callers supply a current-state guard and the one commit
 * pipeline, while this class prevents stale closures and stale `finally`
 * handlers from changing the current lock.
 */
export class AuthoritativeCommandGate {
  readonly #options: AuthoritativeCommandGateOptions;
  readonly #idleWaiters = new Set<() => void>();
  #generation = 0;
  #sequence = 0;
  #activeToken: string | null = null;

  constructor(options: AuthoritativeCommandGateOptions) {
    this.#options = options;
  }

  get busy(): boolean {
    return this.#activeToken !== null;
  }

  invalidate(): void {
    this.#generation += 1;
    if (this.#activeToken === null) return;
    this.#activeToken = null;
    this.#options.onBusyChange?.(false);
    this.resolveIdleWaiters();
  }

  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  async execute(
    command: GameCommand,
    execution: CommandGateExecution = {},
  ): Promise<CommandGateReceipt> {
    if (this.#activeToken !== null) {
      return { status: "superseded", reason: "busy" };
    }

    const before = this.#options.getCurrentMatch();
    if (execution.guard && !execution.guard(before)) {
      return { status: "superseded", reason: "guard" };
    }
    const result = dispatch(before.game, command);
    if (result.error) return { status: "rejected", error: result.error };

    const generation = this.#generation;
    const token = `${generation}:${++this.#sequence}`;
    const after: SavedMatch = Object.freeze({
      config: before.config,
      game: result.state,
      revision: result.state.revision,
    });
    const commit: CommandCommit = Object.freeze({
      token,
      command,
      before,
      after,
      events: result.events,
    });
    this.#activeToken = token;
    this.#options.onBusyChange?.(true);

    try {
      execution.beforeCommit?.(commit);
      await this.#options.commit(commit);
      if (this.#generation !== generation || this.#activeToken !== token) {
        return { status: "superseded", reason: "invalidated" };
      }
      return {
        status: "committed",
        token,
        beforeRevision: before.revision,
        afterRevision: after.revision,
      };
    } catch {
      if (this.#generation !== generation || this.#activeToken !== token) {
        return { status: "superseded", reason: "invalidated" };
      }
      return { status: "superseded", reason: "commit-failed" };
    } finally {
      // Replacement invalidation or a newer command may already own the lock.
      if (this.#generation === generation && this.#activeToken === token) {
        this.#activeToken = null;
        this.#options.onBusyChange?.(false);
        this.resolveIdleWaiters();
      }
    }
  }

  private resolveIdleWaiters(): void {
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
  }
}
