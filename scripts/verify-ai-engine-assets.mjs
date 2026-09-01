#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.1.12";
const RUNTIME_DIRECTORY = `public/engines/fairy-stockfish-nnue/${VERSION}`;
const PROVENANCE_PATH = `third_party/fairy-stockfish-nnue/${VERSION}/provenance.json`;
const LFS_POINTER = Buffer.from("version https://git-lfs.github.com/spec/v1");
const SHA256 = /^[a-f0-9]{64}$/;

export const ENGINE_ASSET_EXPECTATIONS = Object.freeze({
  engineId: "fairy-stockfish-nnue",
  version: VERSION,
  packageHash: "4945517be0f7a9d4520b08acadfd736e82b15758935395eb828f8f949b485f41",
  sourceHash: "1fc961fb5a6e6cc61bc4a489b12d58a03e503e9fb27352477562994b07041594",
  sourceCommit: "b2e693ef1e111233ce3fb40685921708b3276ed6",
  networkHash: "c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11",
  networkCommit: "5fbbb9e15fd882cec18a2a5c3d4bfa25dc07169b",
});

const EXPECTED_RUNTIME_FILES = Object.freeze([
  ["stockfish.js", "engine-glue", "text/javascript; charset=utf-8"],
  ["stockfish.wasm", "engine-wasm", "application/wasm"],
  ["stockfish.worker.js", "pthread-worker", "text/javascript; charset=utf-8"],
  ["xiangqi-c07e94a5c7cb.nnue", "xiangqi-network", "application/octet-stream"],
  ["AUTHORS", "authors-notice", "text/plain; charset=utf-8"],
  ["Copying.txt", "license-notice", "text/plain; charset=utf-8"],
]);

