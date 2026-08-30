export const MASTER_ENGINE_MANIFEST_URL = "/engines/fairy-stockfish-nnue/1.1.12/manifest.json";
export const MASTER_ENGINE_CACHE_PREFIX = "xiangqi-master:";
export const MASTER_ENGINE_MANIFEST_SHA256 = "e12efd8c9f9e28ac2dc8257bc47e16800b5ec4c0d95e28bde45132d01034edd6";

const REQUIRED_ENGINE_FILES = [
  "stockfish.js",
  "stockfish.wasm",
  "stockfish.worker.js",
  "xiangqi-c07e94a5c7cb.nnue",
] as const;

type RequiredEngineFile = (typeof REQUIRED_ENGINE_FILES)[number];

export type MasterRuntimeFile = Readonly<{
  name: string;
  role: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export type MasterEngineManifest = Readonly<{
  schema: "xiangqi-engine-assets/v1";
  engineId: string;
  version: string;
  runtimeBaseUrl: string;
  runtimeFiles: readonly MasterRuntimeFile[];
}>;

export type VerifiedMasterAssets = Readonly<{
  cacheName: string;
  manifest: MasterEngineManifest;
  files: Readonly<Record<RequiredEngineFile, ArrayBuffer>>;
}>;

export interface MasterCacheLike {
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
}

export interface MasterCacheStorageLike {
  delete(cacheName: string): Promise<boolean>;
  keys(): Promise<string[]>;
  open(cacheName: string): Promise<MasterCacheLike>;
}

export type MasterEngineAssetLoaderOptions = Readonly<{
  baseUrl?: string;
  cacheStorage?: MasterCacheStorageLike;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  digest?: (bytes: ArrayBuffer) => Promise<string>;
  fetchTimeoutMs?: number;
}>;

const inFlightLoads = new WeakMap<object, Map<string, Promise<VerifiedMasterAssets>>>();

const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function parseRuntimeFile(value: unknown): MasterRuntimeFile {
  if (!isRecord(value) || !exactKeys(value, ["name", "role", "mimeType", "bytes", "sha256"])) {
    throw new Error("Master manifest contains an invalid runtime file record.");
  }
  if (
    typeof value.name !== "string"
    || value.name.includes("/")
    || value.name.includes("\\")
    || value.name.includes("..")
    || typeof value.role !== "string"
    || typeof value.mimeType !== "string"
    || !Number.isInteger(value.bytes)
    || (value.bytes as number) <= 0
    || typeof value.sha256 !== "string"
    || !SHA256.test(value.sha256)
  ) throw new Error("Master manifest contains unsafe runtime metadata.");
  return Object.freeze({
    name: value.name,
    role: value.role,
    mimeType: value.mimeType,
    bytes: value.bytes as number,
    sha256: value.sha256,
  });
}

export function parseMasterEngineManifest(value: unknown): MasterEngineManifest {
  if (!isRecord(value)) throw new Error("Master engine manifest is not an object.");
  const requiredKeys = [
    "schema",
    "engineId",
    "version",
    "license",
    "variant",
    "runtimeBaseUrl",
    "requirements",
    "runtimeFiles",
    "provenance",
  ];
  if (!exactKeys(value, requiredKeys)) throw new Error("Master engine manifest fields differ from v1.");
  if (
    value.schema !== "xiangqi-engine-assets/v1"
    || value.engineId !== "fairy-stockfish-nnue"
    || value.version !== "1.1.12"
    || value.license !== "GPL-3.0-only"
    || value.variant !== "xiangqi"
    || value.runtimeBaseUrl !== "/engines/fairy-stockfish-nnue/1.1.12/"
    || !isRecord(value.requirements)
    || Object.values(value.requirements).some((requirement) => requirement !== true)
    || !Array.isArray(value.runtimeFiles)
  ) throw new Error("Master engine manifest identity or capability contract is invalid.");

  const runtimeFiles = value.runtimeFiles.map(parseRuntimeFile);
  const names = new Set(runtimeFiles.map((file) => file.name));
  if (names.size !== runtimeFiles.length || REQUIRED_ENGINE_FILES.some((name) => !names.has(name))) {
    throw new Error("Master engine manifest is missing a required runtime file.");
  }
  return Object.freeze({
    schema: "xiangqi-engine-assets/v1",
    engineId: value.engineId,
    version: value.version,
    runtimeBaseUrl: value.runtimeBaseUrl,
    runtimeFiles: Object.freeze(runtimeFiles),
  });
}

async function defaultDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedMime(value: string | null): string {
  return value?.trim().toLowerCase().replace(/\s*;\s*/g, "; ") ?? "";
}

async function fetchWithTimeout(
  fetcher: NonNullable<MasterEngineAssetLoaderOptions["fetcher"]>,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Master engine asset request timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function verifyRuntimeResponse(
  response: Response,
  record: MasterRuntimeFile,
  digest: (bytes: ArrayBuffer) => Promise<string>,
): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error(`${record.name} returned HTTP ${response.status}.`);
  const actualMime = normalizedMime(response.headers.get("content-type"));
  if (actualMime.startsWith("text/html")) {
    throw new Error(`${record.name} fell through to application HTML.`);
  }
  if (actualMime !== normalizedMime(record.mimeType)) {
    throw new Error(`${record.name} MIME differs: expected ${record.mimeType}; got ${actualMime || "missing"}.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== record.bytes) {
    throw new Error(`${record.name} byte count differs: expected ${record.bytes}; got ${bytes.byteLength}.`);
  }
  if (await digest(bytes) !== record.sha256) throw new Error(`${record.name} SHA-256 differs.`);
  return bytes;
}

function resolveBaseUrl(baseUrl?: string): string {
  if (baseUrl) return new URL(baseUrl).origin;
  if (typeof location !== "undefined") return location.origin;
  throw new Error("Master engine loading requires an explicit same-origin base URL.");
}

function cacheKey(origin: string, manifest: MasterEngineManifest, manifestHash: string): string {
  return `${MASTER_ENGINE_CACHE_PREFIX}${manifest.engineId}:${manifest.version}:${manifestHash}`;
}

async function deleteEngineCaches(
  cacheStorage: MasterCacheStorageLike,
  keep: string | null,
): Promise<void> {
  const cacheNames = await cacheStorage.keys();
  await Promise.all(cacheNames
    .filter((name) => name.startsWith(MASTER_ENGINE_CACHE_PREFIX) && name !== keep)
    .map((name) => cacheStorage.delete(name)));
}

async function readCompleteCache(
  cache: MasterCacheLike,
  origin: string,
  manifest: MasterEngineManifest,
  digest: (bytes: ArrayBuffer) => Promise<string>,
): Promise<Map<string, ArrayBuffer> | null> {
  const values = new Map<string, ArrayBuffer>();
  let present = 0;
  for (const record of manifest.runtimeFiles) {
    const url = new URL(record.name, new URL(manifest.runtimeBaseUrl, origin)).href;
    const response = await cache.match(url);
    if (!response) continue;
    present += 1;
    try {
      values.set(record.name, await verifyRuntimeResponse(response, record, digest));
    } catch {
      return null;
    }
  }
  return present === manifest.runtimeFiles.length ? values : null;
}

function pickRequiredFiles(values: Map<string, ArrayBuffer>): VerifiedMasterAssets["files"] {
  const entries = REQUIRED_ENGINE_FILES.map((name) => {
    const bytes = values.get(name);
    if (!bytes) throw new Error(`Verified Master assets are missing ${name}.`);
    return [name, bytes] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as VerifiedMasterAssets["files"];
}

async function loadVerifiedMasterAssetsUnshared(
  options: MasterEngineAssetLoaderOptions = {},
): Promise<VerifiedMasterAssets> {
  const origin = resolveBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  const cacheStorage = options.cacheStorage ?? globalThis.caches;
  const digest = options.digest ?? defaultDigest;
  const fetchTimeoutMs = Math.max(1, options.fetchTimeoutMs ?? 20_000);
  if (!fetcher) throw new Error("Fetch is unavailable for Master engine assets.");
  if (!cacheStorage) throw new Error("Cache Storage is unavailable for Master engine assets.");

  const manifestUrl = new URL(MASTER_ENGINE_MANIFEST_URL, origin).href;
  const manifestResponse = await fetchWithTimeout(fetcher, manifestUrl, {
    cache: "no-cache",
    credentials: "same-origin",
  }, fetchTimeoutMs);
  if (!manifestResponse.ok) throw new Error(`Master manifest returned HTTP ${manifestResponse.status}.`);
  const manifestMime = normalizedMime(manifestResponse.headers.get("content-type"));
  if (manifestMime !== "application/json; charset=utf-8" && manifestMime !== "application/json") {
    throw new Error(`Master manifest MIME differs: ${manifestMime || "missing"}.`);
  }
  const manifestBytes = await manifestResponse.arrayBuffer();
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("Master engine manifest is not valid JSON.");
  }
  const manifest = parseMasterEngineManifest(manifestValue);
  const manifestHash = await digest(manifestBytes);
  if (manifestHash !== MASTER_ENGINE_MANIFEST_SHA256) {
    throw new Error("Master engine manifest SHA-256 differs from the audited release.");
  }
  const name = cacheKey(origin, manifest, manifestHash);
  await deleteEngineCaches(cacheStorage, name);

  const existingCache = await cacheStorage.open(name);
  const cached = await readCompleteCache(existingCache, origin, manifest, digest);
  if (cached) {
    return Object.freeze({ cacheName: name, manifest, files: pickRequiredFiles(cached) });
  }

  // Any partial or corrupt generation is removed in full. Source responses are
  // verified in memory before a new cache is opened, so failures cannot leave a
  // cache that looks complete on the next activation.
  await cacheStorage.delete(name);
  const fetched = new Map<string, ArrayBuffer>();
  try {
    for (const record of manifest.runtimeFiles) {
      const url = new URL(record.name, new URL(manifest.runtimeBaseUrl, origin)).href;
      const response = await fetchWithTimeout(
        fetcher,
        url,
        { cache: "no-cache", credentials: "same-origin" },
        fetchTimeoutMs,
      );
      fetched.set(record.name, await verifyRuntimeResponse(response, record, digest));
    }
    const cache = await cacheStorage.open(name);
    for (const record of manifest.runtimeFiles) {
      const url = new URL(record.name, new URL(manifest.runtimeBaseUrl, origin)).href;
      const bytes = fetched.get(record.name)!;
      await cache.put(url, new Response(bytes.slice(0), {
        headers: { "content-type": record.mimeType },
      }));
    }
  } catch (error) {
    await cacheStorage.delete(name);
    throw error;
  }
  return Object.freeze({ cacheName: name, manifest, files: pickRequiredFiles(fetched) });
}

function cloneVerifiedAssets(assets: VerifiedMasterAssets): VerifiedMasterAssets {
  return Object.freeze({
    cacheName: assets.cacheName,
    manifest: assets.manifest,
    files: Object.freeze(Object.fromEntries(
      REQUIRED_ENGINE_FILES.map((name) => [name, assets.files[name].slice(0)]),
    )) as VerifiedMasterAssets["files"],
  });
}

export async function loadVerifiedMasterAssets(
  options: MasterEngineAssetLoaderOptions = {},
): Promise<VerifiedMasterAssets> {
  const cacheStorage = options.cacheStorage ?? globalThis.caches;
  if (!cacheStorage) throw new Error("Cache Storage is unavailable for Master engine assets.");
  const key = `${resolveBaseUrl(options.baseUrl)}|${MASTER_ENGINE_MANIFEST_URL}`;
  let loads = inFlightLoads.get(cacheStorage as object);
  if (!loads) {
    loads = new Map();
    inFlightLoads.set(cacheStorage as object, loads);
  }
  let pending = loads.get(key);
  if (!pending) {
    pending = loadVerifiedMasterAssetsUnshared({ ...options, cacheStorage });
    loads.set(key, pending);
    void pending.finally(() => {
      if (loads?.get(key) === pending) loads.delete(key);
    }).catch(() => undefined);
  }
  return cloneVerifiedAssets(await pending);
}
