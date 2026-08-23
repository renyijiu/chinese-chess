#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateBytes } from "gltf-validator";

import { LODS, ROLE_NAMES } from "./piece-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(root, "public/models/pieces/v1/manifest.json");
const requiredNodes = [
  "piece_root",
  "rig_root",
  "character_mesh",
  "socket_attack_origin",
  "socket_hit_center",
  "socket_ground",
  "socket_trail_start",
  "socket_trail_end",
];
const requiredClips = [
  "idle_loop",
  "move_start",
  "move_loop",
  "move_end",
  "attack_primary",
  "hit_react",
  "destroy",
];
const semanticReferences = [
  ["faction_cloth_primary", [0.25, 0.018, 0.01]],
  ["faction_cloth_secondary", [0.065, 0.008, 0.006]],
  ["faction_trim", [0.38, 0.18, 0.035]],
  ["aged_bronze", [0.16, 0.078, 0.025]],
  ["faction_cloth_primary", [0.19, 0.014, 0.009]],
  ["faction_cloth_secondary", [0.055, 0.009, 0.007]],
  ["faction_trim", [0.28, 0.14, 0.035]],
  ["aged_bronze", [0.115, 0.068, 0.028]],
];
const factionTargets = {
  red: {
    faction_cloth_primary: [0x72 / 255, 0x14 / 255, 0x0d / 255],
    faction_cloth_secondary: [0x33 / 255, 0x09 / 255, 0x06 / 255],
    faction_trim: [0xb8 / 255, 0x7b / 255, 0x20 / 255],
    aged_bronze: [0x70 / 255, 0x42 / 255, 0x18 / 255],
  },
  black: {
    faction_cloth_primary: [0x0d / 255, 0x29 / 255, 0x23 / 255],
    faction_cloth_secondary: [0x07 / 255, 0x15 / 255, 0x11 / 255],
    faction_trim: [0x53 / 255, 0x7b / 255, 0x66 / 255],
    aged_bronze: [0x35 / 255, 0x5d / 255, 0x4e / 255],
  },
};
const semanticDistanceSquared = 0.00018;

function fail(message) {
  throw new Error(message);
}

