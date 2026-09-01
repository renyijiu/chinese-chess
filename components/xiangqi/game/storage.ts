import { deserializeGame, serializeGame, type GameState } from "../../../lib/xiangqi/index";
import { DEFAULT_AUDIO_MIX } from "../audio/audio-types";
import type { QualityTier } from "../runtime/quality";
import { createLocalMatch, parseMatchConfig, type MatchConfig, type SavedMatch } from "./match";

export const GAME_SAVE_KEY = "xiangqi3d:game:v3";
export const GAME_SAVE_BACKUP_KEY = "xiangqi3d:game:v3:backup";
export const GAME_SAVE_V2_KEY = "xiangqi3d:game:v2";
export const GAME_SAVE_V2_BACKUP_KEY = "xiangqi3d:game:v2:backup";
export const LEGACY_GAME_SAVE_KEY = "xiangqi3d:game:v1";
export const LEGACY_GAME_SAVE_BACKUP_KEY = "xiangqi3d:game:v1:backup";
export const GAME_SETTINGS_KEY = "xiangqi3d:settings:v1";

const SAVE_KIND = "xiangqi-game-save";
const SAVE_VERSION = 3;
const PREVIOUS_SAVE_VERSION = 2;
const LEGACY_SAVE_VERSION = 1;
const SETTINGS_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type GameSettings = Readonly<{
  quality: QualityTier;
  masterVolume: number;
  musicVolume: number;
  ambientVolume: number;
  voiceVolume: number;
  sfxVolume: number;
  uiVolume: number;
  muted: boolean;
  reducedMotion: boolean;
}>;

export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({
  quality: "high",
  masterVolume: DEFAULT_AUDIO_MIX.master,
  musicVolume: DEFAULT_AUDIO_MIX.music,
  ambientVolume: DEFAULT_AUDIO_MIX.ambient,
  voiceVolume: DEFAULT_AUDIO_MIX.voice,
  sfxVolume: DEFAULT_AUDIO_MIX.sfx,
  uiVolume: DEFAULT_AUDIO_MIX.ui,
  muted: false,
  reducedMotion: false,
});

type SaveEnvelope = Readonly<{
  kind: typeof SAVE_KIND;
  version: typeof SAVE_VERSION;
  savedAt: number;
  revision: number;
  serialized: string;
  match: MatchConfig;
}>;

export type LoadGameResult = Readonly<{
  savedMatch: SavedMatch | null;
  /** Temporary compatibility alias for the pre-v2 local-game controller. */
  game: GameState | null;
  source: "primary" | "backup" | "none";
  resumeKind: "direct" | "reconnect" | "none";
  migratedFrom?: 1 | 2;
  warning?: string;
}>;

export type StorageWriteResult = Readonly<{ ok: true }> | Readonly<{ ok: false; warning: string }>;

export type GameStorageWriteResult =
  | Readonly<{ ok: true; resumable: true }>
  | Readonly<{ ok: false; resumable: false; warning: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isStoredRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseVersionedEnvelope(raw: string, version: 2 | 3): SavedMatch {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "version", "savedAt", "revision", "serialized", "match"]) ||
    value.kind !== SAVE_KIND ||
    value.version !== version ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    !isStoredRevision(value.revision) ||
    typeof value.serialized !== "string"
  ) {
    throw new Error("Unsupported local save envelope");
  }
  const game = deserializeGame(value.serialized);
  if (game.revision !== value.revision) {
    throw new Error("Stored and replayed revisions do not match");
  }
  const match = parseMatchConfig(value.match);
  if (version === PREVIOUS_SAVE_VERSION && match.mode === "online") {
    throw new Error("Online matches require a v3 save envelope");
  }
  return { config: match, game, revision: value.revision };
}

function parseLegacyEnvelope(raw: string): SavedMatch {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "version", "savedAt", "serialized"]) ||
    value.kind !== SAVE_KIND ||
    value.version !== LEGACY_SAVE_VERSION ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    typeof value.serialized !== "string"
  ) {
    throw new Error("Unsupported legacy local save envelope");
  }
  return createLocalMatch(deserializeGame(value.serialized));
}

