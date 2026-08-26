#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const AUDIO_PACK_BUDGETS = Object.freeze({
  criticalBytes: Math.floor(1.5 * 1024 * 1024),
  runtimeBytes: 8 * 1024 * 1024,
  authoredDecodedBytes: 30 * 1024 * 1024,
});

const EXPECTED_ASSETS = Object.freeze([
  ["music.qin-procession", "music.fortress"],
  ["accent.capture-clay", "system.capture"],
  ["system.check", "system.check"],
  ["system.victory", "system.victory"],
  ["system.defeat", "system.defeat"],
  ["system.draw", "system.draw"],
]);
const EXPECTED_IDS = EXPECTED_ASSETS.map(([id]) => id);
const ALLOWED_BUSES = new Set(["music", "sfx"]);
const LOSSLESS_SOURCE_EXTENSIONS = new Set([".aif", ".aiff", ".flac", ".wav"]);
const CLAIM_BOUNDARY = /qin-inspired.+not (?:a )?historical\s+reconstruction/is;

function fail(message) {
  throw new Error(message);
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`Missing ${label}: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function positiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a positive finite number`);
  }
  return value;
}

function positiveInteger(value, label) {
  positiveNumber(value, label);
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function validateClaimBoundary(value, label) {
  if (typeof value !== "string" || !CLAIM_BOUNDARY.test(value)) {
    fail(`${label} must state Qin-inspired visual fantasy and not historical reconstruction`);
  }
}

function runtimePath(rootDir, url) {
  if (typeof url !== "string" || !url.startsWith("/audio/qin-diorama/v1/")) {
    fail(`Runtime URL must stay under /audio/qin-diorama/v1/: ${url}`);
  }
  return resolve(rootDir, "public", url.slice(1));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function defaultProbeAudio(path) {
  let result;
  try {
    result = JSON.parse(execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_name,sample_rate,channels,duration:format=duration",
      "-of", "json",
      path,
    ], { encoding: "utf8" }));
  } catch (error) {
    fail(`ffprobe could not inspect ${path}: ${error.message}`);
  }
  const stream = result.streams?.[0];
  if (!stream) fail(`ffprobe found no audio stream in ${path}`);
  const durationSeconds = Number(stream.duration ?? result.format?.duration);
  return {
    channels: Number(stream.channels),
    codec: stream.codec_name,
    durationSeconds,
    sampleRate: Number(stream.sample_rate),
  };
}

function validateSourceRecords(manifest, rootDir, ledgerPath) {
  if (!Array.isArray(manifest.sourceRecords)) fail("Manifest sourceRecords must be an array");
  const records = new Map();
  for (const record of manifest.sourceRecords) {
    const id = typeof record?.id === "string" ? record.id : "<missing>";
    if (records.has(id)) fail(`Duplicate source record id ${id}`);
    if (!record?.author?.trim()) fail(`${id} source record is missing author`);
    if (!record?.authorization?.trim()) fail(`${id} source record is missing authorization`);
    if (!Array.isArray(record?.sourcePaths) || record.sourcePaths.length === 0) {
      fail(`${id} source record is missing a source path`);
    }
    validateClaimBoundary(record.claimBoundary, `${id} claim boundary`);
    let hasLosslessSource = false;
    for (const sourcePath of record.sourcePaths) {
      if (typeof sourcePath !== "string" || sourcePath.startsWith("/") || sourcePath.includes("..")) {
        fail(`${id} has an invalid source path ${sourcePath}`);
      }
      const absolutePath = resolve(rootDir, sourcePath);
      if (!existsSync(absolutePath)) fail(`${id} source path does not exist: ${sourcePath}`);
      if (LOSSLESS_SOURCE_EXTENSIONS.has(extname(sourcePath).toLowerCase())) hasLosslessSource = true;
    }
    if (!hasLosslessSource) fail(`${id} must include an editable or lossless source path`);
    records.set(id, record);
  }
  if (!existsSync(ledgerPath)) fail(`Missing audio source ledger: ${ledgerPath}`);
  const ledger = readFileSync(ledgerPath, "utf8");
  validateClaimBoundary(ledger, "Audio source ledger claim boundary");
  for (const id of records.keys()) {
    if (!ledger.includes(id)) fail(`Audio source ledger is missing ${id}`);
  }
  return records;
}

function validateManifestHeader(manifest) {
  if (manifest?.schema !== "xiangqi-audio-pack/v1") fail("Manifest schema must be xiangqi-audio-pack/v1");
  if (manifest?.version !== 1) fail("Manifest version must be 1");
  if (manifest?.packId !== "qin-diorama") fail("Manifest packId must be qin-diorama");
  validateClaimBoundary(manifest.claimBoundary, "Manifest claim boundary");
  if (!Array.isArray(manifest.loadOrder) || JSON.stringify(manifest.loadOrder) !== JSON.stringify(EXPECTED_IDS)) {
    fail(`Manifest loadOrder must be ${EXPECTED_IDS.join(", ")}`);
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== EXPECTED_IDS.length) {
    fail(`Manifest must contain exactly ${EXPECTED_IDS.length} assets`);
  }
}

