import { describe, expect, it } from "vitest";

import { createInitialGame, dispatch, type GameState } from "../../../lib/xiangqi/index";
import {
  createComputerMatch,
  createLocalMatch,
  setEffectiveOpponentTier,
  type EntropySource,
  type SavedMatch,
} from "../../../components/xiangqi/game/match";
import {
  DEFAULT_GAME_SETTINGS,
  GAME_SAVE_BACKUP_KEY,
  GAME_SAVE_KEY,
  GAME_SETTINGS_KEY,
  LEGACY_GAME_SAVE_BACKUP_KEY,
  LEGACY_GAME_SAVE_KEY,
  loadGameSnapshot,
  loadGameSettings,
  saveGameSettings,
  saveGameSnapshot,
  type GameSnapshotLockManager,
  type GameSnapshotWriteIntent,
  type StorageLike,
} from "../../../components/xiangqi/game/storage";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class ReadbackWinnerStorage implements StorageLike {
  attemptedPrimary: string | null = null;
  #replacePrimaryOnReadback = false;

  constructor(
    private readonly backing: MemoryStorage,
    private readonly winnerToken: string,
  ) {}

  getItem(key: string) {
    if (key === GAME_SAVE_KEY && this.#replacePrimaryOnReadback) {
      this.#replacePrimaryOnReadback = false;
      this.backing.setItem(key, this.winnerToken);
    }
    return this.backing.getItem(key);
  }

  setItem(key: string, value: string) {
    this.backing.setItem(key, value);
    if (key === GAME_SAVE_KEY) {
      this.attemptedPrimary = value;
      this.#replacePrimaryOnReadback = true;
    }
  }
}

class MemoryLockManager implements GameSnapshotLockManager {
  #tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, callback: () => T): Promise<T> {
    const result = this.#tail.then(callback);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

const testLockManager = new MemoryLockManager();

function saveSnapshot(
  storage: StorageLike,
  value: SavedMatch | GameState,
  intent: GameSnapshotWriteIntent,
  savedAt = Date.now(),
) {
  return saveGameSnapshot(storage, value, intent, savedAt, testLockManager);
}

const fixedEntropy: EntropySource = (target) => target.fill(7);

type MutableSaveEnvelope = Record<string, unknown> & {
  match: Record<string, unknown>;
};

describe("local game persistence", () => {
  it("round-trips a versioned primary snapshot", async () => {
    const storage = new MemoryStorage();
    const match = createLocalMatch(createInitialGame());

    expect(await saveSnapshot(storage, match, { overwrite: true }, 1_700_000_000_000)).toMatchObject({
      ok: true,
      resumable: true,
    });
    const loaded = loadGameSnapshot(storage);

    expect(loaded.source).toBe("primary");
    expect(loaded.savedMatch).toEqual(match);
    expect(loaded.game?.revision).toBe(0);
    expect(JSON.parse(storage.getItem(GAME_SAVE_KEY) ?? "{}")).toMatchObject({
      kind: "xiangqi-game-save",
      version: 2,
      savedAt: 1_700_000_000_000,
      revision: 0,
      match: { mode: "local" },
    });
  });

  it("keeps the last valid primary as backup and restores it when the new primary is corrupt", async () => {
    const storage = new MemoryStorage();
    const initial = createInitialGame();
    const initialWrite = await saveSnapshot(
      storage,
      createLocalMatch(initial),
      { overwrite: true },
      1,
    );
    expect(initialWrite).toMatchObject({ ok: true });
    if (!initialWrite.ok) throw new Error("Expected the initial save to succeed");

    const moved = dispatch(initial, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state;
    expect(await saveSnapshot(
      storage,
      createLocalMatch(moved),
      { expectedToken: initialWrite.snapshotToken },
      2,
    )).toMatchObject({ ok: true });
    expect(storage.getItem(GAME_SAVE_BACKUP_KEY)).not.toBeNull();

    storage.setItem(GAME_SAVE_KEY, "{broken");
    const loaded = loadGameSnapshot(storage);
    expect(loaded.source).toBe("backup");
    expect(loaded.game?.revision).toBe(0);
    expect(loaded.warning).toMatch(/备份/);
  });

  it("rejects the second writer when two tabs branch from the same parent snapshot", async () => {
    const storage = new MemoryStorage();
    const initial = createLocalMatch(createInitialGame());
    expect(await saveSnapshot(storage, initial, { overwrite: true }, 1)).toMatchObject({ ok: true });

    const writerA = loadGameSnapshot(storage);
    const writerB = loadGameSnapshot(storage);
    expect(writerA.snapshotToken).toBe(writerB.snapshotToken);

    const firstBranch = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state);
    const secondBranch = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 2, rank: 3 },
      to: { file: 2, rank: 4 },
    }).state);