const EXPECTED_EXTERNAL_RUNTIME_URLS = new Set([
  "https://emscripten.org/docs/porting/pthreads.html#blocking-on-the-main-browser-thread",
]);

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields differ: expected ${wanted.join(", ")}; got ${actual.join(", ")}`);
  }
}

function assertSha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value))
    fail(`${label} must be a lowercase SHA-256 digest`);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

function safeRepositoryPath(rootDir, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\")
  ) {
    fail(`${label} must be a nonempty repository-relative path`);
  }
  const absolute = resolve(rootDir, relativePath);
  const rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  if (!absolute.startsWith(rootPrefix)) fail(`${label} escapes the repository: ${relativePath}`);
  return absolute;
}

function assertNotLfsPointer(bytes, label) {
  if (bytes.subarray(0, LFS_POINTER.length).equals(LFS_POINTER)) {
    fail(`${label} is an unhydrated Git LFS pointer`);
  }
}

function validatePinnedFile(record, rootDir, label, readBytes) {
  assertExactKeys(
    record,
    [
      "path",
      "bytes",
      "sha256",
      ...(label === "package" ? ["name", "url"] : ["repository", "commit", "tag", "url"]),
    ],
    `${label} provenance`,
  );
  assertPositiveInteger(record.bytes, `${label} bytes`);
  assertSha(record.sha256, `${label} SHA-256`);
  const path = safeRepositoryPath(rootDir, record.path, `${label} path`);
  const bytes = readBytes(path);
  assertNotLfsPointer(bytes, label);
  if (bytes.byteLength !== record.bytes)
    fail(`${label} byte count differs: provenance ${record.bytes}, disk ${bytes.byteLength}`);
  const digest = sha256(bytes);
  if (digest !== record.sha256)
    fail(`${label} SHA-256 differs: provenance ${record.sha256}, disk ${digest}`);
  return path;
}

function defaultProbeArchive(path) {
  try {
    return execFileSync("tar", ["-tzf", path], { encoding: "utf8" }).trim().split("\n");
  } catch (error) {
    fail(`Could not inspect source archive ${path}: ${error.message}`);
  }
}

function defaultReadArchiveMember(path, member) {
  try {
    return execFileSync("tar", ["-xOzf", path, member], {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    fail(`Could not read ${member} from ${path}: ${error.message}`);
  }
}

function requireArchiveMembers(members, suffixes, label) {
  for (const suffix of suffixes) {
    if (!members.some((entry) => entry === suffix || entry.endsWith(`/${suffix}`))) {
      fail(`${label} is incomplete; missing ${suffix}`);
    }
  }
}

function validateRuntimeFiles(manifest, rootDir, readBytes) {
  if (
    !Array.isArray(manifest.runtimeFiles) ||
    manifest.runtimeFiles.length !== EXPECTED_RUNTIME_FILES.length
  ) {
    fail(`Manifest must inventory exactly ${EXPECTED_RUNTIME_FILES.length} runtime files`);
  }
  const seen = new Set();
  let runtimeBytes = 0;
  for (const [index, expected] of EXPECTED_RUNTIME_FILES.entries()) {
    const record = manifest.runtimeFiles[index];
    assertExactKeys(
      record,
      ["name", "role", "mimeType", "bytes", "sha256"],
      `runtime file ${index}`,
    );
    const [name, role, mimeType] = expected;
    if (record.name !== name) fail(`Runtime file ${index} must be ${name}, got ${record.name}`);
    if (seen.has(record.name)) fail(`Duplicate runtime file ${record.name}`);
    seen.add(record.name);
    if (record.role !== role) fail(`${name} role must be ${role}`);
    if (record.mimeType !== mimeType) fail(`${name} MIME type must be ${mimeType}`);
    if (record.name.includes("/") || record.name.includes("\\") || record.name.includes(".."))
      fail(`${name} is not a safe runtime filename`);
    assertPositiveInteger(record.bytes, `${name} bytes`);
    assertSha(record.sha256, `${name} SHA-256`);
    const path = safeRepositoryPath(rootDir, `${RUNTIME_DIRECTORY}/${record.name}`, `${name} path`);
    const bytes = readBytes(path);
    assertNotLfsPointer(bytes, name);
    if (bytes.byteLength !== record.bytes)
      fail(`${name} byte count differs: manifest ${record.bytes}, disk ${bytes.byteLength}`);
    const digest = sha256(bytes);
    if (digest !== record.sha256)
      fail(`${name} SHA-256 differs: manifest ${record.sha256}, disk ${digest}`);
    if (bytes.toString("latin1").toLowerCase().includes("draco"))
      fail(`${name} contains forbidden Draco references`);
    if (record.role === "engine-glue" || record.role === "pthread-worker") {
      const urls = bytes.toString("utf8").match(/https?:\/\/[^\s"'<>)]*/g) ?? [];
      for (const url of urls) {
        if (!EXPECTED_EXTERNAL_RUNTIME_URLS.has(url))
          fail(`${name} contains unexpected network URL ${url}`);
      }
    }
    runtimeBytes += bytes.byteLength;
  }
  const wasm = readBytes(resolve(rootDir, RUNTIME_DIRECTORY, "stockfish.wasm"));
  if (!wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])))
    fail("stockfish.wasm is not a WebAssembly module");
  if (!wasm.toString("latin1").includes("[commit: b2e693ef, upstream: , emscripten: 2.0.26]")) {
    fail("stockfish.wasm does not contain the pinned source/toolchain build identity");
  }
  return runtimeBytes;
}

function validateProvenance(
  provenance,
  rootDir,
  manifest,
  readBytes,
  probeArchive,
  readArchiveMember,
) {
  assertExactKeys(
    provenance,
    ["schema", "component", "version", "license", "package", "source", "network", "build"],
    "provenance",
  );
  if (provenance.schema !== "xiangqi-engine-provenance/v1")
    fail("Provenance schema must be xiangqi-engine-provenance/v1");
  if (provenance.component !== ENGINE_ASSET_EXPECTATIONS.engineId || provenance.version !== VERSION)
    fail("Provenance component/version does not match the manifest");
  if (provenance.license !== "GPL-3.0-only") fail("Provenance license must be GPL-3.0-only");

  const packagePath = validatePinnedFile(provenance.package, rootDir, "package", readBytes);
  if (
    provenance.package.name !== "fairy-stockfish-nnue.wasm" ||
    provenance.package.url !==
      `https://registry.npmjs.org/fairy-stockfish-nnue.wasm/-/fairy-stockfish-nnue.wasm-${VERSION}.tgz`
  ) {
    fail("Package name or URL is not the pinned 1.1.12 npm release");
  }
  if (provenance.package.sha256 !== ENGINE_ASSET_EXPECTATIONS.packageHash)
    fail("Package hash is not the audited 1.1.12 hash");

  const sourcePath = validatePinnedFile(provenance.source, rootDir, "source", readBytes);
  if (
    provenance.source.repository !== "https://github.com/fairy-stockfish/fairy-stockfish.wasm" ||
    provenance.source.commit !== ENGINE_ASSET_EXPECTATIONS.sourceCommit ||
    provenance.source.tag !== VERSION
  ) {
    fail("Source repository, commit, or tag is not the audited 1.1.12 source");
  }
  if (
    provenance.source.url !==
    `https://github.com/fairy-stockfish/fairy-stockfish.wasm/archive/${ENGINE_ASSET_EXPECTATIONS.sourceCommit}.tar.gz`
  )
    fail("Source URL is not commit-pinned");
  if (provenance.source.sha256 !== ENGINE_ASSET_EXPECTATIONS.sourceHash)
    fail("Source hash is not the audited 1.1.12 hash");

  requireArchiveMembers(
    probeArchive(packagePath),
    [
      "package.json",
      "stockfish.js",
      "stockfish.wasm",
      "stockfish.worker.js",
      "AUTHORS",
      "Copying.txt",
    ],
    "npm package archive",
  );
  requireArchiveMembers(
    probeArchive(sourcePath),
    [
      "Copying.txt",
      "src/Makefile_js",
      "src/emscripten/Makefile",
      "src/emscripten/docker-compose.yml",
      "src/evaluate.cpp",
      "src/nnue/evaluate_nnue.cpp",
    ],
    "corresponding-source archive",
  );
  for (const name of [
    "stockfish.js",
    "stockfish.wasm",
    "stockfish.worker.js",
    "AUTHORS",
    "Copying.txt",
  ]) {
    const packaged = readArchiveMember(packagePath, `package/${name}`);
    const distributed = readBytes(resolve(rootDir, RUNTIME_DIRECTORY, name));
    if (!packaged.equals(distributed)) {
      fail(`${name} differs from the pinned npm package member`);
    }
  }

  assertExactKeys(
    provenance.network,
    [
      "repository",
      "commit",
      "url",
      "runtimePath",
      "bytes",
      "sha256",
      "author",
      "license",
      "redistributionEvidence",
    ],
    "network provenance",
  );
  if (
    provenance.network.repository !== "https://github.com/fairy-stockfish/xiangqi-nnue" ||
    provenance.network.commit !== ENGINE_ASSET_EXPECTATIONS.networkCommit
  )
    fail("Network repository or commit is not pinned");
  if (
    provenance.network.url !==
    `https://raw.githubusercontent.com/fairy-stockfish/xiangqi-nnue/${ENGINE_ASSET_EXPECTATIONS.networkCommit}/nn-c07e94a5c7cb.nnue`
  )
    fail("Network URL is not commit-pinned");
  if (provenance.network.runtimePath !== `${RUNTIME_DIRECTORY}/xiangqi-c07e94a5c7cb.nnue`)
    fail("Network runtime path does not match the manifest");
  if (
    provenance.network.bytes !== 11261932 ||
    provenance.network.sha256 !== ENGINE_ASSET_EXPECTATIONS.networkHash
  )
    fail("Network size or hash is not the audited Xiangqi NNUE");
  if (
    provenance.network.author !== "Pikafish developers" ||
    provenance.network.license !== "GPL-3.0-only" ||
    !provenance.network.redistributionEvidence?.trim()
  )
    fail("Network author/license/redistribution evidence is incomplete");

  assertExactKeys(
    provenance.build,
    ["documentation", "containerImage", "workingDirectory", "commands", "localPatches"],
    "build provenance",
  );
  if (provenance.build.documentation !== `third_party/fairy-stockfish-nnue/${VERSION}/BUILD.md`)
    fail("Build documentation path is not pinned");
  if (
    provenance.build.containerImage !== "emscripten/emsdk:2.0.26" ||
    provenance.build.workingDirectory !== "src/emscripten"
  )
    fail("Build toolchain is not the upstream pinned environment");
  if (
    !Array.isArray(provenance.build.commands) ||
    provenance.build.commands.length < 2 ||
    provenance.build.commands.some((command) => typeof command !== "string" || !command.trim())
  )
    fail("Build provenance must include deterministic commands");
  if (
    !provenance.build.commands.some(
      (command) =>
        command.includes("embedded_nnue=no") &&
        command.includes("wasm_simd=yes") &&
        command.includes("EM_COMMIT=b2e693ef") &&
        command.includes("EM_UPSTREAM=") &&
        command.includes("EM_EMSCRIPTEN=2.0.26"),
    )
  )
    fail(
      "Build command must reproduce the no-embedded-NNUE SIMD runtime and embedded release identity",
    );
  if (!Array.isArray(provenance.build.localPatches) || provenance.build.localPatches.length !== 0)
    fail("Local patches must be an explicit empty list for the unmodified runtime");
  const buildDoc = safeRepositoryPath(
    rootDir,
    provenance.build.documentation,
    "build documentation",
  );
  const buildText = readBytes(buildDoc).toString("utf8");
  if (
    !buildText.includes(provenance.build.containerImage) ||
    !buildText.includes(ENGINE_ASSET_EXPECTATIONS.sourceCommit)
  )
    fail("Build documentation is missing the pinned toolchain or source commit");

  const networkRecord = manifest.runtimeFiles.find((file) => file.role === "xiangqi-network");
  if (
    !networkRecord ||
    networkRecord.bytes !== provenance.network.bytes ||
    networkRecord.sha256 !== provenance.network.sha256
  )
    fail("Manifest and provenance disagree about the Xiangqi network");
}

