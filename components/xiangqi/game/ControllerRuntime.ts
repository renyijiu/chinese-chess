import type { CommandCommit } from "./command-gate";
import type { SavedMatch } from "./match";

type OpponentFallbackTier = "lightweight-hard";

/**
 * Mutable bridge used by long-lived coordinators so they can read the latest
 * match and callbacks without recreating those coordinators on every render.
 */
export class ControllerRuntime {
  #match: SavedMatch;
  #mounted = true;
  #commit: (commit: CommandCommit) => Promise<void> = async () => undefined;
  #fallback: (matchId: string, toTier: OpponentFallbackTier) => Promise<void> = async () => undefined;

  constructor(match: SavedMatch) {
    this.#match = match;
  }

  get currentMatch(): SavedMatch {
    return this.#match;
  }

  get isMounted(): boolean {
    return this.#mounted;
  }

  synchronize(match: SavedMatch): void {
    this.#match = match;
  }

  setMounted(mounted: boolean): void {
    this.#mounted = mounted;
  }

  setHandlers(
    commit: (value: CommandCommit) => Promise<void>,
    fallback: (matchId: string, toTier: OpponentFallbackTier) => Promise<void>,
  ): void {
    this.#commit = commit;
    this.#fallback = fallback;
  }

  commit(value: CommandCommit): Promise<void> {
    return this.#commit(value);
  }

  fallback(matchId: string, toTier: OpponentFallbackTier): Promise<void> {
    return this.#fallback(matchId, toTier);
  }
}