    const firstWrite = await saveSnapshot(storage, firstBranch, {
      expectedToken: writerA.snapshotToken,
    }, 2);
    expect(firstWrite).toMatchObject({ ok: true, resumable: true });
    const secondWrite = await saveSnapshot(storage, secondBranch, {
      expectedToken: writerB.snapshotToken,
    }, 3);

    expect(secondWrite).toMatchObject({
      ok: false,
      reason: "conflict",
      resumable: false,
      warning: expect.stringMatching(/其他标签页/),
    });
    expect(loadGameSnapshot(storage).savedMatch).toEqual(firstBranch);
  });

  it("serializes two synchronized writers so exactly one advances their shared parent", async () => {
    const storage = new MemoryStorage();
    const initial = createLocalMatch(createInitialGame());
    const initialWrite = await saveSnapshot(storage, initial, { overwrite: true }, 1);
    if (!initialWrite.ok) throw new Error("Expected the initial save to succeed");

    const firstBranch = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state);
    const secondBranch = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 2, rank: 3 },
      to: { file: 2, rank: 4 },
    }).state);

    let releaseWriters!: () => void;
    const writerBarrier = new Promise<void>((resolve) => { releaseWriters = resolve; });
    const write = async (branch: SavedMatch, savedAt: number) => {
      await writerBarrier;
      return saveSnapshot(storage, branch, { expectedToken: initialWrite.snapshotToken }, savedAt);
    };
    const writes = [write(firstBranch, 2), write(secondBranch, 3)];
    releaseWriters();
    const results = await Promise.all(writes);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "conflict")).toHaveLength(1);
    const winner = results[0]?.ok ? firstBranch : secondBranch;
    expect(loadGameSnapshot(storage).savedMatch).toEqual(winner);
  });

  it("reports a conflict when an external writer replaces the primary before readback", async () => {
    const backing = new MemoryStorage();
    const initial = createLocalMatch(createInitialGame());
    const initialWrite = await saveSnapshot(backing, initial, { overwrite: true }, 1);
    if (!initialWrite.ok) throw new Error("Expected the initial save to succeed");

    const attemptedBranch = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state);
    const winnerBranch = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 2, rank: 3 },
      to: { file: 2, rank: 4 },
    }).state);
    const winnerStorage = new MemoryStorage();
    const winnerWrite = await saveSnapshot(winnerStorage, winnerBranch, { overwrite: true }, 3);
    if (!winnerWrite.ok) throw new Error("Expected the external winner save to succeed");

    const storage = new ReadbackWinnerStorage(backing, winnerWrite.snapshotToken);
    const result = await saveSnapshot(
      storage,
      attemptedBranch,
      { expectedToken: initialWrite.snapshotToken },
      2,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      resumable: false,
      warning: expect.stringMatching(/其他标签页/),
    });
    expect(result).not.toHaveProperty("snapshotToken");
    expect(storage.attemptedPrimary).not.toBe(winnerWrite.snapshotToken);
    expect(storage.getItem(GAME_SAVE_KEY)).toBe(winnerWrite.snapshotToken);
    expect(loadGameSnapshot(storage).savedMatch).toEqual(winnerBranch);
  });

  it("allows an explicit new-game overwrite after another writer advances the save", async () => {
    const storage = new MemoryStorage();
    const initial = createLocalMatch(createInitialGame());
    const initialWrite = await saveSnapshot(storage, initial, { overwrite: true }, 1);
    if (!initialWrite.ok) throw new Error("Expected the initial save to succeed");

    const advanced = createLocalMatch(dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state);
    expect(await saveSnapshot(
      storage,
      advanced,
      { expectedToken: initialWrite.snapshotToken },
      2,
    )).toMatchObject({ ok: true });

    const fresh = createLocalMatch(createInitialGame());
    expect(await saveSnapshot(storage, fresh, { overwrite: true }, 3)).toMatchObject({
      ok: true,
      resumable: true,
    });
    expect(loadGameSnapshot(storage).savedMatch).toEqual(fresh);
  });

  it("returns an empty recoverable result when both snapshots are invalid", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_SAVE_KEY, "not-json");
    storage.setItem(GAME_SAVE_BACKUP_KEY, JSON.stringify({ version: 99 }));

    const loaded = loadGameSnapshot(storage);
    expect(loaded.game).toBeNull();
    expect(loaded.source).toBe("none");
    expect(loaded.warning).toMatch(/损坏/);
  });

  it("reports memory-only mode when a write fails", async () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    const result = await saveSnapshot(
      storage,
      createLocalMatch(createInitialGame()),
      { overwrite: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the storage write to fail");
    expect(result.warning).toMatch(/内存/);
    expect(result.resumable).toBe(false);
  });

  it("uses memory-only mode instead of an unsafe compare-and-write without Web Locks", async () => {
    const storage = new MemoryStorage();
    const result = await saveGameSnapshot(
      storage,
      createLocalMatch(createInitialGame()),
      { overwrite: true },
      1,
      null,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      warning: expect.stringMatching(/跨标签页存档锁/),
    });
    expect(storage.getItem(GAME_SAVE_KEY)).toBeNull();
  });

  it("falls back to memory-only mode when reading browser storage throws", () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error("storage access denied");
      },
      setItem: () => undefined,
    };

    expect(loadGameSnapshot(storage)).toMatchObject({
      game: null,
      source: "none",
      warning: expect.stringMatching(/内存/),
    });
  });

  it("does not replace the primary save when rotating its backup fails", async () => {
    const initial = createInitialGame();
    const seeded = new MemoryStorage();
    const initialWrite = await saveSnapshot(
      seeded,
      createLocalMatch(initial),
      { overwrite: true },
      1,
    );
    expect(initialWrite).toMatchObject({ ok: true });
    if (!initialWrite.ok) throw new Error("Expected the initial save to succeed");
    const original = seeded.getItem(GAME_SAVE_KEY);
    const storage: StorageLike = {
      getItem: (key) => seeded.getItem(key),
      setItem: (key, value) => {
        if (key === GAME_SAVE_BACKUP_KEY) throw new Error("backup quota exceeded");
        seeded.setItem(key, value);
      },
    };
    const moved = dispatch(initial, {
      type: "move",
      expectedRevision: initial.revision,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state;

    expect(await saveSnapshot(
      storage,
      createLocalMatch(moved),
      { expectedToken: initialWrite.snapshotToken },
      2,
    )).toMatchObject({
      ok: false,
      resumable: false,
    });
    expect(seeded.getItem(GAME_SAVE_KEY)).toBe(original);
  });

  it("round-trips a complete computer match without rerolling its die", async () => {
    const storage = new MemoryStorage();
    const match = createComputerMatch("master", { entropy: fixedEntropy });

    expect(await saveSnapshot(storage, match, { overwrite: true }, 10)).toMatchObject({ ok: true, resumable: true });
    const loaded = loadGameSnapshot(storage);

    expect(loaded.savedMatch).toEqual(match);
    expect(loaded.savedMatch?.config).toMatchObject({
      mode: "computer",
      dieResult: 2,
      humanSide: "black",
      requestedDifficulty: "master",
      effectiveTier: "fairy-master",
    });
  });

  it("persists a Master-to-Hard fallback before any search state exists", async () => {
    const storage = new MemoryStorage();
    const master = createComputerMatch("master", { entropy: fixedEntropy });
    const fallback = setEffectiveOpponentTier(master, "lightweight-hard");

    const masterWrite = await saveSnapshot(storage, master, { overwrite: true }, 10);
    expect(masterWrite).toMatchObject({ ok: true });
    if (!masterWrite.ok) throw new Error("Expected the Master save to succeed");
    expect(await saveSnapshot(
      storage,
      fallback,
      { expectedToken: masterWrite.snapshotToken },
      11,
    )).toMatchObject({ ok: true });
    expect(loadGameSnapshot(storage).savedMatch).toEqual(fallback);
  });

  it("migrates a valid v1 primary into an explicit local match", () => {
    const storage = new MemoryStorage();
    const legacy = {
      kind: "xiangqi-game-save",
      version: 1,
      savedAt: 5,
      serialized: JSON.stringify({
        schemaVersion: 1,
        rulesetId: "popular-v1",
        initialPosition: "standard",
        commands: [],
      }),
    };
    storage.setItem(LEGACY_GAME_SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadGameSnapshot(storage);
    expect(loaded.source).toBe("primary");
    expect(loaded.migratedFrom).toBe(1);
    expect(loaded.savedMatch).toMatchObject({
      config: { mode: "local" },
      revision: 0,
      game: { revision: 0 },
    });
  });

  it("recovers a valid legacy backup", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_GAME_SAVE_KEY, "broken");
    storage.setItem(LEGACY_GAME_SAVE_BACKUP_KEY, JSON.stringify({
      kind: "xiangqi-game-save",
      version: 1,
      savedAt: 5,
      serialized: JSON.stringify({
        schemaVersion: 1,
        rulesetId: "popular-v1",
        initialPosition: "standard",
        commands: [],
      }),
    }));

    expect(loadGameSnapshot(storage)).toMatchObject({
      source: "backup",
      migratedFrom: 1,
      savedMatch: { config: { mode: "local" } },
    });
  });

  it("rejects partial AI metadata, extra fields, and revision mismatches", async () => {
    const storage = new MemoryStorage();
    const match = createComputerMatch("master", { entropy: fixedEntropy });
    expect(await saveSnapshot(storage, match, { overwrite: true }, 10)).toMatchObject({ ok: true });
    const valid = JSON.parse(storage.getItem(GAME_SAVE_KEY) ?? "{}") as MutableSaveEnvelope;

    for (const mutate of [
      (value: MutableSaveEnvelope) => { value.revision = 12; },
      (value: MutableSaveEnvelope) => { value.extra = true; },
      (value: MutableSaveEnvelope) => { delete value.match.seed; },
      (value: MutableSaveEnvelope) => { value.match.humanSide = "red"; },
      (value: MutableSaveEnvelope) => { value.match.effectiveTier = "lightweight-normal"; },
    ]) {
      const corrupted = structuredClone(valid);
      mutate(corrupted);
      storage.setItem(GAME_SAVE_KEY, JSON.stringify(corrupted));
      storage.values.delete(GAME_SAVE_BACKUP_KEY);
      expect(loadGameSnapshot(storage).savedMatch).toBeNull();
    }
  });

  it("keeps every recoverable snapshot whole when either write step fails", async () => {
    const initial = createLocalMatch(createInitialGame());
    const movedGame = dispatch(initial.game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state;
    const moved = createLocalMatch(movedGame);

    for (const failingWrite of [1, 2]) {
      const seeded = new MemoryStorage();
      const initialWrite = await saveSnapshot(seeded, initial, { overwrite: true }, 1);
      expect(initialWrite).toMatchObject({ ok: true });
      if (!initialWrite.ok) throw new Error("Expected the initial save to succeed");
      const original = seeded.getItem(GAME_SAVE_KEY);
      let writes = 0;
      const storage: StorageLike = {
        getItem: (key) => seeded.getItem(key),
        setItem: (key, value) => {
          writes += 1;
          if (writes === failingWrite) throw new Error("injected failure");
          seeded.setItem(key, value);
        },
      };

      expect(await saveSnapshot(
        storage,
        moved,
        { expectedToken: initialWrite.snapshotToken },
        2,
      )).toMatchObject({
        ok: false,
        resumable: false,
      });
      expect(seeded.getItem(GAME_SAVE_KEY)).toBe(original);
      const recovered = loadGameSnapshot(seeded).savedMatch;
      expect(recovered?.revision).toBe(0);
      expect(recovered?.config).toEqual({ mode: "local" });
    }
  });
});

