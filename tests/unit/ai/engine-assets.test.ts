import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENGINE_ASSET_EXPECTATIONS,
  validateAiEngineAssets,
} from "../../../scripts/verify-ai-engine-assets.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANIFEST_PATH = resolve(ROOT, "public/engines/fairy-stockfish-nnue/1.1.12/manifest.json");
const PROVENANCE_PATH = resolve(ROOT, "third_party/fairy-stockfish-nnue/1.1.12/provenance.json");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fixture() {
  return {
    rootDir: ROOT,
    manifest: structuredClone(readJson(MANIFEST_PATH)),
    provenance: structuredClone(readJson(PROVENANCE_PATH)),
  };
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function archiveMembers(path: string): string[] {
  return execFileSync("tar", ["-tzf", path], { encoding: "utf8" }).trim().split("\n");
}

function archiveMember(path: string, member: string): Buffer {
  return execFileSync("tar", ["-xOzf", path, member], { encoding: "buffer" });
}

function expectHardFailure(mutate: (current: ReturnType<typeof fixture>) => void) {
  const current = fixture();
  mutate(current);
  expect(() => validateAiEngineAssets(current)).toThrow();
}

describe("Fairy-Stockfish Master asset contract", () => {
  it("accepts the complete pinned runtime, source, network, license, and notices", () => {
    expect(validateAiEngineAssets({ rootDir: ROOT })).toEqual({
      engineId: "fairy-stockfish-nnue",
      runtimeBytes: 13_006_590,
      runtimeFileCount: 6,
      version: "1.1.12",
    });
  });

  it("rejects manifest identity, capability, URL, and runtime metadata drift", () => {
    const wrongSchema = fixture();
    wrongSchema.manifest.schema = "xiangqi-engine-assets/v2";
    expect(() => validateAiEngineAssets(wrongSchema)).toThrow(/schema.*v1/i);

    const remoteRuntime = fixture();
    remoteRuntime.manifest.runtimeBaseUrl = "https://cdn.example/engine/";
    expect(() => validateAiEngineAssets(remoteRuntime)).toThrow(/runtime base url/i);

    const missingIsolation = fixture();
    missingIsolation.manifest.requirements.crossOriginIsolated = false;
    expect(() => validateAiEngineAssets(missingIsolation)).toThrow(/capability requirements/i);

    const wrongRole = fixture();
    wrongRole.manifest.runtimeFiles[1].role = "draco-decoder";
    expect(() => validateAiEngineAssets(wrongRole)).toThrow(/stockfish\.wasm role/i);

    const wrongMime = fixture();
    wrongMime.manifest.runtimeFiles[1].mimeType = "application/octet-stream";
    expect(() => validateAiEngineAssets(wrongMime)).toThrow(/stockfish\.wasm MIME/i);
  });

  it("rejects runtime byte, hash, forbidden-codec, and unexpected-network drift", () => {
    const wrongHash = fixture();
    wrongHash.manifest.runtimeFiles[0].sha256 = "0".repeat(64);
    expect(() => validateAiEngineAssets(wrongHash)).toThrow(/stockfish\.js SHA-256 differs/i);

    const wrongBytes = fixture();
    wrongBytes.manifest.runtimeFiles[2].bytes += 1;
    expect(() => validateAiEngineAssets(wrongBytes)).toThrow(
      /stockfish\.worker\.js byte count differs/i,
    );

    for (const [suffix, expected] of [
      ["draco", /forbidden Draco/i],
      ["https://evil.example/runtime", /unexpected network URL/i],
    ] as const) {
      const altered = fixture();
      const original = readFileSync(
        resolve(ROOT, "public/engines/fairy-stockfish-nnue/1.1.12/stockfish.js"),
      );
      const changed = Buffer.concat([original, Buffer.from(`\n/* ${suffix} */\n`)]);
      altered.manifest.runtimeFiles[0].bytes = changed.byteLength;
      altered.manifest.runtimeFiles[0].sha256 = sha256(changed);
      expect(() =>
        validateAiEngineAssets({
          ...altered,
          readBytes: (path: string) =>
            path.endsWith("/stockfish.js") ? changed : readFileSync(path),
        }),
      ).toThrow(expected);
    }
  });

  it("rejects an unhydrated NNUE LFS pointer before trusting declared size", () => {
    const current = fixture();
    const pointer = Buffer.from(
      `version https://git-lfs.github.com/spec/v1\noid sha256:${ENGINE_ASSET_EXPECTATIONS.networkHash}\nsize 11261932\n`,
    );
    expect(() =>
      validateAiEngineAssets({
        ...current,
        readBytes: (path: string) => (path.endsWith(".nnue") ? pointer : readFileSync(path)),
      }),
    ).toThrow(/NNUE pointer|unhydrated Git LFS pointer/i);
  });

  it("proves every distributed upstream runtime byte equals its pinned npm member", () => {
    const current = fixture();
    expect(() =>
      validateAiEngineAssets({
        ...current,
        readArchiveMember: (path: string, member: string) => {
          const bytes = archiveMember(path, member);
          return member.endsWith("/stockfish.js")
            ? Buffer.concat([bytes, Buffer.from("drift")])
            : bytes;
        },
      }),
    ).toThrow(/stockfish\.js differs from the pinned npm package member/i);
  });

  it("rejects incomplete corresponding source and source/package provenance drift", () => {
    const incompleteSource = fixture();
    expect(() =>
      validateAiEngineAssets({
        ...incompleteSource,
        probeArchive: (path: string) =>
          path.includes("source.tar.gz")
            ? archiveMembers(path).filter(
                (member) => !member.endsWith("src/nnue/evaluate_nnue.cpp"),
              )
            : archiveMembers(path),
      }),
    ).toThrow(/corresponding-source archive is incomplete.*evaluate_nnue/i);

    const wrongPackage = fixture();
    wrongPackage.provenance.package.sha256 = "1".repeat(64);
    expect(() => validateAiEngineAssets(wrongPackage)).toThrow(/package SHA-256 differs/i);

    const wrongCommit = fixture();
    wrongCommit.provenance.source.commit = "0".repeat(40);
    expect(() => validateAiEngineAssets(wrongCommit)).toThrow(/source repository, commit, or tag/i);
  });

  it("rejects incomplete NNUE provenance, build commands, and patch disclosure", () => {
    const wrongNetwork = fixture();
    wrongNetwork.provenance.network.license = "unknown";
    expect(() => validateAiEngineAssets(wrongNetwork)).toThrow(/network author\/license/i);

    const movingNetworkUrl = fixture();
    movingNetworkUrl.provenance.network.url = "https://example.test/latest.nnue";
    expect(() => validateAiEngineAssets(movingNetworkUrl)).toThrow(
      /network URL is not commit-pinned/i,
    );

    const incompleteBuild = fixture();
    incompleteBuild.provenance.build.commands = ["make"];
    expect(() => validateAiEngineAssets(incompleteBuild)).toThrow(/deterministic commands/i);

    const undisclosedPatch = fixture();
    undisclosedPatch.provenance.build.localPatches = ["fix.patch"];
    expect(() => validateAiEngineAssets(undisclosedPatch)).toThrow(/local patches.*empty/i);
  });

  it("rejects project license and third-party notice mismatches", () => {
    const current = fixture();
    expect(() =>
      validateAiEngineAssets({
        ...current,
        packageJson: { ...readJson(resolve(ROOT, "package.json")), license: "MIT" },
      }),
    ).toThrow(/package\.json license/i);
    expect(() =>
      validateAiEngineAssets({ ...current, projectLicense: Buffer.from("not GPL") }),
    ).toThrow(/project LICENSE/i);
    expect(() =>
      validateAiEngineAssets({
        ...current,
        notices: readFileSync(resolve(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8").replace(
          ENGINE_ASSET_EXPECTATIONS.networkHash,
          "missing",
        ),
      }),
    ).toThrow(/THIRD_PARTY_NOTICES.*c07e94/i);
  });

  it("hard-fails every manifest identity and provenance-pointer field when corrupted", () => {
    for (const mutate of [
      (current: ReturnType<typeof fixture>) => {
        current.manifest.engineId = "other";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.version = "latest";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.license = "unknown";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.variant = "chess";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.requirements.wasmSimd = false;
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.provenance.path = "../outside.json";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.provenance.bytes += 1;
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.provenance.sha256 = "0".repeat(64);
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.unexpected = true;
      },
    ])
      expectHardFailure(mutate);
  });

  it("hard-fails every runtime record field when corrupted", () => {
    for (const mutate of [
      (current: ReturnType<typeof fixture>) => {
        current.manifest.runtimeFiles[0].name = "other.js";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.runtimeFiles[0].role = "other";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.runtimeFiles[0].mimeType = "text/plain";
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.runtimeFiles[0].bytes += 1;
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.runtimeFiles[0].sha256 = "0".repeat(64);
      },
      (current: ReturnType<typeof fixture>) => {
        current.manifest.runtimeFiles[0].unexpected = true;
      },
    ])
      expectHardFailure(mutate);
  });

  it("hard-fails every component/package/source provenance field when corrupted", () => {
    for (const mutate of [
      (current: ReturnType<typeof fixture>) => {
        current.provenance.schema = "other";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.component = "other";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.version = "latest";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.license = "unknown";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.package.name = "other";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.package.url = "https://example.test/latest.tgz";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.package.path = "LICENSE";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.package.bytes += 1;
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.package.sha256 = "0".repeat(64);
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.repository = "https://example.test/source";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.commit = "0".repeat(40);
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.tag = "latest";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.url = "https://example.test/source.tar.gz";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.path = "LICENSE";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.bytes += 1;
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.source.sha256 = "0".repeat(64);
      },
    ])
      expectHardFailure(mutate);
  });

  it("hard-fails every NNUE and build provenance field when corrupted", () => {
    for (const mutate of [
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.repository = "https://example.test/network";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.commit = "0".repeat(40);
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.url = "https://example.test/latest.nnue";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.runtimePath = "public/latest.nnue";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.bytes += 1;
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.sha256 = "0".repeat(64);
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.author = "";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.license = "unknown";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.network.redistributionEvidence = "";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.build.documentation = "README.md";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.build.containerImage = "emscripten/emsdk:latest";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.build.workingDirectory = ".";
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.build.commands = [];
      },
      (current: ReturnType<typeof fixture>) => {
        current.provenance.build.localPatches = ["undisclosed.patch"];
      },
    ])
      expectHardFailure(mutate);
  });
});
