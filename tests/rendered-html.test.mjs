import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", assetResponse = new Response("Not found", { status: 404 })) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(path, "http://localhost/"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => assetResponse.clone(),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the fullscreen Qin terracotta game", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-embedder-policy"), "require-corp");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN" style="/);
  assert.match(html, /--qin-black-lacquer:#171612/);
  assert.match(html, /--qin-hud-text:#eadcc3/);
  assert.match(html, /<title>兵临九宫｜Q 版秦俑 3D 中国象棋<\/title>/);
  assert.match(html, /board-stage board-stage--fullscreen/);
  assert.match(html, /兵临九宫 · 3D 中国象棋本机双人与人机对局/);
  assert.match(html, /开始本机双人对局/);
  assert.match(html, /aria-label="Q 版秦俑沙盘中国象棋棋盘三维预览"/);
  assert.match(html, /俯视棋盘/);
  assert.match(html, /自动巡游/);
  assert.match(html, /换边视角/);
  assert.doesNotMatch(html, /俑已列阵/);
  assert.doesNotMatch(html, /棋盘规格/);
  assert.doesNotMatch(html, /沙盘设计/);
});

test("serves Master assets with exact MIME, isolation, and version-aware cache policy", async () => {
  const generatedWrangler = JSON.parse(await readFile(
    new URL("../dist/server/wrangler.json", import.meta.url),
    "utf8",
  ));
  assert.equal(generatedWrangler.assets.binding, "ASSETS");
  assert.deepEqual(generatedWrangler.assets.run_worker_first, [
    "/engines/fairy-stockfish-nnue/1.1.12/*",
    "/workers/xiangqi-master-v1.worker.js",
    "/_next/static/lightweight.worker-*.js",
  ]);

  const wasm = await render(
    "/engines/fairy-stockfish-nnue/1.1.12/stockfish.wasm",
    new Response(new Uint8Array([0, 97, 115, 109]), {
      headers: { "content-type": "application/octet-stream", "x-upstream": "kept" },
    }),
  );
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get("content-type"), "application/wasm");
  assert.equal(wasm.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(wasm.headers.get("x-upstream"), "kept");
  assert.equal(wasm.headers.get("cross-origin-embedder-policy"), "require-corp");

  const manifest = await render(
    "/engines/fairy-stockfish-nnue/1.1.12/manifest.json",
    new Response("{}", { headers: { "content-type": "application/json" } }),
  );
  assert.equal(manifest.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(manifest.headers.get("cache-control"), "no-cache, must-revalidate");

  const hostWorker = await render(
    "/workers/xiangqi-master-v1.worker.js",
    new Response("self.onmessage = () => {};", { headers: { "content-type": "text/plain" } }),
  );
  assert.equal(hostWorker.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(hostWorker.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const lightweightWorker = await render(
    "/_next/static/lightweight.worker-AbC_123.js",
    new Response("self.onmessage = () => {};", { headers: { "content-type": "text/plain" } }),
  );
  assert.equal(lightweightWorker.status, 200);
  assert.equal(lightweightWorker.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(lightweightWorker.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(lightweightWorker.headers.get("cross-origin-embedder-policy"), "require-corp");
});

test("rejects engine HTML fallthrough and preserves missing-asset status", async () => {
  const html = await render(
    "/engines/fairy-stockfish-nnue/1.1.12/stockfish.wasm",
    new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
  );
  assert.equal(html.status, 502);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.equal(html.headers.get("cross-origin-opener-policy"), "same-origin");

  const missing = await render(
    "/engines/fairy-stockfish-nnue/1.1.12/stockfish.wasm",
    new Response("missing", { status: 404, headers: { "x-upstream": "kept" } }),
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-upstream"), "kept");
  assert.equal(missing.headers.get("cross-origin-embedder-policy"), "require-corp");
});

test("keeps the rule-correct board and modular R3F runtime wired", async () => {
  const [
    packageText,
    viewer,
    scene,
    surface,
    boardGeometry,
    environment,
    runtime,
    loader,
    prototype,
    game,
    gameController,
    gameStorage,
    pieceActor,
    pieceCatalog,
    animationDirector,
    presentationStore,
    page,
    gameClient,
    readme,
    backdrop,
    basisTranscoder,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/BoardViewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/scene/BoardScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/scene/BoardSurface.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/scene/board-geometry.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/scene/DioramaEnvironment.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/runtime/board-coordinates.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/pieces/asset-loader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/scene/PrototypeMarshal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/XiangqiGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/game/controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/game/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/pieces/PieceActor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/pieces/piece-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/animation/AnimationDirector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/xiangqi/presentation/PresentationStore.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/XiangqiGameClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    stat(new URL("../public/background/qin-diorama-panorama-v1-high.webp", import.meta.url)),
    stat(new URL("../public/basis/basis_transcoder.wasm", import.meta.url)),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(packageJson.dependencies["@react-three/fiber"], /^\^9\./);
  assert.match(packageJson.dependencies["@react-three/drei"], /^\^10\./);
  assert.match(packageJson.scripts["test:game"], /tests\/unit\/game/);
  assert.match(viewer, /from "@react-three\/fiber"/);
  assert.match(viewer, /frameloop="demand"/);
  assert.match(viewer, /WebGL2/);
  assert.match(scene, /function BoardScene/);
  assert.match(scene, /PieceLayer|PrototypePieceLayer/);
  assert.match(surface, /QIN_DIORAMA_THEME/);
  assert.match(surface, /function QinClayTiles/);
  assert.match(surface, /function QinDoubleEnclosure/);
  assert.match(surface, /function BoardLines/);
  assert.match(surface, /function GlazedRiver/);
  assert.doesNotMatch(surface, /StoneSlabs|WetPatches|makeStone/);
  assert.match(surface, /instancedMesh/);
  assert.match(boardGeometry, /function makeBoardSegments/);
  assert.match(boardGeometry, /function makeBoardOrnamentPlacements/);
  assert.match(environment, /getPanoramaUrl/);
  assert.match(environment, /name="qin-diorama-panorama"/);
  assert.match(environment, /EnvironmentLayerBoundary/);
  assert.match(environment, /QinGradientSky/);
  assert.match(environment, /useScheduledFrame/);
  assert.doesNotMatch(environment, /useTexture/);
  assert.doesNotMatch(environment, /useTexture\.preload/);
  assert.match(runtime, /function squareToWorld/);
  assert.match(runtime, /BOARD_SPACING = 1\.14/);
  assert.match(loader, /setMeshoptDecoder/);
  assert.match(loader, /detectSupport\(gl\)/);
  assert.match(loader, /setTranscoderPath\(BASIS_TRANSCODER_PATH\)/);
  assert.match(prototype, /red-marshal-runtime\.glb/);
  assert.match(game, /BoardViewer/);
  assert.match(game, /createLocalMatch/);
  assert.match(game, /AuthoritativeCommandGate/);
  assert.match(game, /LightweightWorkerProvider/);
  assert.match(game, /GameBoardLayer/);
  assert.match(gameController, /getLegalMoves/);
  assert.match(gameStorage, /GAME_SAVE_BACKUP_KEY/);
  assert.match(gameStorage, /serializeGame/);
  assert.match(pieceActor, /pieceAssetUrl\(piece\.role, lod\)/);
  assert.doesNotMatch(pieceActor, /technical-placeholder/);
  for (const [gameRole, assetRole] of Object.entries({
    general: "marshal", advisor: "advisor", elephant: "elephant", chariot: "chariot",
    horse: "horse", cannon: "cannon", soldier: "soldier",
  })) {
    assert.match(pieceCatalog, new RegExp(`${gameRole}: "${assetRole}"`));
  }
  assert.match(pieceCatalog, /models\/pieces\/v1/);
  assert.match(animationDirector, /useFrame/);
  assert.match(presentationStore, /TimelineDirector/);
  assert.match(page, /XiangqiGameClient/);
  assert.match(gameClient, /dynamic\(\s*\(\) => import\("\.\.\/components\/xiangqi\/XiangqiGame"\)/);
  assert.match(gameClient, /ssr: false/);
  assert.match(gameClient, /loading: LoadingGameShell/);
  assert.match(readme, /九道纵线、十道横线/);
  assert.ok(backdrop.size <= 250_000, "the highest-quality Qin panorama should stay below 250 KB");
  assert.ok(basisTranscoder.size > 500_000, "the local Basis transcoder should be self-hosted");
});
