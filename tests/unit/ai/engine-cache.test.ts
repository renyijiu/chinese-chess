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

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

async function abortAndExpectPromptRejection(
  loading: Promise<unknown>,
  controller: AbortController,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settlementDeadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Cache operation did not settle promptly after abort.")), 250);
  });
  controller.abort();
  try {
    await expect(Promise.race([loading, settlementDeadline])).rejects.toThrow(/cancelled/i);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

  it("rebuilds partial or corrupt current caches without deleting a shared generation", async () => {
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
    expect(cacheStorage.deleted).not.toContain(first.cacheName);
    expect(cache.values.size).toBe(first.manifest.runtimeFiles.length);
  });

  it("rejects 404, HTML fallthrough, wrong MIME, and hash corruption without caching runtime bytes", async () => {
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
      await expect(loadVerifiedMasterAssets({
        baseUrl: "https://game.test",
        cacheStorage,
        fetcher,
      })).rejects.toThrow(/stockfish\.wasm|MIME|HTML|SHA-256|HTTP 404/i);
      expect([...cacheStorage.caches.values()].every((cache) => cache.values.size === 0)).toBe(true);
    }
  });

  it("bounds a stalled asset request and clears the partial cache generation", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://game.test");
      if (url.pathname === MASTER_ENGINE_MANIFEST_URL) {
        const response = await runtimeFetch(input);
        vi.spyOn(response, "arrayBuffer").mockImplementation(() => new Promise<ArrayBuffer>(() => undefined));
        return response;
      }
      return runtimeFetch(input);
    });

    await expect(loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher,
      fetchTimeoutMs: 5,
    })).rejects.toThrow(/timed out after 5 ms/i);
    expect(cacheStorage.caches.size).toBe(0);
  });

  it("aborts a stalled asset request when its owning adapter is cancelled", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    controller.abort();

    await expect(loading).rejects.toThrow(/cancelled/i);
    expect(requestSignal?.aborted).toBe(true);
    expect(cacheStorage.caches.size).toBe(0);
  });

  it("promptly aborts a never-settling CacheStorage keys operation", async () => {
    let reachedKeys = false;
    const cacheStorage: MasterCacheStorageLike = {
      keys: () => {
        reachedKeys = true;
        return neverSettles();
      },
      delete: async () => false,
      open: async () => new MemoryCache(),
    };
    const controller = new AbortController();
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(reachedKeys).toBe(true));
    await abortAndExpectPromptRejection(loading, controller);
  });

  it("bounds a never-settling CacheStorage operation without an owner abort", async () => {
    const cacheStorage: MasterCacheStorageLike = {
      keys: () => neverSettles(),
      delete: async () => false,
      open: async () => new MemoryCache(),
    };

    await expect(loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      fetchTimeoutMs: 5,
    })).rejects.toThrow(/cache listing timed out after 5 ms/i);
  });

  it("promptly aborts a never-settling CacheStorage open operation", async () => {
    let reachedOpen = false;
    const cacheStorage: MasterCacheStorageLike = {
      keys: async () => [],
      delete: async () => false,
      open: () => {
        reachedOpen = true;
        return neverSettles();
      },
    };
    const controller = new AbortController();
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(reachedOpen).toBe(true));
    await abortAndExpectPromptRejection(loading, controller);
  });

  it("promptly aborts a never-settling cache match operation", async () => {
    let reachedMatch = false;
    const cache: MasterCacheLike = {
      match: () => {
        reachedMatch = true;
        return neverSettles();
      },
      put: async () => undefined,
    };
    const cacheStorage: MasterCacheStorageLike = {
      keys: async () => [],
      delete: async () => false,
      open: async () => cache,
    };
    const controller = new AbortController();
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(reachedMatch).toBe(true));
    await abortAndExpectPromptRejection(loading, controller);
  });

  it("promptly aborts a never-settling cache put operation", async () => {
    let reachedPut = false;
    let deleteCalls = 0;
    const cache: MasterCacheLike = {
      match: async () => undefined,
      put: () => {
        reachedPut = true;
        return neverSettles();
      },
    };
    const cacheStorage: MasterCacheStorageLike = {
      keys: async () => [],
      delete: async () => {
        deleteCalls += 1;
        return true;
      },
      open: async () => cache,
    };
    const controller = new AbortController();
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(reachedPut).toBe(true));
    await abortAndExpectPromptRejection(loading, controller);
    expect(deleteCalls).toBe(0);
  });

  it("promptly aborts a never-settling manifest digest", async () => {
    let reachedDigest = false;
    const controller = new AbortController();
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage: new MemoryCacheStorage(),
      digest: () => {
        reachedDigest = true;
        return neverSettles();
      },
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(reachedDigest).toBe(true));
    await abortAndExpectPromptRejection(loading, controller);
  });

  it("promptly aborts a never-settling cached response body read", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const primed = await loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
    });
    const currentCache = cacheStorage.caches.get(primed.cacheName)!;
    let reachedBodyRead = false;
    const originalMatch = currentCache.match.bind(currentCache);
    vi.spyOn(currentCache, "match").mockImplementation(async (request) => {
      const response = await originalMatch(request);
      if (response && !reachedBodyRead) {
        reachedBodyRead = true;
        vi.spyOn(response, "arrayBuffer").mockImplementation(() => neverSettles());
      }
      return response;
    });
    const controller = new AbortController();
    const loading = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(reachedBodyRead).toBe(true));
    await abortAndExpectPromptRejection(loading, controller);
  });

  it("does not let an abandoned late cache open delete a newer successful generation", async () => {
    const cacheStorage = new MemoryCacheStorage();
    const lateCache = new MemoryCache();
    let resolveFirstOpen: ((cache: MemoryCache) => void) | undefined;
    let openCalls = 0;
    vi.spyOn(cacheStorage, "open").mockImplementation(async (name) => {
      openCalls += 1;
      if (openCalls === 1) {
        return new Promise<MemoryCache>((resolveOpen) => {
          resolveFirstOpen = resolveOpen;
        });
      }
      const cache = cacheStorage.caches.get(name) ?? new MemoryCache();
      cacheStorage.caches.set(name, cache);
      return cache;
    });
    const controller = new AbortController();
    const abandoned = loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveFirstOpen).toBeDefined());
    await abortAndExpectPromptRejection(abandoned, controller);
    const current = await loadVerifiedMasterAssets({
      baseUrl: "https://game.test",
      cacheStorage,
      fetcher: runtimeFetch,
      signal: new AbortController().signal,
    });
    resolveFirstOpen?.(lateCache);
    await Promise.resolve();

    expect(cacheStorage.deleted).not.toContain(current.cacheName);
    expect(cacheStorage.caches.get(current.cacheName)?.values.size).toBe(current.manifest.runtimeFiles.length);
  });
});