function tryLoad(raw: string | null, version: 2 | 3 = SAVE_VERSION): SavedMatch | null {
  if (!raw) return null;
  try {
    return parseVersionedEnvelope(raw, version);
  } catch {
    return null;
  }
}

function tryLoadLegacy(raw: string | null): SavedMatch | null {
  if (!raw) return null;
  try {
    return parseLegacyEnvelope(raw);
  } catch {
    return null;
  }
}

function loadedResult(
  savedMatch: SavedMatch,
  source: "primary" | "backup",
  options: Readonly<{ migratedFrom?: 1 | 2; warning?: string }> = {},
): LoadGameResult {
  return {
    savedMatch,
    game: savedMatch.game,
    source,
    resumeKind: savedMatch.config.mode === "online" ? "reconnect" : "direct",
    ...options,
  };
}

export function loadGameSnapshot(storage: StorageLike): LoadGameResult {
  let primary: string | null = null;
  let backup: string | null = null;
  let v2Primary: string | null = null;
  let v2Backup: string | null = null;
  let legacyPrimary: string | null = null;
  let legacyBackup: string | null = null;
  try {
    primary = storage.getItem(GAME_SAVE_KEY);
    backup = storage.getItem(GAME_SAVE_BACKUP_KEY);
    v2Primary = storage.getItem(GAME_SAVE_V2_KEY);
    v2Backup = storage.getItem(GAME_SAVE_V2_BACKUP_KEY);
    legacyPrimary = storage.getItem(LEGACY_GAME_SAVE_KEY);
    legacyBackup = storage.getItem(LEGACY_GAME_SAVE_BACKUP_KEY);
  } catch {
    return {
      savedMatch: null,
      game: null,
      source: "none",
      resumeKind: "none",
      warning: "浏览器存储不可用，本局将只保存在内存中。",
    };
  }

  const primaryMatch = tryLoad(primary);
  if (primaryMatch) return loadedResult(primaryMatch, "primary");

  const backupMatch = tryLoad(backup);
  if (backupMatch) {
    return loadedResult(backupMatch, "backup", {
      warning: "主存档损坏，已恢复最后一次有效备份。",
    });
  }

  const v2PrimaryMatch = tryLoad(v2Primary, PREVIOUS_SAVE_VERSION);
  if (v2PrimaryMatch) {
    return loadedResult(v2PrimaryMatch, "primary", {
      migratedFrom: 2,
      warning: "旧版对局存档已安全迁移。",
    });
  }

  const v2BackupMatch = tryLoad(v2Backup, PREVIOUS_SAVE_VERSION);
  if (v2BackupMatch) {
    return loadedResult(v2BackupMatch, "backup", {
      migratedFrom: 2,
      warning: "旧版主存档损坏，已迁移最后一次有效备份。",
    });
  }

  const legacyPrimaryMatch = tryLoadLegacy(legacyPrimary);
  if (legacyPrimaryMatch) {
    return loadedResult(legacyPrimaryMatch, "primary", {
      migratedFrom: 1,
      warning: "旧版本地双人存档已安全迁移。",
    });
  }

  const legacyBackupMatch = tryLoadLegacy(legacyBackup);
  if (legacyBackupMatch) {
    return loadedResult(legacyBackupMatch, "backup", {
      migratedFrom: 1,
      warning: "旧版主存档损坏，已迁移最后一次有效备份。",
    });
  }

  if (primary || backup || v2Primary || v2Backup || legacyPrimary || legacyBackup) {
    return {
      savedMatch: null,
      game: null,
      source: "none",
      resumeKind: "none",
      warning: "本地存档已损坏，开始新局前不会覆盖原数据。",
    };
  }
  return { savedMatch: null, game: null, source: "none", resumeKind: "none" };
}

function isSavedMatch(value: SavedMatch | GameState): value is SavedMatch {
  return "config" in value && "game" in value;
}

