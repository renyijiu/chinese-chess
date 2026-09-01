import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MASTER_ENGINE_MANIFEST_URL,
  loadVerifiedMasterAssets,
  type MasterCacheLike,
  type MasterCacheStorageLike,
} from "../../../components/xiangqi/ai/engine-cache";

const ROOT = resolve(import.meta.dirname, "../../..");
const ENGINE_ROOT = resolve(ROOT, "public/engines/fairy-stockfish-nnue/1.1.12");

class MemoryCache implements MasterCacheLike {
  readonly values = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.values.get(String(request))?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.values.set(String(request), response.clone());
  }
}

class MemoryCacheStorage implements MasterCacheStorageLike {
  readonly caches = new Map<string, MemoryCache>();
  readonly deleted: string[] = [];

  async delete(name: string): Promise<boolean> {
    this.deleted.push(name);
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async open(name: string): Promise<MemoryCache> {
    const cache = this.caches.get(name) ?? new MemoryCache();
    this.caches.set(name, cache);
    return cache;
  }
}

async function runtimeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), "https://game.test");
  if (url.pathname === MASTER_ENGINE_MANIFEST_URL) {
    return new Response(await readFile(resolve(ENGINE_ROOT, "manifest.json")), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const name = url.pathname.split("/").at(-1) ?? "";
  const manifest = JSON.parse(await readFile(resolve(ENGINE_ROOT, "manifest.json"), "utf8"));
  const record = manifest.runtimeFiles.find((entry: { name: string }) => entry.name === name);
  if (!record) return new Response("Not found", { status: 404 });
  return new Response(await readFile(resolve(ENGINE_ROOT, name)), {
    headers: { "content-type": record.mimeType },
  });
}

describe("verified Master engine cache", () => {
  it("revalidates the manifest, verifies every runtime byte, and reuses a complete cache", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const fetcher = vi.fn(runtimeFetch);
    const first = await loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher,
    });

    expect(first.manifest.version).toBe("1.1.12");
    expect(first.files["xiangqi-c07e94a5c7cb.nnue"].byteLength).toBe(11_261_932);
    expect(fetcher).toHaveBeenCalledTimes(7);

    const second = await loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher,
    });
    expect(second.cacheName).toBe(first.cacheName);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("single-flights concurrent activation and returns independently transferable bytes", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      return runtimeFetch(input);
    });
    const [first, second] = await Promise.all([
      loadVerifiedMasterAssets({ baseUrl: "https://game.test", cacheStorage, fetcher }),
      loadVerifiedMasterAssets({ baseUrl: "https://game.test", cacheStorage, fetcher }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(7);
    const firstGlue = first.files["stockfish.js"];
    const secondGlue = second.files["stockfish.js"];
    expect(firstGlue).not.toBe(secondGlue);
    expect(firstGlue.byteLength).toBe(secondGlue.byteLength);
    structuredClone(firstGlue, { transfer: [firstGlue] });
    expect(firstGlue.byteLength).toBe(0);
    expect(secondGlue.byteLength).toBeGreaterThan(0);
  });

  it("deletes partial, corrupt, and older cache generations before rebuilding atomically", async () => {
    const cacheStorage = new MemoryCacheStorage();
    cacheStorage.caches.set("xiangqi-master:old", new MemoryCache());
    const first = await loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
    });
    const cache = cacheStorage.caches.get(first.cacheName)!;
    cache.values.delete("https://game.test/engines/fairy-stockfish-nnue/1.1.12/AUTHORS");

    await loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
    });
    expect(cacheStorage.deleted).toContain("xiangqi-master:old");
    expect(cacheStorage.deleted).toContain(first.cacheName);
  });

  it("rejects 404, HTML fallthrough, wrong MIME, and hash corruption without retaining a cache", async () => {
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
      new Response(new Uint8Array([0]), { headers: { "content-type": "application/wasm" } }),
    ]) {
      const cacheStorage = new MemoryCacheStorage();
      const fetcher = async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "https://game.test");
        if (url.pathname.endsWith("stockfish.wasm")) return response.clone();
        return runtimeFetch(input);
      };
      await expect(
        loadVerifiedMasterAssets({
          baseUrl: "https://game.test",
          cacheStorage,
          fetcher,
        }),
      ).rejects.toThrow(/stockfish\.wasm|MIME|HTML|SHA-256|HTTP 404/i);
      expect(cacheStorage.caches.size).toBe(0);
    }
  });

  it("bounds a stalled asset request and clears the partial cache generation", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://game.test");
      if (url.pathname === MASTER_ENGINE_MANIFEST_URL) return runtimeFetch(input);
      return new Promise<Response>(() => undefined);
    });

    await expect(
      loadVerifiedMasterAssets({
        baseUrl: "https://game.test",
        cacheStorage,
        fetcher,
        fetchTimeoutMs: 5,
      }),
    ).rejects.toThrow(/timed out after 5 ms/i);
    expect(cacheStorage.caches.size).toBe(0);
  });
});
