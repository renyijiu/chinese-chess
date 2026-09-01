import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIO_PACK_BUDGETS,
  QIN_AUDIO_ASSET_IDS,
  type QinAudioAssetV1,
  type QinAudioPackManifestV1,
  type QinSynthFallbackId,
} from "../../../components/xiangqi/audio/qin-audio-pack-contract";
import {
  resolveQinAudioPublicUrl,
  validateQinAudioPackManifest,
} from "../../../components/xiangqi/audio/qin-audio-pack";
import { validateAudioPackage } from "../../../scripts/verify-audio-assets.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "qin-audio-contract-"));
  temporaryRoots.push(rootDir);

  const definitions = [
    [
      "music.qin-procession",
      "qin-procession-v1.mp3",
      "background",
      "critical",
      "music",
      "audio/mpeg",
      "mp3",
      72,
      2,
      48_000,
    ],
    [
      "accent.capture-clay",
      "capture-clay-v1.wav",
      "transient",
      "deferred",
      "sfx",
      "audio/wav",
      "pcm_s16le",
      0.4,
      1,
      48_000,
    ],
    [
      "system.check",
      "check-bronze-v1.wav",
      "transient",
      "deferred",
      "sfx",
      "audio/wav",
      "pcm_s16le",
      0.8,
      1,
      48_000,
    ],
    [
      "system.victory",
      "result-victory-v1.wav",
      "transient",
      "deferred",
      "sfx",
      "audio/wav",
      "pcm_s16le",
      2,
      1,
      48_000,
    ],
    [
      "system.defeat",
      "result-defeat-v1.wav",
      "transient",
      "deferred",
      "sfx",
      "audio/wav",
      "pcm_s16le",
      2,
      1,
      48_000,
    ],
    [
      "system.draw",
      "result-draw-v1.wav",
      "transient",
      "deferred",
      "sfx",
      "audio/wav",
      "pcm_s16le",
      2,
      1,
      48_000,
    ],
  ] as const;

  const assets = definitions.map<QinAudioAssetV1>((definition, order) => {
    const [id, filename, kind, group, bus, mimeType, codec, durationSeconds, channels, sampleRate] =
      definition;
    const bytes = Buffer.from(`fixture:${id}`);
    const runtimePath = join(rootDir, "public/audio/qin-diorama/v1", filename);
    mkdirSync(dirname(runtimePath), { recursive: true });
    writeFileSync(runtimePath, bytes);
    const sourcePath = `assets/audio/qin-diorama/v1/source/${filename}.flac`;
    const absoluteSourcePath = join(rootDir, sourcePath);
    mkdirSync(dirname(absoluteSourcePath), { recursive: true });
    writeFileSync(absoluteSourcePath, `source:${id}`);
    return {
      id,
      order,
      kind,
      group,
      url: `/audio/qin-diorama/v1/${filename}`,
      mimeType,
      codec,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      durationSeconds,
      channels,
      sampleRate,
      sampleFrames: Math.round(durationSeconds * sampleRate),
      ...(kind === "background" ? { loop: { startSeconds: 4, endSeconds: 68 } } : {}),
      bus,
      synthFallbackId: (id === "music.qin-procession"
        ? "music.fortress"
        : id === "accent.capture-clay"
          ? "system.capture"
          : id) as QinSynthFallbackId,
      sourceRecordId: `source.${order}`,
    };
  });

  const manifest: QinAudioPackManifestV1 = {
    schema: "xiangqi-audio-pack/v1",
    version: 1,
    packId: "qin-diorama",
    claimBoundary:
      "Qin-inspired visual fantasy; not a historical reconstruction or claim of acoustic authenticity.",
    loadOrder: [...QIN_AUDIO_ASSET_IDS],
    assets,
    sourceRecords: assets.map((asset) => ({
      id: asset.sourceRecordId,
      author: "Chinese Chess 3D project",
      authorization:
        "Original project-authored composition and synthesis; redistribution permitted with this repository.",
      sourcePaths: [`assets/audio/qin-diorama/v1/source/${asset.url.split("/").at(-1)}.flac`],
      claimBoundary:
        "Qin-inspired visual fantasy; not a historical reconstruction or claim of acoustic authenticity.",
    })),
  };
  const manifestPath = join(rootDir, "public/audio/qin-diorama/v1/manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const ledgerPath = join(rootDir, "assets/audio/qin-diorama/v1/SOURCES.md");
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(
    ledgerPath,
    `${manifest.claimBoundary}\n${manifest.sourceRecords.map((record) => record.id).join("\n")}\n`,
  );

  const probeAudio = async (path: string) => {
    const asset = assets.find((candidate) => path.endsWith(candidate.url));
    if (!asset) throw new Error(`Unexpected probe path ${path}`);
    return {
      channels: asset.channels,
      codec: asset.codec,
      durationSeconds: asset.durationSeconds,
      sampleRate: asset.sampleRate,
    };
  };

  const probeLosslessSource = async (path: string) => {
    if (!readFileSync(path, "utf8").startsWith("source:")) {
      throw new Error(`Unreadable lossless source fixture: ${path}`);
    }
    return { channels: 1, durationSeconds: 1, sampleRate: 48_000 };
  };

  return { assets, manifest, manifestPath, probeAudio, probeLosslessSource, rootDir };
}

