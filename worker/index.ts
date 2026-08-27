/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  DB: unknown;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const ALLOWED_IMAGE_WIDTHS = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];

const ENGINE_BASE_PATH = "/engines/fairy-stockfish-nnue/1.1.12/";
const MASTER_HOST_WORKER_PATH = "/workers/xiangqi-master-v1.worker.js";
const LIGHTWEIGHT_WORKER_PATH = /^\/_next\/static\/lightweight\.worker-[A-Za-z0-9_-]+\.js$/;
const ENGINE_MIME_TYPES = Object.freeze<Record<string, string>>({
  AUTHORS: "text/plain; charset=utf-8",
  "Copying.txt": "text/plain; charset=utf-8",
  "manifest.json": "application/json; charset=utf-8",
  "stockfish.js": "text/javascript; charset=utf-8",
  "stockfish.wasm": "application/wasm",
  "stockfish.worker.js": "text/javascript; charset=utf-8",
  "xiangqi-c07e94a5c7cb.nnue": "application/octet-stream",
});

function withIsolationHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function engineAssetMetadata(pathname: string): Readonly<{
  cacheControl: string;
  mimeType: string;
}> | null {
  if (pathname === MASTER_HOST_WORKER_PATH) {
    return { cacheControl: "public, max-age=31536000, immutable", mimeType: "text/javascript; charset=utf-8" };
  }
  if (LIGHTWEIGHT_WORKER_PATH.test(pathname)) {
    return { cacheControl: "public, max-age=31536000, immutable", mimeType: "text/javascript; charset=utf-8" };
  }
  if (!pathname.startsWith(ENGINE_BASE_PATH)) return null;
  const name = pathname.slice(ENGINE_BASE_PATH.length);
  const mimeType = ENGINE_MIME_TYPES[name];
  if (!mimeType || name.includes("/")) return null;
  return {
    cacheControl: name === "manifest.json"
      ? "no-cache, must-revalidate"
      : "public, max-age=31536000, immutable",
    mimeType,
  };
}

async function fetchEngineAsset(request: Request, env: Env, metadata: Readonly<{
  cacheControl: string;
  mimeType: string;
}>): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (!response.ok) return withIsolationHeaders(response);
  const sourceMime = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (sourceMime.startsWith("text/html")) {
    return withIsolationHeaders(new Response("Engine asset unexpectedly resolved to HTML.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    }));
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Type", metadata.mimeType);
  headers.set("Cache-Control", metadata.cacheControl);
  return withIsolationHeaders(new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  }));
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const engineMetadata = engineAssetMetadata(url.pathname);
    if (engineMetadata) return fetchEngineAsset(request, env, engineMetadata);
    if (url.pathname.startsWith(ENGINE_BASE_PATH)) {
      return withIsolationHeaders(new Response("Unknown engine asset.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      }));
    }

    if (url.pathname === "/_vinext/image") {
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, ALLOWED_IMAGE_WIDTHS);
      return withIsolationHeaders(response);
    }

    return withIsolationHeaders(await handler.fetch(request, env, ctx));
  },
};

export default worker;
