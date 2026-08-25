#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  readSourceLock,
  verifyAuthoritativeSources,
  verifyRawLods,
} from "./authoritative-source-lock.mjs";
import { createManifest, LODS, ROLE_NAMES } from "./piece-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const args = new Set(process.argv.slice(2));
const skipBlender = args.has("--skip-blender");
const skipValidation = args.has("--skip-validation");

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed${result.error ? `: ${result.error.message}` : ` with exit ${result.status}`}`);
  }
}

function toolAvailable(command, commandArgs = ["--version"]) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: "pipe" });
  return !result.error && result.status === 0;
}

function glbJson(path) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "glTF") throw new Error(`Not a GLB: ${path}`);
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trimEnd());
}

function rawGeometrySummary(gltf, path) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const position = gltf.accessors?.[primitive.attributes?.POSITION];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], position?.min?.[axis] ?? Infinity);
        max[axis] = Math.max(max[axis], position?.max?.[axis] ?? -Infinity);
      }
    }
  }
  if (![...min, ...max].every(Number.isFinite)) throw new Error(`Cannot read geometry bounds from ${path}`);
  return {
    height: Number((max[1] - min[1]).toFixed(4)),
    maxFootprint: Number(Math.max(max[0] - min[0], max[2] - min[2]).toFixed(4)),
  };
}

function readRawAsset(role, lod) {
  const raw = resolve(root, `assets/characters/${role}/exports/${role}-${lod}-raw.glb`);
  try {
    const gltf = glbJson(raw);
    return { gltf, lod, raw, summary: rawGeometrySummary(gltf, raw) };
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Missing raw ${role}/${lod} export: ${raw}`);
    throw error;
  }
}

try {
  const sourceLock = readSourceLock(root, ROLE_NAMES);
  verifyAuthoritativeSources(root, sourceLock, ROLE_NAMES);
  if (skipBlender) verifyRawLods(root, sourceLock, ROLE_NAMES, LODS);
  if (!toolAvailable("blender") && !skipBlender) {
    throw new Error("Blender 5.2 is required. Install it or rerun with --skip-blender after raw GLBs are generated.");
  }
  if (!toolAvailable("npx", ["--no-install", "gltf-transform", "--version"])) {
    throw new Error("glTF Transform CLI is missing. Run npm install before building piece assets.");
  }

  if (!skipBlender) {
    run(
      "blender",
      ["--factory-startup", "-b", "--python", "scripts/blender/create_xiangqi_piece_assets.py"],
      "Blender seven-role generation",
    );
  }

  const metrics = {};
  for (const role of ROLE_NAMES) {
    const rawAssets = LODS.map((lod) => readRawAsset(role, lod));
    metrics[role] = {
      height: rawAssets[0].summary.height,
      maxFootprint: Math.max(...rawAssets.map(({ summary }) => summary.maxFootprint)),
    };
    for (const { gltf, lod, raw } of rawAssets) {
      const runtime = resolve(root, `public/models/pieces/v1/${role}/${role}-${lod}.glb`);
      const bitmapCount = (gltf.images?.length ?? 0) + (gltf.textures?.length ?? 0);
      if (bitmapCount > 0) {
        if (!toolAvailable("toktx", ["--version"])) {
          throw new Error(
            `${role}/${lod} contains bitmap textures but toktx is unavailable. Install KTX-Software; ` +
              "BaseColor must use ETC1S and normal/ORM must use UASTC before this build may pass.",
          );
        }
        throw new Error(
          `${role}/${lod} introduced bitmap textures. Add an explicit semantic ETC1S/UASTC texture stage before Meshopt; ` +
            "the build will not guess normal-map compression.",
        );
      }
      console.log(`${role}/${lod}: KTX2 not applicable — GLB contains no bitmap textures`);
      if (role === "marshal") {
        console.log(`marshal/${lod}: preserving accepted hero geometry while applying meter-stable Meshopt filtering`);
      }
      mkdirSync(dirname(runtime), { recursive: true });
      run(
        "node",
        ["scripts/assets/meshopt-piece.mjs", raw, runtime],
        `Meshopt compression for ${role}/${lod}`,
      );
    }
  }

  writeFileSync(
    resolve(root, "public/models/pieces/v1/manifest.json"),
    `${JSON.stringify(createManifest(metrics), null, 2)}\n`,
  );

  if (!skipValidation) run("node", ["scripts/assets/validate-pieces.mjs"], "Asset validation");
  console.log(`Piece asset build complete: ${ROLE_NAMES.length * LODS.length} Meshopt GLBs`);
} catch (error) {
  console.error(`ASSET BUILD FAILED: ${error.message}`);
  process.exitCode = 1;
}
