import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AI import boundary", () => {
  it("keeps pure AI modules free of browser and presentation imports", async () => {
    for (const path of [
      "lib/xiangqi/ai/types.ts",
      "lib/xiangqi/ai/protocol.ts",
      "lib/xiangqi/ai/lightweight.ts",
      "lib/xiangqi/ai/index.ts",
    ]) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/components\/|react|document\.|window\.|Worker|CacheStorage/);
    }
  });

  it("does not pull the Worker entry into the public rules barrel", async () => {
    const source = await readFile("lib/xiangqi/index.ts", "utf8");
    expect(source).not.toContain("lightweight.worker");
    expect(source).not.toContain("./ai");
  });

  it("keeps the module entry on the bounded batched runner and its default task yield", async () => {
    const source = await readFile("lib/xiangqi/ai/lightweight.worker.ts", "utf8");
    expect(source).toContain("runLightweightSearchBatched");
    expect(source).toContain("batchNodes: LIGHTWEIGHT_BATCH_NODES");
    expect(source).not.toContain("yieldTask:");
  });
});
