import type { AudioBus } from "./audio-types";

export const QIN_AUDIO_PACK_SCHEMA = "xiangqi-audio-pack/v1" as const;
export const QIN_AUDIO_PACK_VERSION = 1 as const;
export const QIN_AUDIO_PACK_ID = "qin-diorama" as const;
export const QIN_AUDIO_MANIFEST_URL = "/audio/qin-diorama/v1/manifest.json" as const;

export const QIN_AUDIO_ASSET_IDS = [
  "music.qin-procession",
  "accent.capture-clay",
  "system.check",
  "system.victory",
  "system.defeat",
  "system.draw",
] as const;

export const QIN_SYNTH_FALLBACK_IDS = [
  "music.fortress",
  "system.capture",
  "system.check",
  "system.victory",
  "system.defeat",
  "system.draw",
] as const;

export const QIN_AUDIO_ALLOWED_BUSES = ["music", "sfx"] as const satisfies readonly AudioBus[];

export const AUDIO_PACK_BUDGETS = Object.freeze({
  criticalBytes: Math.floor(1.5 * 1024 * 1024),
  runtimeBytes: 8 * 1024 * 1024,
  authoredDecodedBytes: 30 * 1024 * 1024,
});

export type QinAudioAssetId = (typeof QIN_AUDIO_ASSET_IDS)[number];
export type QinSynthFallbackId = (typeof QIN_SYNTH_FALLBACK_IDS)[number];
export type QinAudioBus = (typeof QIN_AUDIO_ALLOWED_BUSES)[number];

export type QinAudioSourceRecordV1 = {
  id: string;
  author: string;
  authorization: string;
  sourcePaths: string[];
  claimBoundary: string;
};

export type QinAudioAssetV1 = {
  id: QinAudioAssetId;
  order: number;
  kind: "background" | "transient";
  group: "critical" | "deferred";
  url: string;
  mimeType: "audio/mpeg" | "audio/wav";
  codec: "mp3" | "pcm_s16le";
  bytes: number;
  sha256: string;
  durationSeconds: number;
  channels: number;
  sampleRate: number;
  sampleFrames: number;
  loop?: {
    startSeconds: number;
    endSeconds: number;
  };
  bus: QinAudioBus;
  synthFallbackId: QinSynthFallbackId;
  sourceRecordId: string;
};

export type QinAudioPackManifestV1 = {
  schema: typeof QIN_AUDIO_PACK_SCHEMA;
  version: typeof QIN_AUDIO_PACK_VERSION;
  packId: typeof QIN_AUDIO_PACK_ID;
  claimBoundary: string;
  loadOrder: QinAudioAssetId[];
  assets: QinAudioAssetV1[];
  sourceRecords: QinAudioSourceRecordV1[];
};