function validateAssetShape(asset, expected, order) {
  const [expectedId, expectedFallback] = expected;
  const label = asset?.id ?? `asset at order ${order}`;
  if (asset?.id !== expectedId) fail(`Asset order ${order} must be ${expectedId}, got ${label}`);
  if (asset?.order !== order) fail(`${label} must declare order ${order}`);
  if (!asset?.synthFallbackId) fail(`${label} is missing synth fallback ID`);
  if (asset.synthFallbackId !== expectedFallback) {
    fail(`${label} synth fallback must be ${expectedFallback}, got ${asset.synthFallbackId}`);
  }
  if (!ALLOWED_BUSES.has(asset?.bus)) fail(`${label} has unknown bus ${asset?.bus}`);
  positiveInteger(asset.bytes, `${label} bytes`);
  positiveInteger(asset.sampleFrames, `${label} sampleFrames`);
  positiveInteger(asset.channels, `${label} channels`);
  positiveInteger(asset.sampleRate, `${label} sampleRate`);
  positiveNumber(asset.durationSeconds, `${label} durationSeconds`);
  if (asset.sampleFrames !== Math.round(asset.durationSeconds * asset.sampleRate)) {
    fail(`${label} sampleFrames must equal rounded durationSeconds × sampleRate`);
  }
  if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    fail(`${label} must declare a lowercase SHA-256 digest`);
  }
  if (!asset?.sourceRecordId) fail(`${label} is missing sourceRecordId`);

  const filename = asset.url?.split("/").at(-1) ?? "";
  if (!/-v1\.(?:mp3|wav)$/.test(filename)) fail(`${label} runtime filename must be versioned with -v1`);
  if (asset.kind === "background") {
    if (asset.group !== "critical" || asset.bus !== "music" || asset.mimeType !== "audio/mpeg" || asset.codec !== "mp3") {
      fail(`${label} must be a critical audio/mpeg MP3 on the music bus`);
    }
    if (asset.durationSeconds !== 72) fail(`${label} must declare the 72-second authored duration`);
    if (asset.channels !== 2 || asset.sampleRate !== 48_000) {
      fail(`${label} must be stereo at 48 kHz`);
    }
    const start = asset.loop?.startSeconds;
    const end = asset.loop?.endSeconds;
    if (!(start > 0 && end > start && end < asset.durationSeconds)) {
      fail(`${label} has an invalid non-default loop range`);
    }
  } else if (asset.kind === "transient") {
    if (asset.loop !== undefined) fail(`${label} transient must not declare a loop range`);
    if (asset.group !== "deferred" || asset.bus !== "sfx" || asset.mimeType !== "audio/wav" || asset.codec !== "pcm_s16le") {
      fail(`${label} must be a deferred audio/wav PCM16 transient on the sfx bus`);
    }
    if (asset.channels !== 1 || asset.sampleRate !== 48_000) {
      fail(`${label} must be mono at 48 kHz`);
    }
  } else {
    fail(`${label} has unknown kind ${asset.kind}`);
  }

  const maximumDuration = expectedId === "accent.capture-clay"
    ? 0.5
    : expectedId === "system.check"
      ? 0.9
      : expectedId.startsWith("system.")
        ? 2.5
        : null;
  if (maximumDuration !== null && !(asset.durationSeconds < maximumDuration)) {
    fail(`${label} duration must be shorter than ${maximumDuration} seconds`);
  }
}

function validateBudgets(manifest, manifestBytes, budgets) {
  const uniqueUrls = new Set();
  let criticalBytes = manifestBytes;
  let runtimeBytes = manifestBytes;
  let decodedBytes = 0;
  const decodedAssets = [];
  const runtimeFiles = [];
  for (const asset of manifest.assets) {
    if (uniqueUrls.has(asset.url)) fail(`Duplicate runtime URL ${asset.url}`);
    uniqueUrls.add(asset.url);
    runtimeBytes += positiveInteger(asset.bytes, `${asset.id} bytes`);
    if (asset.group === "critical") criticalBytes += asset.bytes;
    const decoded = positiveInteger(asset.channels, `${asset.id} channels`)
      * positiveInteger(asset.sampleFrames, `${asset.id} sampleFrames`) * 4;
    decodedBytes += decoded;
    decodedAssets.push({ bytes: decoded, id: asset.id });
    runtimeFiles.push({ bytes: asset.bytes, mimeType: asset.mimeType, url: asset.url });
  }
  if (criticalBytes > budgets.criticalBytes) {
    fail(`Critical package budget exceeded: ${criticalBytes} > ${budgets.criticalBytes}`);
  }
  if (runtimeBytes > budgets.runtimeBytes) {
    fail(`Runtime package budget exceeded: ${runtimeBytes} > ${budgets.runtimeBytes}`);
  }
  if (decodedBytes > budgets.authoredDecodedBytes) {
    fail(`Authored decoded budget exceeded: ${decodedBytes} > ${budgets.authoredDecodedBytes}`);
  }
  return { criticalBytes, decodedAssets, decodedBytes, runtimeBytes, runtimeFiles };
}

