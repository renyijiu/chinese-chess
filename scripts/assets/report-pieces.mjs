#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { LODS, ROLE_NAMES } from "./piece-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(root, "public/models/pieces/v1/manifest.json");

function readGlb(path) {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trimEnd());
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = gltf.accessors[primitive.indices ?? primitive.attributes.POSITION];
      triangles += Math.floor(accessor.count / 3);
    }
  }
  const character = (gltf.nodes ?? []).find((node) => node.name === "character_mesh");
  const skin = character?.skin === undefined ? undefined : gltf.skins?.[character.skin];
  return {
    triangles,
    joints: skin?.joints?.length ?? 0,
    clips: (gltf.animations ?? []).length,
    primitives: (gltf.meshes ?? []).reduce((total, mesh) => total + (mesh.primitives?.length ?? 0), 0),
    meshopt: [...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])].includes("EXT_meshopt_compression"),
    bitmapTextures: gltf.textures?.length ?? 0,
  };
}

if (!existsSync(manifestPath)) {
  console.error(`ASSET REPORT FAILED: missing manifest ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
console.log("# Xiangqi piece asset report\n");
console.log(`- Contract: ${manifest.schema}`);
console.log(`- Coordinates: ${manifest.coordinateSystem.units}, ${manifest.coordinateSystem.up} up, ${manifest.coordinateSystem.forward} forward`);
console.log(`- KTX2: ${manifest.textureCompression.status}`);
console.log(`- Coverage: ${ROLE_NAMES.length} geometry families / ${ROLE_NAMES.length * 2} faction variants / ${ROLE_NAMES.length * LODS.length} GLBs\n`);
console.log("| Role | Faction names | LOD | Triangles | Budget | Joints | Clips | Primitives | Meshopt | Footprint | Size |\n|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|");
let lod1Bytes = 0;
for (const role of ROLE_NAMES) {
  const asset = manifest.roles[role];
  for (const lod of LODS) {
    const relative = asset.variants.red.lods[lod];
    const path = resolve(root, "public", relative.replace(/^\//, ""));
    if (!existsSync(path)) {
      console.log(`| ${role} | ${asset.displayNames.red}/${asset.displayNames.black} | ${lod} | MISSING | ${asset.lodBudgets[lod].triangles} | — | — | — | — | — | — |`);
      continue;
    }
    const report = readGlb(path);
    const bytes = statSync(path).size;
    if (lod === "lod1") lod1Bytes += bytes;
    console.log(
      `| ${role} | ${asset.displayNames.red}/${asset.displayNames.black} | ${lod} | ${report.triangles.toLocaleString()} | ` +
        `${asset.lodBudgets[lod].triangles.toLocaleString()} | ${report.joints} | ${report.clips} | ${report.primitives} | ` +
        `${report.meshopt ? "yes" : "no"} | ${asset.dimensions.maxFootprint.toFixed(3)}m | ${(bytes / 1024).toFixed(1)} KiB |`,
    );
  }
}
console.log(`\n- LOD1 roster download: ${(lod1Bytes / 1024).toFixed(1)} KiB`);
console.log("- Known visual boundary: role-specific procedural game assets with stable silhouettes; manual facial sculpt, baked normal detail, embroidery, cloth microfolds, and authored weathering remain an art-polish pass.");
