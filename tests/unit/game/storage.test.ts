import { describe, expect, it } from "vitest";

import { createInitialGame, dispatch } from "../../../lib/xiangqi/index";
import {
  DEFAULT_GAME_SETTINGS,
  GAME_SAVE_BACKUP_KEY,
  GAME_SAVE_KEY,
  GAME_SETTINGS_KEY,
  loadGameSnapshot,
  loadGameSettings,
  saveGameSettings,
  saveGameSnapshot,
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

describe("local game persistence", () => {
  it("round-trips a versioned primary snapshot", () => {
    const storage = new MemoryStorage();
    const game = createInitialGame();

    expect(saveGameSnapshot(storage, game, 1_700_000_000_000)).toEqual({ ok: true });
    const loaded = loadGameSnapshot(storage);

    expect(loaded.source).toBe("primary");
    expect(loaded.game?.revision).toBe(0);
    expect(JSON.parse(storage.getItem(GAME_SAVE_KEY) ?? "{}")).toMatchObject({
      kind: "xiangqi-game-save",
      version: 1,
      savedAt: 1_700_000_000_000,
    });
  });

  it("keeps the last valid primary as backup and restores it when the new primary is corrupt", () => {
    const storage = new MemoryStorage();
    const initial = createInitialGame();
    expect(saveGameSnapshot(storage, initial, 1)).toEqual({ ok: true });

    const moved = dispatch(initial, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    }).state;
    expect(saveGameSnapshot(storage, moved, 2)).toEqual({ ok: true });
    expect(storage.getItem(GAME_SAVE_BACKUP_KEY)).not.toBeNull();

    storage.setItem(GAME_SAVE_KEY, "{broken");
    const loaded = loadGameSnapshot(storage);
    expect(loaded.source).toBe("backup");
    expect(loaded.game?.revision).toBe(0);
    expect(loaded.warning).toMatch(/备份/);
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

  it("reports memory-only mode when a write fails", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    const result = saveGameSnapshot(storage, createInitialGame());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the storage write to fail");
    expect(result.warning).toMatch(/内存/);
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

  it("does not replace the primary save when rotating its backup fails", () => {
    const initial = createInitialGame();
    const seeded = new MemoryStorage();
    expect(saveGameSnapshot(seeded, initial, 1)).toEqual({ ok: true });
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

    expect(saveGameSnapshot(storage, moved, 2)).toMatchObject({ ok: false });
    expect(seeded.getItem(GAME_SAVE_KEY)).toBe(original);
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