export async function validateAudioPackage(options = {}) {
  const rootDir = resolve(options.rootDir ?? SCRIPT_ROOT);
  const manifestPath = resolve(options.manifestPath ?? resolve(rootDir, "public/audio/qin-diorama/v1/manifest.json"));
  const ledgerPath = resolve(options.ledgerPath ?? resolve(rootDir, "assets/audio/qin-diorama/v1/SOURCES.md"));
  const probeAudio = options.probeAudio ?? defaultProbeAudio;
  const budgets = options.budgets ?? AUDIO_PACK_BUDGETS;
  const manifest = options.manifest ?? readJson(manifestPath, "Qin audio manifest");
  const manifestBytes = existsSync(manifestPath) ? statSync(manifestPath).size : Buffer.byteLength(JSON.stringify(manifest));

  validateManifestHeader(manifest);
  const ids = new Set();
  for (const [order, expected] of EXPECTED_ASSETS.entries()) {
    const asset = manifest.assets[order];
    if (ids.has(asset?.id)) fail(`Duplicate asset id ${asset.id}`);
    ids.add(asset?.id);
    validateAssetShape(asset, expected, order);
  }
  const budgetReport = validateBudgets(manifest, manifestBytes, budgets);
  const sourceRecords = validateSourceRecords(manifest, rootDir, ledgerPath);

  for (const asset of manifest.assets) {
    if (!sourceRecords.has(asset.sourceRecordId)) {
      fail(`${asset.id} refers to missing source record ${asset.sourceRecordId}`);
    }
    const path = runtimePath(rootDir, asset.url);
    if (!existsSync(path)) fail(`${asset.id} runtime file does not exist: ${asset.url}`);
    const actualBytes = statSync(path).size;
    if (actualBytes !== asset.bytes) fail(`${asset.id} byte count differs: manifest ${asset.bytes}, disk ${actualBytes}`);
    const actualHash = sha256(path);
    if (actualHash !== asset.sha256) fail(`${asset.id} SHA-256 differs: manifest ${asset.sha256}, disk ${actualHash}`);
    const probe = await probeAudio(path);
    if (probe.codec !== asset.codec) fail(`${asset.id} codec differs: manifest ${asset.codec}, media ${probe.codec}`);
    if (probe.channels !== asset.channels) fail(`${asset.id} channels differ: manifest ${asset.channels}, media ${probe.channels}`);
    if (probe.sampleRate !== asset.sampleRate) fail(`${asset.id} sample rate differs: manifest ${asset.sampleRate}, media ${probe.sampleRate}`);
    if (!Number.isFinite(probe.durationSeconds) || Math.abs(probe.durationSeconds - asset.durationSeconds) > 0.05) {
      fail(`${asset.id} duration differs: manifest ${asset.durationSeconds}, media ${probe.durationSeconds}`);
    }
  }

  return {
    assetCount: manifest.assets.length,
    manifestBytes,
    ...budgetReport,
  };
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function main() {
  const report = await validateAudioPackage();
  console.log("Qin audio asset validation passed.");
  console.log(`Assets: ${report.assetCount}`);
  console.log(`Critical transfer: ${report.criticalBytes} bytes (${formatMiB(report.criticalBytes)})`);
  console.log(`Runtime transfer: ${report.runtimeBytes} bytes (${formatMiB(report.runtimeBytes)})`);
  console.log(`Runtime /audio/qin-diorama/v1/manifest.json: ${report.manifestBytes} bytes (application/json)`);
  for (const file of report.runtimeFiles) {
    console.log(`Runtime ${file.url}: ${file.bytes} bytes (${file.mimeType})`);
  }
  for (const asset of report.decodedAssets) {
    console.log(`Decoded ${asset.id}: ${asset.bytes} bytes (${formatMiB(asset.bytes)})`);
  }
  console.log(`Authored decoded total: ${report.decodedBytes} bytes (${formatMiB(report.decodedBytes)})`);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(`AUDIO ASSET VALIDATION FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