async function expectFailure(
  mutate: (fixture: ReturnType<typeof makeFixture>) => void,
  expected: RegExp,
) {
  const fixture = makeFixture();
  mutate(fixture);
  writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
  await expect(validateAudioPackage(fixture)).rejects.toThrow(expected);
}

describe("Qin audio pack contract", () => {
  it("validates the runtime identity, order, media metadata, and versioned URLs", () => {
    const { manifest } = makeFixture();

    expect(validateQinAudioPackManifest(manifest).loadOrder).toEqual(QIN_AUDIO_ASSET_IDS);
    expect(resolveQinAudioPublicUrl("/audio/qin-diorama/v1/manifest.json", "/chess/")).toBe(
      "/chess/audio/qin-diorama/v1/manifest.json",
    );

    const wrongOrder = structuredClone(manifest);
    [wrongOrder.loadOrder[0], wrongOrder.loadOrder[1]] = [
      wrongOrder.loadOrder[1]!,
      wrongOrder.loadOrder[0]!,
    ];
    expect(() => validateQinAudioPackManifest(wrongOrder)).toThrow(/load order/i);

    const wrongCodec = structuredClone(manifest);
    wrongCodec.assets[1]!.codec = "mp3" as "pcm_s16le";
    expect(() => validateQinAudioPackManifest(wrongCodec)).toThrow(/capture-clay.*codec/i);

    const wrongIdentity = structuredClone(manifest);
    wrongIdentity.assets[2]!.id = "system.draw";
    expect(() => validateQinAudioPackManifest(wrongIdentity)).toThrow(/asset 2.*system\.check/i);

    const wrongUrl = structuredClone(manifest);
    wrongUrl.assets[3]!.url = "/audio/unversioned/result.wav";
    expect(() => validateQinAudioPackManifest(wrongUrl)).toThrow(/victory.*versioned url/i);
  });

  it("rejects runtime loop and numeric duration metadata before media fetch", () => {
    const missingLoop = structuredClone(makeFixture().manifest);
    delete missingLoop.assets[0]!.loop;
    expect(() => validateQinAudioPackManifest(missingLoop)).toThrow(/loop/i);

    const reversedLoop = structuredClone(makeFixture().manifest);
    reversedLoop.assets[0]!.loop = { startSeconds: 60, endSeconds: 4 };
    expect(() => validateQinAudioPackManifest(reversedLoop)).toThrow(/loop range/i);

    const invalidDuration = structuredClone(makeFixture().manifest);
    invalidDuration.assets[4]!.durationSeconds = Number.NaN;
    expect(() => validateQinAudioPackManifest(invalidDuration)).toThrow(/defeat.*duration/i);
  });

  it("accepts the complete six-asset package and reports encoded and decoded budgets", async () => {
    const fixture = makeFixture();

    const report = await validateAudioPackage(fixture);

    expect(report.assetCount).toBe(6);
    expect(report.criticalBytes).toBeGreaterThan(0);
    expect(report.runtimeBytes).toBeGreaterThan(report.criticalBytes);
    expect(report.decodedBytes).toBeLessThanOrEqual(AUDIO_PACK_BUDGETS.authoredDecodedBytes);
  });

  it("rejects duplicate IDs, missing fallbacks, and unknown buses with the asset identified", async () => {
    await expectFailure(({ manifest }) => {
      manifest.assets[1] = { ...manifest.assets[1]!, id: manifest.assets[0]!.id };
    }, /duplicate asset id.*music\.qin-procession/i);
    await expectFailure(({ manifest }) => {
      manifest.assets[2] = {
        ...manifest.assets[2]!,
        synthFallbackId: "" as unknown as QinSynthFallbackId,
      };
    }, /system\.check.*synth fallback/i);
    await expectFailure(({ manifest }) => {
      manifest.assets[3] = { ...manifest.assets[3]!, bus: "voice" as "sfx" };
    }, /system\.victory.*unknown bus.*voice/i);
  });

  it("rejects a media hash mismatch", async () => {
    await expectFailure(({ assets, manifest, rootDir }) => {
      const asset = assets[1];
      if (!asset) throw new Error("Missing capture audio fixture");
      writeFileSync(join(rootDir, "public", asset.url), "changed-media");
      manifest.assets[1] = { ...manifest.assets[1]!, bytes: Buffer.byteLength("changed-media") };
    }, /accent\.capture-clay.*sha-256/i);
  });

  it("allows loop ranges only for background music and rejects out-of-range markers", async () => {
    await expectFailure(({ manifest }) => {
      manifest.assets[0] = { ...manifest.assets[0]!, loop: { startSeconds: 68, endSeconds: 73 } };
    }, /music\.qin-procession.*loop/i);
    await expectFailure(({ manifest }) => {
      manifest.assets[0] = { ...manifest.assets[0]!, loop: { startSeconds: 40, endSeconds: 20 } };
    }, /music\.qin-procession.*loop/i);
    await expectFailure(({ manifest }) => {
      delete manifest.assets[0]!.loop;
    }, /music\.qin-procession.*loop/i);
    await expectFailure(({ manifest }) => {
      manifest.assets[1] = { ...manifest.assets[1]!, loop: { startSeconds: 0.1, endSeconds: 0.2 } };
    }, /accent\.capture-clay.*transient.*loop/i);
  });

  it("rejects critical, runtime, and decoded-byte budget overruns", async () => {
    const criticalFixture = makeFixture();
    await expect(
      validateAudioPackage({
        ...criticalFixture,
        budgets: { ...AUDIO_PACK_BUDGETS, criticalBytes: 1 },
      }),
    ).rejects.toThrow(/critical.*budget/i);

    const runtimeFixture = makeFixture();
    await expect(
      validateAudioPackage({
        ...runtimeFixture,
        budgets: { ...AUDIO_PACK_BUDGETS, runtimeBytes: 1 },
      }),
    ).rejects.toThrow(/runtime.*budget/i);

    const decodedFixture = makeFixture();
    await expect(
      validateAudioPackage({
        ...decodedFixture,
        budgets: { ...AUDIO_PACK_BUDGETS, authoredDecodedBytes: 1 },
      }),
    ).rejects.toThrow(/decoded.*budget/i);
  });

  it("rejects incomplete source records and missing Qin-inspired claim boundaries", async () => {
    await expectFailure(({ manifest }) => {
      manifest.sourceRecords[1] = { ...manifest.sourceRecords[1]!, author: "" };
    }, /source\.1.*author/i);
    await expectFailure(({ manifest }) => {
      manifest.sourceRecords[2] = { ...manifest.sourceRecords[2]!, authorization: "" };
    }, /source\.2.*authorization/i);
    await expectFailure(({ manifest }) => {
      manifest.sourceRecords[3] = { ...manifest.sourceRecords[3]!, sourcePaths: [] };
    }, /source\.3.*source path/i);
    await expectFailure(({ manifest }) => {
      manifest.sourceRecords[4] = { ...manifest.sourceRecords[4]!, claimBoundary: "" };
    }, /source\.4.*claim boundary/i);
  });

  it("rejects LFS pointers and non-decodable files declared as lossless sources", async () => {
    await expectFailure(({ manifest, rootDir }) => {
      const sourcePath = manifest.sourceRecords[0]!.sourcePaths[0]!;
      writeFileSync(
        join(rootDir, sourcePath),
        "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n",
      );
    }, /source\.0.*Git LFS pointer/i);

    await expectFailure(({ manifest, rootDir }) => {
      const sourcePath = manifest.sourceRecords[1]!.sourcePaths[0]!;
      writeFileSync(join(rootDir, sourcePath), "not a decodable FLAC file");
    }, /source\.1.*lossless source/i);
  });
});
