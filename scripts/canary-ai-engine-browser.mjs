#!/usr/bin/env node

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { validateAiEngineAssets } from "./verify-ai-engine-assets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_ROOT = resolve(ROOT, "public/engines/fairy-stockfish-nnue/1.1.12");
const ENGINE_BASE_PATH = "/engines/fairy-stockfish-nnue/1.1.12/";
const MASTER_HOST_WORKER_PATH = "/workers/xiangqi-master-v1.worker.js";
const MASTER_HOST_WORKER_FILE = resolve(ROOT, "public", MASTER_HOST_WORKER_PATH.slice(1));
const ALLOWED_FILES = new Set([
  "AUTHORS",
  "Copying.txt",
  "manifest.json",
  "stockfish.js",
  "stockfish.wasm",
  "stockfish.worker.js",
  "xiangqi-c07e94a5c7cb.nnue",
]);
const XIANGQI_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
// Derived once from lib/xiangqi getLegalMoves(createInitialGame()) with the
// Fairy coordinate mapping file a-i and project rank + 1. Keeping the list in
// this isolated release canary avoids importing TypeScript application code.
const LEGAL_INITIAL_MOVES = Object.freeze([
  "b1a3", "b1c3", "h1g3", "h1i3",
  "c1a3", "c1e3", "g1e3", "g1i3",
  "d1e2", "f1e2", "e1e2",
  "a4a5", "c4c5", "e4e5", "g4g5", "i4i5",
  "b3a3", "b3c3", "b3d3", "b3e3", "b3f3", "b3g3",
  "b3b2", "b3b4", "b3b5", "b3b6", "b3b7",
  "h3i3", "h3g3", "h3f3", "h3e3", "h3d3", "h3c3",
  "h3h2", "h3h4", "h3h5", "h3h6", "h3h7"
]);

function contentType(path) {
  if (path.endsWith("AUTHORS") || path.endsWith("Copying.txt")) return "text/plain; charset=utf-8";
  const extension = extname(path);
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".nnue") return "application/octet-stream";
  return "application/octet-stream";
}

