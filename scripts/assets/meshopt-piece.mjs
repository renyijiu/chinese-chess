#!/usr/bin/env node

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { reorder } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/assets/meshopt-piece.mjs <input.glb> <output.glb>");
  process.exit(2);
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const document = await io.read(input);
await document.transform(reorder({ encoder: MeshoptEncoder, target: "size" }));
document.createExtension(EXTMeshoptCompression)
  .setRequired(true)
  // QUANTIZE here names Meshopt's lossless byte-stream path; this script does
  // not run glTF Transform's quantize() transform, so meter-scale POSITION and
  // spec-valid FLOAT NORMAL/COLOR accessors remain unchanged.
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, document);
