#!/usr/bin/env node

// Re-pins the authoritative source lock after a deliberate rebuild.
//   --sources  only the research GLB / BLEND digests (run before the runtime build)
//   (default)  sources and the raw LOD exports (run after the runtime build)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LOCK_SCHEMA,
  SOURCE_LOCK_PATH,
  SOURCE_STYLE_FAMILY,
} from "./authoritative-source-lock.mjs";
import { LODS, ROLE_NAMES } from "./piece-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const sourcesOnly = process.argv.includes("--sources");
const lockPath = resolve(root, SOURCE_LOCK_PATH);

// Read first and treat a missing file as the answer: checking for existence
// beforehand would leave a window in which the file could change.
function readPreviousLock() {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { roles: {} };
    throw error;
  }
}

function entry(path) {
  let bytes;
  try {
    bytes = readFileSync(resolve(root, path));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Cannot lock a missing file: ${path}`);
    throw error;
  }
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
}

try {
  const previous = readPreviousLock();
  const roles = {};
  for (const role of ROLE_NAMES) {
    const stem = `assets/models/red-${role}-terracotta-cartoon-v3`;
    roles[role] = {
      visual: entry(`${stem}.glb`),
      editableMaster: entry(`${stem}.blend`),
      rawLods: sourcesOnly
        ? (previous.roles?.[role]?.rawLods ?? {})
        : Object.fromEntries(
            LODS.map((lod) => [
              lod,
              entry(`assets/characters/${role}/exports/${role}-${lod}-raw.glb`),
            ]),
          ),
    };
  }
  const lock = {
    schema: LOCK_SCHEMA,
    styleFamily: SOURCE_STYLE_FAMILY,
    generator: "scripts/blender/build_red_xiangqi_terracotta_cartoon_set_v3.py",
    roles,
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(
    `Locked ${ROLE_NAMES.length} roles (${sourcesOnly ? "sources only" : "sources and raw LODs"}): ${SOURCE_LOCK_PATH}`,
  );
} catch (error) {
  console.error(`SOURCE LOCK FAILED: ${error.message}`);
  process.exitCode = 1;
}