function canaryPage() {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Fairy-Stockfish Xiangqi canary</title></head>
  <body>Fairy-Stockfish Xiangqi canary</body>
</html>`;
}

function startIsolatedServer() {
  const server = createServer((request, response) => {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url === "/canary") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(canaryPage());
      return;
    }
    if (request.url === MASTER_HOST_WORKER_PATH) {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(readFileSync(MASTER_HOST_WORKER_FILE));
      return;
    }
    const match = request.url?.match(/^\/engines\/fairy-stockfish-nnue\/1\.1\.12\/([^/?#]+)$/);
    if (!match || !ALLOWED_FILES.has(match[1])) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const path = resolve(ENGINE_ROOT, match[1]);
    response.writeHead(200, { "Content-Type": contentType(path) });
    response.end(readFileSync(path));
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Canary server did not receive a TCP port."));
        return;
      }
      resolvePromise({
        close: () => new Promise((done, closeReject) => server.close((error) => error ? closeReject(error) : done())),
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

export async function runAiEngineBrowserCanary(options = {}) {
  const launch = options.launch ?? ((launchOptions) => chromium.launch(launchOptions));
  validateAiEngineAssets({ rootDir: options.rootDir ?? ROOT });
  const localServer = await startIsolatedServer();
  let browser;
  let page;
  const browserErrors = [];
  const requestedOrigins = new Set();
  try {
    browser = await launch({ headless: true });
    page = await browser.newPage();
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("request", (request) => requestedOrigins.add(new URL(request.url()).origin));
    await page.goto(`${localServer.origin}/canary`, { waitUntil: "load", timeout: 15_000 });
    const result = await page.evaluate(async ({ fen, legalInitialMoves, engineBasePath, hostWorkerPath }) => {
      if (!globalThis.isSecureContext) throw new Error("Canary origin is not a secure context.");
      if (!globalThis.crossOriginIsolated) throw new Error("Canary response is not cross-origin isolated.");
      if (typeof SharedArrayBuffer !== "function") throw new Error("SharedArrayBuffer is unavailable.");
      if (typeof WebAssembly !== "object") throw new Error("WebAssembly is unavailable.");
      const transcript = [];
      const manifestResponse = await fetch(`${engineBasePath}manifest.json`, { cache: "no-cache" });
      if (!manifestResponse.ok) throw new Error(`Manifest fetch failed with ${manifestResponse.status}.`);
      const manifest = await manifestResponse.json();
      if (!Array.isArray(manifest.runtimeFiles)) throw new Error("Master manifest has no runtime files.");
      const files = new Map();
      for (const record of manifest.runtimeFiles) {
        const assetResponse = await fetch(`${engineBasePath}${record.name}`, { cache: "no-cache" });
        if (!assetResponse.ok) throw new Error(`${record.name} fetch failed with ${assetResponse.status}.`);
        const bytes = await assetResponse.arrayBuffer();
        if (bytes.byteLength !== record.bytes) throw new Error(`${record.name} byte count differs from manifest.`);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== record.sha256) throw new Error(`${record.name} SHA-256 differs from manifest.`);
        files.set(record.name, bytes);
      }
      const requiredFiles = ["stockfish.js", "stockfish.wasm", "stockfish.worker.js", "xiangqi-c07e94a5c7cb.nnue"];
      if (requiredFiles.some((name) => !files.has(name))) throw new Error("Master manifest is missing a required host asset.");

      const engine = new Worker(hostWorkerPath, { name: "xiangqi-master-engine-canary", type: "classic" });
      const listeners = new Set();
      let resolveExit = null;
      const lineListener = (event) => {
        const message = event.data;
        if (message?.type === "line" && typeof message.line === "string") {
          transcript.push(message.line);
          for (const listener of [...listeners]) listener(message.line);
        }
        if (message?.type === "exit" && typeof message.code === "number") resolveExit?.(message.code);
      };
      engine.addEventListener("message", lineListener);

      const waitFor = (predicate, label, timeoutMs = 12_000) => new Promise((resolveLine, rejectLine) => {
        const timer = setTimeout(() => {
          listeners.delete(onLine);
          rejectLine(new Error(`Timed out waiting for ${label}. Last output: ${transcript.slice(-8).join(" | ")}`));
        }, timeoutMs);
        const onLine = (line) => {
          const match = predicate(line);
          if (!match) return;
          clearTimeout(timer);
          listeners.delete(onLine);
          resolveLine(match);
        };
        listeners.add(onLine);
      });
      const commandAndWait = (command, predicate, label, timeoutMs) => {
        const pending = waitFor(predicate, label, timeoutMs);
        engine.postMessage({ type: "command", line: command });
        return pending;
      };

      try {
        const booted = new Promise((resolveBoot, rejectBoot) => {
          const timer = setTimeout(() => rejectBoot(new Error("Timed out waiting for Master host Worker boot.")), 20_000);
          const onBoot = (event) => {
            if (event.data?.type === "booted") {
              clearTimeout(timer);
              engine.removeEventListener("message", onBoot);
              resolveBoot();
            } else if (event.data?.type === "boot-error") {
              clearTimeout(timer);
              engine.removeEventListener("message", onBoot);
              rejectBoot(new Error(`Master host Worker boot failed: ${event.data.message}`));
            }
          };
          engine.addEventListener("message", onBoot);
        });
        const glue = files.get("stockfish.js");
        const wasm = files.get("stockfish.wasm");
        const pthread = files.get("stockfish.worker.js");
        const network = files.get("xiangqi-c07e94a5c7cb.nnue");
        const networkBytes = network.byteLength;
        const wasmBytes = wasm.byteLength;
        engine.postMessage({
          type: "boot",
          networkPath: "/xiangqi-c07e94a5c7cb.nnue",
          assets: { glue, wasm, pthread, network },
        }, [glue, wasm, pthread, network]);
        await booted;

        await commandAndWait("uci", (line) => line === "uciok" && line, "uciok");
        if (!transcript.some((line) => /option name UCI_Variant .*\bvar xiangqi\b/.test(line))) {
          throw new Error("UCI_Variant does not advertise Xiangqi.");
        }
        if (!transcript.some((line) => line.startsWith("option name EvalFile "))) {
          throw new Error("Engine does not advertise the EvalFile option.");
        }
        engine.postMessage({ type: "command", line: "setoption name UCI_Variant value xiangqi" });
        engine.postMessage({ type: "command", line: "setoption name EvalFile value /xiangqi-c07e94a5c7cb.nnue" });
        await commandAndWait("isready", (line) => line === "readyok" && line, "readyok after NNUE load", 20_000);

        engine.postMessage({ type: "command", line: `position fen ${fen}` });
        const fenLine = await commandAndWait("d", (line) => {
          const match = line.match(/(?:^|\n)Fen: ([^\n]+)/);
          return match?.[1] ?? false;
        }, "FEN round trip");
        if (fenLine.trim() !== fen) throw new Error(`FEN round trip differs: ${fenLine}`);

        const firstBestmove = await commandAndWait("go depth 1", (line) => {
          const match = line.match(/^bestmove ([a-i](?:10|[1-9])[a-i](?:10|[1-9]))(?:\s|$)/);
          return match?.[1] ?? false;
        }, "legal Xiangqi bestmove", 20_000);
        if (!legalInitialMoves.includes(firstBestmove)) {
          throw new Error(`Bestmove is not legal in the fixed initial Xiangqi position: ${firstBestmove}`);
        }

        engine.postMessage({ type: "command", line: `position fen ${fen} moves ${firstBestmove}` });
        const appliedFen = await commandAndWait("d", (line) => {
          const match = line.match(/(?:^|\n)Fen: ([^\n]+)/);
          return match?.[1] ?? false;
        }, "FEN after bestmove");
        if (appliedFen.trim() === fen || !/ b - - /.test(appliedFen)) {
          throw new Error(`Engine did not accept its bestmove as legal: ${firstBestmove}; ${appliedFen}`);
        }

        engine.postMessage({ type: "command", line: `position fen ${fen}` });

        const searching = commandAndWait("go infinite", (line) => /^info .*\bdepth \d+/.test(line) && line, "infinite-search info", 20_000);
        await searching;
        const stoppedBestmove = waitFor((line) => {
          const match = line.match(/^bestmove ([a-i](?:10|[1-9])[a-i](?:10|[1-9]))(?:\s|$)/);
          return match?.[1] ?? false;
        }, "bestmove after stop", 12_000);
        engine.postMessage({ type: "command", line: "stop" });
        const stopMove = await stoppedBestmove;
        if (!legalInitialMoves.includes(stopMove)) {
          throw new Error(`Stopped bestmove is not legal in the fixed initial Xiangqi position: ${stopMove}`);
        }

        let exitCode;
        try {
          exitCode = await new Promise((resolveCode, rejectExit) => {
            const timer = setTimeout(() => rejectExit(new Error("Engine did not exit after quit.")), 8_000);
            resolveExit = (code) => {
              clearTimeout(timer);
              resolveCode(code);
            };
            engine.postMessage({ type: "command", line: "quit" });
          });
        } finally {
          resolveExit = null;
        }
        return {
          crossOriginIsolated: globalThis.crossOriginIsolated,
          exitCode,
          appliedFen,
          firstBestmove,
          networkBytes,
          readyok: transcript.includes("readyok"),
          stopMove,
          transcriptTail: transcript.slice(-10),
          uciok: transcript.includes("uciok"),
          wasmBytes,
        };
      } finally {
        engine.removeEventListener("message", lineListener);
        engine.postMessage({ type: "dispose" });
        engine.terminate();
      }
    }, {
      engineBasePath: ENGINE_BASE_PATH,
      fen: XIANGQI_FEN,
      hostWorkerPath: MASTER_HOST_WORKER_PATH,
      legalInitialMoves: LEGAL_INITIAL_MOVES,
    });

    // The upstream minified browser build deliberately calls
    // emscripten_force_exit(0) for `quit`, which Chromium reports as the
    // minified ExitStatus constructor (`ua`) after onExit has delivered 0.
    const unexpectedBrowserErrors = browserErrors.filter((message) => result.exitCode !== 0 || !/^(?:ua|ExitStatus)/.test(message));
    if (unexpectedBrowserErrors.length > 0) throw new Error(`Browser page errors: ${unexpectedBrowserErrors.join(" | ")}`);
    for (const origin of requestedOrigins) {
      if (origin !== localServer.origin) throw new Error(`Canary attempted an unexpected network origin: ${origin}`);
    }
    if (!result.uciok || !result.readyok || !result.firstBestmove || !result.stopMove || result.exitCode !== 0) {
      throw new Error(`Canary returned an incomplete result: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await localServer.close().catch(() => undefined);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  runAiEngineBrowserCanary().then((result) => {
    console.log("Fairy-Stockfish browser canary passed.");
    console.log(`crossOriginIsolated: ${result.crossOriginIsolated}`);
    console.log(`uciok: ${result.uciok}; readyok: ${result.readyok}`);
    console.log(`NNUE bytes: ${result.networkBytes}`);
    console.log(`bestmove: ${result.firstBestmove}; stopped bestmove: ${result.stopMove}`);
    console.log(`exit code: ${result.exitCode}`);
  }).catch((error) => {
    console.error(`AI ENGINE BROWSER CANARY FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