function readJson(path, label = path) {
  if (!existsSync(path)) fail(`Missing ${label}: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function readGlb(path) {
  if (!existsSync(path)) fail(`Missing GLB: ${path}`);
  const buffer = readFileSync(path);
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") {
    fail(`Not a GLB 2.0 file: ${path}`);
  }
  if (buffer.readUInt32LE(4) !== 2) fail(`Unsupported GLB version: ${path}`);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) {
    fail(`GLB byteLength mismatch: ${path} declares ${declaredLength}, has ${buffer.length}`);
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) fail(`GLB has no JSON chunk: ${path}`);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trimEnd());
  const binHeader = 20 + jsonLength;
  let binary = Buffer.alloc(0);
  if (binHeader + 8 <= buffer.length && buffer.readUInt32LE(binHeader + 4) === 0x004e4942) {
    const binaryLength = buffer.readUInt32LE(binHeader);
    binary = buffer.subarray(binHeader + 8, binHeader + 8 + binaryLength);
  }
  return { gltf, binary };
}

function readGlbJson(path) {
  return readGlb(path).gltf;
}

function readVec3Accessor(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "VEC3" || accessor.componentType !== 5126) {
    fail(`Expected FLOAT VEC3 accessor ${accessorIndex} for root translation validation`);
  }
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view || view.extensions?.EXT_meshopt_compression) {
    fail(`Root translation validation requires the uncompressed authoring GLB accessor ${accessorIndex}`);
  }
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const values = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const start = offset + index * stride;
    values.push([binary.readFloatLE(start), binary.readFloatLE(start + 4), binary.readFloatLE(start + 8)]);
  }
  return values;
}

function readColorAccessor(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "VEC3" || ![5121, 5126].includes(accessor.componentType)) {
    fail(`COLOR_0 must be a FLOAT or normalized UNSIGNED_BYTE VEC3 accessor`);
  }
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view || view.extensions?.EXT_meshopt_compression) {
    fail(`Faction coverage validation requires an uncompressed authoring COLOR_0 accessor`);
  }
  const componentBytes = accessor.componentType === 5126 ? 4 : 1;
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? componentBytes * 3;
  const colors = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const start = offset + index * stride;
    colors.push(accessor.componentType === 5126
      ? [binary.readFloatLE(start), binary.readFloatLE(start + 4), binary.readFloatLE(start + 8)]
      : [binary[start] / 255, binary[start + 1] / 255, binary[start + 2] / 255]);
  }
  return colors;
}

function squaredDistance(left, right) {
  return left.reduce((sum, value, axis) => sum + (value - right[axis]) ** 2, 0);
}

function classifySemantic(color) {
  let best = null;
  let distance = Infinity;
  for (const [region, reference] of semanticReferences) {
    const next = squaredDistance(color, reference);
    if (next < distance) {
      best = region;
      distance = next;
    }
  }
  return distance <= semanticDistanceSquared ? best : null;
}

function validateFactionRemap(gltf, binary, role, lod) {
  const character = (gltf.nodes ?? []).find((node) => node.name === "character_mesh");
  const primitive = gltf.meshes?.[character?.mesh]?.primitives?.[0];
  const colors = readColorAccessor(gltf, binary, primitive?.attributes?.COLOR_0);
  const counts = Object.fromEntries(Object.keys(factionTargets.red).map((region) => [region, 0]));
  let mapped = 0;
  let redBlackDistance = 0;
  for (const color of colors) {
    const region = classifySemantic(color);
    if (!region) continue;
    counts[region] += 1;
    mapped += 1;
    redBlackDistance += Math.sqrt(squaredDistance(factionTargets.red[region], factionTargets.black[region]));
  }
  const populatedRegions = Object.values(counts).filter((count) => count > 0).length;
  if (populatedRegions < 3 || counts.faction_cloth_primary === 0 || counts.faction_trim === 0) {
    fail(`${role}/${lod}: authored COLOR_0 must cover at least three semantic regions including primary cloth and trim`);
  }
  const coverage = mapped / colors.length;
  const averageDistance = redBlackDistance / Math.max(1, mapped);
  // Terracotta remains the dominant material; faction identity is carried by
  // surviving mineral pigment, armour seals and inlays rather than repainting
  // the whole excavated figure. Ten percent is still clearly legible at board
  // distance while preserving the Qin archaeological art direction. The LOD2
  // general retains 9.3%, so 7.5% is the hard floor across simplified meshes.
  if (coverage < 0.075 || averageDistance < 0.22) {
    fail(`${role}/${lod}: faction RGB remap is not visually significant (coverage=${coverage.toFixed(3)}, distance=${averageDistance.toFixed(3)})`);
  }
  return { averageDistance, coverage };
}

function triangleCount(gltf) {
  let total = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      if (mode !== 4) fail(`Only TRIANGLES primitives are allowed; found mode ${mode}`);
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = gltf.accessors?.[accessorIndex]?.count ?? 0;
      total += Math.floor(count / 3);
    }
  }
  return total;
}

function geometryBounds(gltf) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) fail("POSITION accessor must include min/max bounds");
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis]);
      }
    }
  }
  return { min, max };
}

function validateManifest(manifest) {
  if (manifest.schema !== "xiangqi-piece-assets/v1") fail("Manifest schema must be xiangqi-piece-assets/v1");
  if (manifest.coordinateSystem?.units !== "meter") fail("Manifest units must be meter");
  if (manifest.coordinateSystem?.up !== "+Y" || manifest.coordinateSystem?.forward !== "+Z") {
    fail("Manifest coordinate system must be +Y up and +Z forward");
  }
  if (manifest.textureCompression?.status !== "not-applicable-no-bitmap-textures") {
    fail("This texture-free vertical slice must explicitly mark KTX2 as not applicable");
  }
  if (manifest.vertexColorEncoding?.accessorType !== "VEC3" || manifest.vertexColorEncoding?.alpha) {
    fail("Faction recoloring must declare COLOR_0 VEC3 RGB classification and must not depend on discarded alpha");
  }
  for (const faction of ["red", "black"]) {
    if (!manifest.factions?.[faction]?.palette) fail(`Missing ${faction} faction palette`);
  }
  for (const role of ROLE_NAMES) {
    if (!manifest.roles?.[role]) fail(`Manifest is missing roles.${role}`);
  }
  for (const role of ROLE_NAMES) {
    const asset = manifest.roles[role];
    if (asset.dimensions?.baseDiameter !== 0.89) fail(`${role} base diameter must be 0.89m`);
    for (const clip of requiredClips) {
      if (!asset.clips?.[clip]) fail(`${role} manifest is missing clip contract ${clip}`);
      for (const marker of asset.clips[clip].markers ?? []) {
        if (typeof marker.name !== "string" || marker.at < 0 || marker.at > 1) {
          fail(`${role} clip ${clip} has an invalid normalized marker`);
        }
      }
    }
    for (const marker of ["telegraph", "release", "recover"]) {
      if (!asset.clips.attack_primary.markers.some((entry) => entry.name === marker)) {
        fail(`${role} attack_primary is missing normalized marker ${marker}`);
      }
    }
    for (const marker of ["fracture", "vanish", "complete"]) {
      if (!asset.clips.destroy.markers.some((entry) => entry.name === marker)) {
        fail(`${role} destroy is missing normalized marker ${marker}`);
      }
    }
    const redPaths = asset.variants?.red?.lods;
    const blackPaths = asset.variants?.black?.lods;
    if (!redPaths || !blackPaths) fail(`${role} must define red and black variants`);
    for (const lod of LODS) {
      if (redPaths[lod] !== blackPaths[lod]) fail(`${role}/${lod} must share geometry between red and black variants`);
    }
  }
  return manifest.roles;
}

function validateNoRootMotion(relativePath, lod) {
  const path = resolve(root, relativePath);
  const { gltf, binary } = readGlb(path);
  const roots = new Set(["piece_root", "rig_root", "root"]);
  for (const animation of gltf.animations ?? []) {
    for (const channel of animation.channels ?? []) {
      const target = channel.target ?? {};
      const nodeName = gltf.nodes?.[target.node]?.name;
      if (target.path === "translation" && roots.has(nodeName)) {
        const sampler = animation.samplers?.[channel.sampler];
        const values = readVec3Accessor(gltf, binary, sampler.output);
        const [initialX, , initialZ] = values[0];
        if (values.some(([x, , z]) => Math.abs(x - initialX) > 1e-5 || Math.abs(z - initialZ) > 1e-5)) {
          fail(`${lod}: clip ${animation.name} has horizontal root motion on ${nodeName}`);
        }
      }
    }
  }
}

async function validateGlb(relativePath, rawRelativePath, role, lod, budget, declaredFootprint) {
  const path = resolve(root, "public", relativePath.replace(/^\//, ""));
  const validator = await validateBytes(new Uint8Array(readFileSync(path)), {
    uri: path,
    maxIssues: 100,
  });
  if (validator.issues.numErrors > 0) {
    const messages = validator.issues.messages
      .filter((issue) => issue.severity === 0)
      .slice(0, 5)
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    fail(`${role}/${lod}: Khronos glTF Validator reported ${validator.issues.numErrors} errors: ${messages}`);
  }
  const gltf = readGlbJson(path);
  const nodeNames = new Set((gltf.nodes ?? []).map((node) => node.name));
  for (const node of requiredNodes) {
    if (!nodeNames.has(node)) fail(`${role}/${lod}: missing required node ${node}`);
  }
  const animations = (gltf.animations ?? []).map((animation) => animation.name).sort();
  const expectedAnimations = [...requiredClips].sort();
  if (JSON.stringify(animations) !== JSON.stringify(expectedAnimations)) {
    fail(`${role}/${lod}: animation clips differ; expected ${expectedAnimations.join(", ")}, got ${animations.join(", ")}`);
  }
  const skinnedNodes = (gltf.nodes ?? []).filter((node) => node.mesh !== undefined && node.skin !== undefined);
  if (skinnedNodes.length !== 1 || skinnedNodes[0].name !== "character_mesh") {
    fail(`${role}/${lod}: expected exactly one skinned character_mesh node, found ${skinnedNodes.length}`);
  }
  const skin = gltf.skins?.[skinnedNodes[0].skin];
  if (!skin || (skin.joints?.length ?? 0) < 10) fail(`${role}/${lod}: expected a preserved skeleton with at least 10 joints`);
  const primitives = (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
  if (primitives.length !== 1) fail(`${role}/${lod}: expected exactly one skinned mesh primitive, found ${primitives.length}`);
  if (primitives[0].attributes?.COLOR_0 === undefined) fail(`${role}/${lod}: single-material primitive must contain COLOR_0`);
  const runtimeColor = gltf.accessors?.[primitives[0].attributes.COLOR_0];
  if (runtimeColor?.type !== "VEC3") fail(`${role}/${lod}: runtime COLOR_0 must remain VEC3`);
  if ((gltf.materials?.length ?? 0) !== 1) fail(`${role}/${lod}: expected exactly one material`);
  const material = gltf.materials[0];
  if ((material.alphaMode ?? "OPAQUE") !== "OPAQUE" || material.doubleSided === true) {
    fail(`${role}/${lod}: vertex palette must be opaque and single-sided`);
  }
  if (material.name !== `${role}_terracotta_vertex_palette`) fail(`${role}/${lod}: unexpected material ${material.name}`);
  const extensions = new Set([...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])]);
  if (!extensions.has("EXT_meshopt_compression")) fail(`${role}/${lod}: runtime GLB is not Meshopt-compressed`);
  if (extensions.has("KHR_draco_mesh_compression")) fail(`${role}/${lod}: Draco is prohibited`);
  if ((gltf.images?.length ?? 0) !== 0 || (gltf.textures?.length ?? 0) !== 0) {
    fail(`${role}/${lod}: bitmap textures require KTX2; this roster declares none`);
  }
  const triangles = triangleCount(gltf);
  if (triangles <= 0 || triangles > budget) fail(`${role}/${lod}: ${triangles} triangles exceeds budget ${budget}`);
  // Meshopt quantization stores integer accessor bounds plus a decode transform;
  // the uncompressed authoring GLB is the authoritative dimensional check.
  const { gltf: rawGltf, binary: rawBinary } = readGlb(resolve(root, rawRelativePath));
  const bounds = geometryBounds(rawGltf);
  const footprint = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  if (footprint < 0.88 || footprint >= 0.98) {
    fail(`${role}/${lod}: footprint ${footprint.toFixed(4)}m must include the 0.89m base and stay below 0.98m`);
  }
  if (footprint - declaredFootprint > 0.006) {
    fail(`${role}/${lod}: measured footprint ${footprint.toFixed(4)}m exceeds manifest maximum ${declaredFootprint}m`);
  }
  if (Math.abs(bounds.min[1]) > 0.006) fail(`${role}/${lod}: base bottom must sit at Y=0; got ${bounds.min[1]}`);
  const runtimeBounds = geometryBounds(gltf);
  const runtimeFootprint = Math.max(
    runtimeBounds.max[0] - runtimeBounds.min[0],
    runtimeBounds.max[2] - runtimeBounds.min[2],
  );
  if (Math.abs(runtimeFootprint - footprint) > 0.006 || runtimeFootprint >= 0.98) {
    fail(`${role}/${lod}: runtime static footprint ${runtimeFootprint.toFixed(4)}m must preserve raw ${footprint.toFixed(4)}m and stay below 0.98m`);
  }
  if (Math.abs(runtimeBounds.min[1]) > 0.006) {
    fail(`${role}/${lod}: runtime base bottom must sit at Y=0; got ${runtimeBounds.min[1]}`);
  }
  if (triangleCount(rawGltf) !== triangles) {
    fail(`${role}/${lod}: runtime triangle count ${triangles} differs from authoring GLB ${triangleCount(rawGltf)}`);
  }
  const factionRemap = validateFactionRemap(rawGltf, rawBinary, role, lod);
  return {
    role,
    lod,
    path,
    bytes: statSync(path).size,
    triangles,
    joints: skin.joints.length,
    animations: animations.length,
    primitives: primitives.length,
    footprint,
    factionRemap,
    height: bounds.max[1] - bounds.min[1],
    validatorWarnings: validator.issues.numWarnings,
  };
}

async function main() {
  const manifest = readJson(manifestPath, "piece manifest");
  const roles = validateManifest(manifest);
  const allResults = [];
  for (const role of ROLE_NAMES) {
    const asset = roles[role];
    const sourceBlend = resolve(root, asset.source.blend);
    if (!existsSync(sourceBlend)) fail(`Missing editable Blender source: ${sourceBlend}`);
    const metadata = readJson(resolve(root, asset.source.metadata), `${role} asset metadata`);
    if (metadata.role !== role) fail(`${role} metadata has mismatched role ${metadata.role}`);
    for (const lod of LODS) validateNoRootMotion(asset.source.rawLods[lod], `${role}/${lod}`);
    const results = await Promise.all(LODS.map((lod) => validateGlb(
      asset.variants.red.lods[lod], asset.source.rawLods[lod], role, lod,
      asset.lodBudgets[lod].triangles, asset.dimensions.maxFootprint,
    )));
    if (!(results[0].triangles > results[1].triangles && results[1].triangles > results[2].triangles)) {
      fail(`${role} triangle counts must decrease by LOD: ${results.map((result) => result.triangles).join(" > ")}`);
    }
    const maximumFootprint = Math.max(...results.map((result) => result.footprint));
    if (Math.abs(maximumFootprint - asset.dimensions.maxFootprint) > 0.006) {
      fail(`${role} manifest maxFootprint ${asset.dimensions.maxFootprint}m differs from measured ${maximumFootprint.toFixed(4)}m`);
    }
    allResults.push(...results);
    for (const result of results) {
      console.log(
        `PASS ${role}/${result.lod}: ${result.triangles} tris, ${result.joints} joints, ${result.animations} clips, ` +
          `${result.primitives} primitive, ${(result.bytes / 1024).toFixed(1)} KiB, ` +
          `${result.footprint.toFixed(3)}m footprint, height=${result.height.toFixed(3)}m, ` +
          `factionCoverage=${(result.factionRemap.coverage * 100).toFixed(0)}%, ` +
          `Khronos warnings=${result.validatorWarnings}`,
      );
    }
  }
  const lod1Signatures = new Set(
    allResults.filter((result) => result.lod === "lod1").map((result) => `${result.triangles}:${result.height.toFixed(3)}`),
  );
  if (lod1Signatures.size !== ROLE_NAMES.length) {
    fail(`Role silhouettes must have distinct LOD1 geometry summaries; found ${lod1Signatures.size}/${ROLE_NAMES.length}`);
  }
  console.log(`PASS asset contract: ${ROLE_NAMES.length} role families / 14 faction variants / ${allResults.length} runtime GLBs; red/black share geometry; KTX2 N/A (no bitmap textures)`);
}

try {
  await main();
} catch (error) {
  console.error(`ASSET VALIDATION FAILED: ${error.message}`);
  process.exitCode = 1;
}
