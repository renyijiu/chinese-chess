import { readFileSync, writeFileSync } from "node:fs";

const PNG_SIGNATURE_BYTES = 8;

function stripFileTextChunk(file) {
  const source = readFileSync(file);
  const chunks = [source.subarray(0, PNG_SIGNATURE_BYTES)];
  let offset = PNG_SIGNATURE_BYTES;
  let removed = 0;

  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > source.length) throw new Error(`${file} contains a truncated PNG chunk.`);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    const keywordEnd = type === "tEXt" ? data.indexOf(0) : -1;
    const keyword = keywordEnd >= 0 ? data.toString("latin1", 0, keywordEnd) : "";
    if (type === "tEXt" && keyword === "File") removed += 1;
    else chunks.push(source.subarray(offset, end));
    offset = end;
  }

  if (removed > 0) writeFileSync(file, Buffer.concat(chunks));
  return removed;
}

if (process.argv.length < 3) {
  console.error("Usage: node scripts/assets/strip-png-text-metadata.mjs <png> [...]");
  process.exit(2);
}

let total = 0;
for (const file of process.argv.slice(2)) total += stripFileTextChunk(file);
console.log(`Removed ${total} PNG File metadata chunk(s).`);