function normalizeSavedMatch(value: SavedMatch | GameState): Readonly<{
  savedMatch: SavedMatch;
  serialized: string;
}> {
  const savedMatch = isSavedMatch(value) ? value : createLocalMatch(value);
  const config = parseMatchConfig(savedMatch.config);
  if (!isStoredRevision(savedMatch.revision) || savedMatch.revision !== savedMatch.game.revision) {
    throw new Error("Saved match revision does not match its game state");
  }
  const serialized = serializeGame(savedMatch.game);
  const replayed = deserializeGame(serialized);
  if (replayed.revision !== savedMatch.revision) {
    throw new Error("Saved match replay does not produce its stored revision");
  }
  return {
    savedMatch: { config, game: savedMatch.game, revision: savedMatch.revision },
    serialized,
  };
}

export function saveGameSnapshot(
  storage: StorageLike,
  value: SavedMatch | GameState,
  savedAt = Date.now(),
): GameStorageWriteResult {
  try {
    if (!Number.isFinite(savedAt)) throw new Error("Save timestamp must be finite");
    const { savedMatch, serialized } = normalizeSavedMatch(value);
    const current = storage.getItem(GAME_SAVE_KEY);
    if (current && tryLoad(current)) {
      storage.setItem(GAME_SAVE_BACKUP_KEY, current);
    }
    const envelope: SaveEnvelope = {
      kind: SAVE_KIND,
      version: SAVE_VERSION,
      savedAt,
      revision: savedMatch.revision,
      serialized,
      match: savedMatch.config,
    };
    storage.setItem(GAME_SAVE_KEY, JSON.stringify(envelope));
    return { ok: true, resumable: true };
  } catch {
    return {
      ok: false,
      resumable: false,
      warning: "无法写入浏览器存储，本局将只保存在内存中。",
    };
  }
}

function isQualityTier(value: unknown): value is QualityTier {
  return value === "high" || value === "medium" || value === "low";
}

function isVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function optionalVolume(value: unknown, fallback: number) {
  return value === undefined ? fallback : isVolume(value) ? value : null;
}

export function loadGameSettings(storage: StorageLike): GameSettings {
  try {
    const raw = storage.getItem(GAME_SETTINGS_KEY);
    if (!raw) return DEFAULT_GAME_SETTINGS;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== SETTINGS_VERSION ||
      !isQualityTier(value.quality) ||
      !isVolume(value.masterVolume) ||
      typeof value.muted !== "boolean" ||
      typeof value.reducedMotion !== "boolean"
    ) {
      return DEFAULT_GAME_SETTINGS;
    }
    const musicVolume = optionalVolume(value.musicVolume, DEFAULT_GAME_SETTINGS.musicVolume);
    const ambientVolume = optionalVolume(value.ambientVolume, DEFAULT_GAME_SETTINGS.ambientVolume);
    const voiceVolume = optionalVolume(value.voiceVolume, DEFAULT_GAME_SETTINGS.voiceVolume);
    const sfxVolume = optionalVolume(value.sfxVolume, DEFAULT_GAME_SETTINGS.sfxVolume);
    const uiVolume = optionalVolume(value.uiVolume, DEFAULT_GAME_SETTINGS.uiVolume);
    if (
      musicVolume === null ||
      ambientVolume === null ||
      voiceVolume === null ||
      sfxVolume === null ||
      uiVolume === null
    ) {
      return DEFAULT_GAME_SETTINGS;
    }
    return {
      quality: value.quality,
      masterVolume: value.masterVolume,
      musicVolume,
      ambientVolume,
      voiceVolume,
      sfxVolume,
      uiVolume,
      muted: value.muted,
      reducedMotion: value.reducedMotion,
    };
  } catch {
    return DEFAULT_GAME_SETTINGS;
  }
}

export function saveGameSettings(storage: StorageLike, settings: GameSettings): StorageWriteResult {
  try {
    storage.setItem(GAME_SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...settings }));
    return { ok: true };
  } catch {
    return {
      ok: false,
      warning: "设置无法写入浏览器存储，本次调整仅在当前页面有效。",
    };
  }
}
