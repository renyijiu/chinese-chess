import {
  deserializeGame,
  serializeGame,
  type GameState,
} from "../../../lib/xiangqi/index";
import { DEFAULT_AUDIO_MIX } from "../audio/audio-types";
import type { QualityTier } from "../runtime/quality";

export const GAME_SAVE_KEY = "xiangqi3d:game:v1";
export const GAME_SAVE_BACKUP_KEY = "xiangqi3d:game:v1:backup";
export const GAME_SETTINGS_KEY = "xiangqi3d:settings:v1";

const SAVE_KIND = "xiangqi-game-save";
const SAVE_VERSION = 1;
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
  serialized: string;
}>;

export type LoadGameResult = Readonly<{
  game: GameState | null;
  source: "primary" | "backup" | "none";
  warning?: string;
}>;

export type StorageWriteResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; warning: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(raw: string): { envelope: SaveEnvelope; game: GameState } {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.kind !== SAVE_KIND ||
    value.version !== SAVE_VERSION ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    typeof value.serialized !== "string"
  ) {
    throw new Error("Unsupported local save envelope");
  }
  const envelope: SaveEnvelope = {
    kind: SAVE_KIND,
    version: SAVE_VERSION,
    savedAt: value.savedAt,
    serialized: value.serialized,
  };
  return { envelope, game: deserializeGame(envelope.serialized) };
}

function tryLoad(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    return parseEnvelope(raw).game;
  } catch {
    return null;
  }
}

export function loadGameSnapshot(storage: StorageLike): LoadGameResult {
  let primary: string | null = null;
  let backup: string | null = null;
  try {
    primary = storage.getItem(GAME_SAVE_KEY);
    backup = storage.getItem(GAME_SAVE_BACKUP_KEY);
  } catch {
    return {
      game: null,
      source: "none",
      warning: "浏览器存储不可用，本局将只保存在内存中。",
    };
  }

  const primaryGame = tryLoad(primary);
  if (primaryGame) return { game: primaryGame, source: "primary" };

  const backupGame = tryLoad(backup);
  if (backupGame) {
    return {
      game: backupGame,
      source: "backup",
      warning: "主存档损坏，已恢复最后一次有效备份。",
    };
  }

  if (primary || backup) {
    return {
      game: null,
      source: "none",
      warning: "本地存档已损坏，开始新局前不会覆盖原数据。",
    };
  }
  return { game: null, source: "none" };
}

export function saveGameSnapshot(
  storage: StorageLike,
  game: GameState,
  savedAt = Date.now(),
): StorageWriteResult {
  try {
    const current = storage.getItem(GAME_SAVE_KEY);
    if (current && tryLoad(current)) {
      storage.setItem(GAME_SAVE_BACKUP_KEY, current);
    }
    const envelope: SaveEnvelope = {
      kind: SAVE_KIND,
      version: SAVE_VERSION,
      savedAt,
      serialized: serializeGame(game),
    };
    storage.setItem(GAME_SAVE_KEY, JSON.stringify(envelope));
    return { ok: true };
  } catch {
    return {
      ok: false,
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
    if (musicVolume === null || ambientVolume === null || voiceVolume === null || sfxVolume === null || uiVolume === null) {
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

export function saveGameSettings(
  storage: StorageLike,
  settings: GameSettings,
): StorageWriteResult {
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
