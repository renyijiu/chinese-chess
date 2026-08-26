import {
  QIN_AUDIO_ASSET_IDS,
  QIN_AUDIO_PACK_ID,
  QIN_AUDIO_PACK_SCHEMA,
  QIN_AUDIO_PACK_VERSION,
  type QinAudioAssetId,
  type QinAudioAssetV1,
  type QinAudioPackManifestV1,
} from "./qin-audio-pack-contract";
import type { AudioTransientCueId } from "./audio-types";

export const ENGINE_DECODED_BUDGET_BYTES = 40 * 1024 * 1024;

export const AUTHORED_ASSET_BY_TRANSIENT = Object.freeze({
  "system.capture": "accent.capture-clay",
  "system.check": "system.check",
  "system.victory": "system.victory",
  "system.defeat": "system.defeat",
  "system.draw": "system.draw",
} satisfies Readonly<Record<AudioTransientCueId, QinAudioAssetId>>);

const EXPECTED_ASSETS = Object.freeze({
  "music.qin-procession": {
    bus: "music",
    codec: "mp3",
    group: "critical",
    kind: "background",
    mimeType: "audio/mpeg",
    synthFallbackId: "music.fortress",
  },
  "accent.capture-clay": {
    bus: "sfx",
    codec: "pcm_s16le",
    group: "deferred",
    kind: "transient",
    mimeType: "audio/wav",
    synthFallbackId: "system.capture",
  },
  "system.check": {
    bus: "sfx",
    codec: "pcm_s16le",
    group: "deferred",
    kind: "transient",
    mimeType: "audio/wav",
    synthFallbackId: "system.check",
  },
  "system.victory": {
    bus: "sfx",
    codec: "pcm_s16le",
    group: "deferred",
    kind: "transient",
    mimeType: "audio/wav",
    synthFallbackId: "system.victory",
  },
  "system.defeat": {
    bus: "sfx",
    codec: "pcm_s16le",
    group: "deferred",
    kind: "transient",
    mimeType: "audio/wav",
    synthFallbackId: "system.defeat",
  },
  "system.draw": {
    bus: "sfx",
    codec: "pcm_s16le",
    group: "deferred",
    kind: "transient",
    mimeType: "audio/wav",
    synthFallbackId: "system.draw",
  },
} as const satisfies Readonly<Record<QinAudioAssetId, Partial<QinAudioAssetV1>>>);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Audio pack manifest must be an object");
  return value as Record<string, unknown>;
}

function positiveFinite(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function positiveInteger(value: unknown, label: string) {
  const number = positiveFinite(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}

function validateAsset(value: unknown, expectedId: QinAudioAssetId, order: number): QinAudioAssetV1 {
  const asset = record(value);
  const expected = EXPECTED_ASSETS[expectedId];
  if (asset.id !== expectedId) throw new Error(`Audio pack asset ${order} must be ${expectedId}`);
  if (asset.order !== order) throw new Error(`${expectedId} has invalid order`);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (asset[field] !== expectedValue) throw new Error(`${expectedId} has invalid ${field}`);
  }
  if (typeof asset.url !== "string" || !asset.url.startsWith("/audio/qin-diorama/v1/") || asset.url.includes("..")) {
    throw new Error(`${expectedId} has invalid versioned URL`);
  }
  positiveInteger(asset.bytes, `${expectedId} bytes`);
  positiveFinite(asset.durationSeconds, `${expectedId} duration`);
  positiveInteger(asset.channels, `${expectedId} channels`);
  positiveInteger(asset.sampleRate, `${expectedId} sample rate`);
  positiveInteger(asset.sampleFrames, `${expectedId} sample frames`);
  if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`${expectedId} has invalid SHA-256`);
  if (typeof asset.sourceRecordId !== "string" || !asset.sourceRecordId) throw new Error(`${expectedId} has no source record`);

  if (expected.kind === "background") {
    if (asset.loop === undefined) throw new Error(`${expectedId} has no loop range`);
    const loop = record(asset.loop);
    const startSeconds = positiveFinite(loop.startSeconds, `${expectedId} loop start`);
    const endSeconds = positiveFinite(loop.endSeconds, `${expectedId} loop end`);
    if (startSeconds >= endSeconds || endSeconds > (asset.durationSeconds as number)) throw new Error(`${expectedId} has invalid loop range`);
  } else if (asset.loop !== undefined) {
    throw new Error(`${expectedId} transient cannot define a loop`);
  }
  return asset as unknown as QinAudioAssetV1;
}

export function validateQinAudioPackManifest(value: unknown): QinAudioPackManifestV1 {
  const manifest = record(value);
  if (manifest.schema !== QIN_AUDIO_PACK_SCHEMA) throw new Error("Unsupported audio pack schema");
  if (manifest.version !== QIN_AUDIO_PACK_VERSION) throw new Error("Unsupported audio pack version");
  if (manifest.packId !== QIN_AUDIO_PACK_ID) throw new Error("Unexpected audio pack id");
  const loadOrder = manifest.loadOrder;
  if (!Array.isArray(loadOrder) || loadOrder.length !== QIN_AUDIO_ASSET_IDS.length) {
    throw new Error("Audio pack load order is incomplete");
  }
  QIN_AUDIO_ASSET_IDS.forEach((id, order) => {
    if (loadOrder[order] !== id) throw new Error(`Audio pack load order must place ${id} at ${order}`);
  });
  const manifestAssets = manifest.assets;
  if (!Array.isArray(manifestAssets) || manifestAssets.length !== QIN_AUDIO_ASSET_IDS.length) {
    throw new Error("Audio pack assets are incomplete");
  }
  const assets = QIN_AUDIO_ASSET_IDS.map((id, order) => validateAsset(manifestAssets[order], id, order));
  const urls = new Set(assets.map((asset) => asset.url));
  if (urls.size !== assets.length) throw new Error("Audio pack URLs must be unique");
  if (!Array.isArray(manifest.sourceRecords) || manifest.sourceRecords.length === 0) throw new Error("Audio pack source records are missing");
  return { ...manifest, assets } as unknown as QinAudioPackManifestV1;
}

export function resolveQinAudioPublicUrl(path: string, baseUrl: string) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${path.replace(/^\//, "")}`;
}

export function decodedAudioBytes(buffer: Pick<AudioBuffer, "length" | "numberOfChannels">) {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}
