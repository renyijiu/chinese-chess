/* Project-authored GPL-3.0-only host for the separately inventoried upstream runtime. */
"use strict";

let engine = null;
let objectUrls = [];
let booting = false;

function post(type, value = {}) {
  self.postMessage({ type, ...value });
}

function revokeAssets() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function assetUrl(bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  objectUrls.push(url);
  return url;
}

async function boot(message) {
  if (engine || booting) throw new Error("Master host Worker may boot only once.");
  booting = true;
  const glueUrl = assetUrl(message.assets.glue, "text/javascript");
  const wasmUrl = assetUrl(message.assets.wasm, "application/wasm");
  const pthreadUrl = assetUrl(message.assets.pthread, "text/javascript");
  try {
    importScripts(glueUrl);
    if (typeof self.Stockfish !== "function") throw new Error("Stockfish factory was not installed.");
    engine = await self.Stockfish({
      // Pthread workers must import the same verified glue bytes. Without this,
      // Emscripten sees an importScripts-loaded blob with no document script URL
      // and sends an undefined urlOrBlob to stockfish.worker.js.
      mainScriptUrlOrBlob: glueUrl,
      locateFile(name) {
        if (name.endsWith(".wasm")) return wasmUrl;
        if (name.endsWith(".worker.js")) return pthreadUrl;
        throw new Error(`Unexpected Fairy-Stockfish runtime request: ${name}`);
      },
      onExit(code) {
        post("exit", { code });
      },
    });
    engine.FS.writeFile(message.networkPath, new Uint8Array(message.assets.network));
    engine.addMessageListener((output) => {
      for (const line of String(output).split(/\r?\n/)) {
        if (line.length > 0) post("line", { line });
      }
    });
    post("booted");
  } catch (error) {
    engine = null;
    revokeAssets();
    post("boot-error", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    booting = false;
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "boot") {
    void boot(message);
    return;
  }
  if (message.type === "command" && engine && typeof message.line === "string") {
    engine.postMessage(message.line);
    return;
  }
  if (message.type === "dispose") {
    try {
      engine?.postMessage("quit");
    } finally {
      engine?.terminate();
      engine = null;
      revokeAssets();
    }
  }
});