export function validateAiEngineAssets(options = {}) {
  const rootDir = resolve(options.rootDir ?? SCRIPT_ROOT);
  const readBytes = options.readBytes ?? ((path) => readFileSync(path));
  const probeArchive = options.probeArchive ?? defaultProbeArchive;
  const readArchiveMember = options.readArchiveMember ?? defaultReadArchiveMember;
  const manifestPath = resolve(
    options.manifestPath ?? resolve(rootDir, RUNTIME_DIRECTORY, "manifest.json"),
  );
  const manifest = options.manifest ?? readJson(manifestPath, "engine asset manifest");
  const provenance =
    options.provenance ?? readJson(resolve(rootDir, PROVENANCE_PATH), "engine provenance");
  const packageJson =
    options.packageJson ?? readJson(resolve(rootDir, "package.json"), "package.json");
  const notices =
    options.notices ?? readBytes(resolve(rootDir, "THIRD_PARTY_NOTICES.md")).toString("utf8");
  const projectLicense = options.projectLicense ?? readBytes(resolve(rootDir, "LICENSE"));

  assertExactKeys(
    manifest,
    [
      "schema",
      "engineId",
      "version",
      "license",
      "variant",
      "runtimeBaseUrl",
      "requirements",
      "runtimeFiles",
      "provenance",
    ],
    "manifest",
  );
  if (manifest.schema !== "xiangqi-engine-assets/v1")
    fail("Manifest schema must be xiangqi-engine-assets/v1");
  if (manifest.engineId !== ENGINE_ASSET_EXPECTATIONS.engineId || manifest.version !== VERSION)
    fail("Manifest engine/version is not fairy-stockfish-nnue 1.1.12");
  if (manifest.license !== "GPL-3.0-only" || manifest.variant !== "xiangqi")
    fail("Manifest must declare GPL-3.0-only and Xiangqi");
  if (manifest.runtimeBaseUrl !== `/engines/fairy-stockfish-nnue/${VERSION}/`)
    fail("Manifest runtime base URL is not version-pinned and local");
  assertExactKeys(
    manifest.requirements,
    ["secureContext", "crossOriginIsolated", "sharedArrayBuffer", "wasmSimd"],
    "runtime requirements",
  );
  if (Object.values(manifest.requirements).some((value) => value !== true))
    fail("All Master runtime capability requirements must be explicit true values");

  const runtimeBytes = validateRuntimeFiles(manifest, rootDir, readBytes);

  assertExactKeys(manifest.provenance, ["path", "bytes", "sha256"], "manifest provenance pointer");
  if (manifest.provenance.path !== PROVENANCE_PATH)
    fail("Manifest provenance path is not version-pinned");
  assertPositiveInteger(manifest.provenance.bytes, "provenance bytes");
  assertSha(manifest.provenance.sha256, "provenance SHA-256");
  const provenanceBytes = readBytes(
    safeRepositoryPath(rootDir, manifest.provenance.path, "provenance path"),
  );
  if (
    provenanceBytes.byteLength !== manifest.provenance.bytes ||
    sha256(provenanceBytes) !== manifest.provenance.sha256
  )
    fail("Provenance file size or hash differs from the manifest");
  validateProvenance(provenance, rootDir, manifest, readBytes, probeArchive, readArchiveMember);

  if (packageJson.license !== "GPL-3.0-only") fail("package.json license must be GPL-3.0-only");
  if (sha256(projectLicense) !== "0b383d5a63da644f628d99c33976ea6487ed89aaa59f0b3257992deac1171e6b")
    fail("Project LICENSE must contain the audited GPL-3.0 text");
  for (const requiredNotice of [
    VERSION,
    ENGINE_ASSET_EXPECTATIONS.sourceCommit,
    ENGINE_ASSET_EXPECTATIONS.packageHash,
    ENGINE_ASSET_EXPECTATIONS.sourceHash,
    ENGINE_ASSET_EXPECTATIONS.networkHash,
    ...EXPECTED_RUNTIME_FILES.map(([name]) => name),
  ]) {
    if (!notices.includes(requiredNotice))
      fail(`THIRD_PARTY_NOTICES.md is missing ${requiredNotice}`);
  }

  return {
    engineId: manifest.engineId,
    runtimeBytes,
    runtimeFileCount: manifest.runtimeFiles.length,
    version: manifest.version,
  };
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  try {
    const report = validateAiEngineAssets();
    console.log("AI engine asset validation passed.");
    console.log(`Engine: ${report.engineId}@${report.version}`);
    console.log(`Runtime files: ${report.runtimeFileCount}`);
    console.log(
      `Runtime transfer: ${report.runtimeBytes} bytes (${formatMiB(report.runtimeBytes)})`,
    );
  } catch (error) {
    console.error(`AI ENGINE ASSET VALIDATION FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