describe("game settings persistence", () => {
  it("loads defaults, validates stored values, and saves all user-facing settings", () => {
    const storage = new MemoryStorage();
    expect(loadGameSettings(storage)).toEqual(DEFAULT_GAME_SETTINGS);

    const settings = {
      ...DEFAULT_GAME_SETTINGS,
      quality: "low" as const,
      masterVolume: 0.35,
      muted: true,
      reducedMotion: true,
    };
    expect(saveGameSettings(storage, settings)).toEqual({ ok: true });
    expect(loadGameSettings(storage)).toEqual(settings);
    expect(storage.getItem(GAME_SETTINGS_KEY)).not.toBeNull();

    storage.setItem(GAME_SETTINGS_KEY, JSON.stringify({ quality: "ultra", masterVolume: 8 }));
    expect(loadGameSettings(storage)).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("loads v1 settings written before per-bus volume controls", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_SETTINGS_KEY, JSON.stringify({
      version: 1,
      quality: "medium",
      masterVolume: 0.5,
      muted: false,
      reducedMotion: false,
    }));

    expect(loadGameSettings(storage)).toEqual({
      ...DEFAULT_GAME_SETTINGS,
      quality: "medium",
      masterVolume: 0.5,
    });
  });

  it("surfaces settings write failures without throwing", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(saveGameSettings(storage, DEFAULT_GAME_SETTINGS)).toMatchObject({ ok: false });
  });
});
