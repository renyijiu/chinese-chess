import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const CLIENT_ROOT = resolve("dist/client");
const MANIFEST_PATH = resolve(CLIENT_ROOT, ".vite/manifest.json");
const GAME_ENTRY = "components/xiangqi/XiangqiGame.tsx";
const OPTIONAL_ENTRIES = [
  "components/xiangqi/ai/MasterEngineAdapter.ts",
  "components/xiangqi/ai/LightweightWorkerProvider.ts",
  "components/xiangqi/online/OnlineMatchSession.ts",
];

const PRIMARY_CHUNK_BUDGET = Object.freeze({
  rawBytes: 1_400_000,
  gzipBytes: 390_000,
});
const INITIAL_GAME_BUDGET = Object.freeze({
  rawBytes: 1_700_000,
  gzipBytes: 490_000,
});

function getEntry(manifest, key) {
  const entry = manifest[key];
  if (!entry || typeof entry !== "object" || typeof entry.file !== "string") {
    throw new Error(`Missing JavaScript manifest entry: ${key}`);
  }
  return entry;
}

export function collectStaticChunkKeys(manifest, entryKey) {
  const keys = new Set();
  const visit = (key) => {
    if (keys.has(key)) return;
    keys.add(key);
    const entry = getEntry(manifest, key);
    for (const importedKey of entry.imports ?? []) visit(importedKey);
  };
  visit(entryKey);
  return keys;
}

export function assertOptionalChunksAreDynamic(manifest, entryKey, optionalEntries) {
  const entry = getEntry(manifest, entryKey);
  const dynamicImports = new Set(entry.dynamicImports ?? []);
  const staticImports = collectStaticChunkKeys(manifest, entryKey);
  for (const optionalEntry of optionalEntries) {
    getEntry(manifest, optionalEntry);
    if (!dynamicImports.has(optionalEntry) || staticImports.has(optionalEntry)) {
      throw new Error(`${optionalEntry} must remain a dynamic import of ${entryKey}`);
    }
  }
}

export function evaluateBudget(actual, budget) {
  const failures = [];
  if (actual.rawBytes > budget.rawBytes) {
    failures.push(`raw JavaScript is ${actual.rawBytes} bytes; budget is ${budget.rawBytes} bytes`);
  }
  if (actual.gzipBytes > budget.gzipBytes) {
    failures.push(`gzip JavaScript is ${actual.gzipBytes} bytes; budget is ${budget.gzipBytes} bytes`);
  }
  return failures;
}

function createChunkMeasurer(manifest) {
  const measurements = new Map();
  const measureChunk = (key) => {
    const cached = measurements.get(key);
    if (cached) return cached;
    const pending = (async () => {
      const entry = getEntry(manifest, key);
      const filePath = resolve(CLIENT_ROOT, entry.file);
      if (!filePath.startsWith(`${CLIENT_ROOT}${sep}`)) {
        throw new Error(`Manifest asset escapes the client output directory: ${entry.file}`);
      }
      const contents = await readFile(filePath);
      return {
        rawBytes: contents.byteLength,
        gzipBytes: gzipSync(contents).byteLength,
      };
    })();
    measurements.set(key, pending);
    return pending;
  };

  return async (keys) => {
    const chunks = await Promise.all([...keys].map(measureChunk));
    return chunks.reduce((total, chunk) => ({
      rawBytes: total.rawBytes + chunk.rawBytes,
      gzipBytes: total.gzipBytes + chunk.gzipBytes,
    }), { rawBytes: 0, gzipBytes: 0 });
  };
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  assertOptionalChunksAreDynamic(manifest, GAME_ENTRY, OPTIONAL_ENTRIES);

  const measureChunks = createChunkMeasurer(manifest);
  const [primary, initial] = await Promise.all([
    measureChunks([GAME_ENTRY]),
    measureChunks(collectStaticChunkKeys(manifest, GAME_ENTRY)),
  ]);
  const failures = [
    ...evaluateBudget(primary, PRIMARY_CHUNK_BUDGET).map((message) => `Primary game chunk ${message}.`),
    ...evaluateBudget(initial, INITIAL_GAME_BUDGET).map((message) => `Initial game closure ${message}.`),
  ];
  if (failures.length > 0) throw new Error(failures.join("\n"));

  console.log("JavaScript budget validation passed.");
  console.log(`Primary game chunk: ${formatKiB(primary.rawBytes)} raw / ${formatKiB(primary.gzipBytes)} gzip`);
  console.log(`Initial game closure: ${formatKiB(initial.rawBytes)} raw / ${formatKiB(initial.gzipBytes)} gzip`);
  console.log(`Optional dynamic chunks: ${OPTIONAL_ENTRIES.length}`);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
