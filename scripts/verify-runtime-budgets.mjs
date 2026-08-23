import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "public/models/pieces/v1/manifest.json"), "utf8"));
const allPaths = new Set();
const lod1Paths = new Set();

for (const role of Object.values(manifest.roles)) {
  for (const variant of Object.values(role.variants)) {
    for (const [lod, assetPath] of Object.entries(variant.lods)) {
      allPaths.add(assetPath);
      if (lod === "lod1") lod1Paths.add(assetPath);
    }
  }
}

async function totalBytes(paths) {
  let bytes = 0;
  for (const assetPath of paths) bytes += (await stat(join(root, "public", assetPath))).size;
  return bytes;
}

const lod1Bytes = await totalBytes(lod1Paths);
const allRuntimeGlbBytes = await totalBytes(allPaths);
const evidence = {
  allRuntimeGlbBytes,
  allRuntimeGlbMiB: Number((allRuntimeGlbBytes / 1024 / 1024).toFixed(2)),
  lod1Bytes,
  lod1MiB: Number((lod1Bytes / 1024 / 1024).toFixed(2)),
  uniqueLod1Assets: lod1Paths.size,
  uniqueRuntimeGlbs: allPaths.size,
};

assert.ok(lod1Bytes <= 8.6 * 1024 * 1024, "LOD1 character runtime exceeds the 8.6 MiB budget");
console.log(JSON.stringify(evidence, null, 2));
