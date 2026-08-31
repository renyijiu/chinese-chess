import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOptionalChunksAreDynamic,
  collectStaticChunkKeys,
  evaluateBudget,
} from "../scripts/verify-javascript-budget.mjs";

const entry = "components/xiangqi/XiangqiGame.tsx";
const optionalEntries = [
  "components/xiangqi/ai/MasterEngineAdapter.ts",
  "components/xiangqi/ai/LightweightWorkerProvider.ts",
  "components/xiangqi/online/OnlineMatchSession.ts",
];

test("collects only the static import closure", () => {
  const manifest = {
    [entry]: {
      file: "game.js",
      imports: ["framework.js", "shared.js"],
      dynamicImports: optionalEntries,
    },
    "framework.js": { file: "framework.js", imports: ["runtime.js"] },
    "shared.js": { file: "shared.js" },
    "runtime.js": { file: "runtime.js" },
    [optionalEntries[0]]: { file: "master.js", imports: ["shared.js"] },
    [optionalEntries[1]]: { file: "lightweight.js", imports: [entry] },
    [optionalEntries[2]]: { file: "online.js", imports: ["shared.js"] },
  };

  assert.deepEqual(
    [...collectStaticChunkKeys(manifest, entry)].sort(),
    [entry, "framework.js", "runtime.js", "shared.js"].sort(),
  );
  assert.doesNotThrow(() => assertOptionalChunksAreDynamic(manifest, entry, optionalEntries));
});

test("rejects an optional feature that leaks into the static closure", () => {
  const manifest = {
    [entry]: {
      file: "game.js",
      imports: [optionalEntries[0]],
      dynamicImports: optionalEntries.slice(1),
    },
    [optionalEntries[0]]: { file: "master.js" },
    [optionalEntries[1]]: { file: "lightweight.js" },
    [optionalEntries[2]]: { file: "online.js" },
  };

  assert.throws(
    () => assertOptionalChunksAreDynamic(manifest, entry, optionalEntries),
    /must remain a dynamic import/,
  );
});

test("reports each exceeded JavaScript threshold", () => {
  assert.deepEqual(
    evaluateBudget({ rawBytes: 101, gzipBytes: 51 }, { rawBytes: 100, gzipBytes: 50 }),
    [
      "raw JavaScript is 101 bytes; budget is 100 bytes",
      "gzip JavaScript is 51 bytes; budget is 50 bytes",
    ],
  );
});
