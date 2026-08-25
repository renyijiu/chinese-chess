import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Qin terracotta diorama board", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN" style="/);
  assert.match(html, /--qin-black-lacquer:#171612/);
  assert.match(html, /--qin-hud-text:#eadcc3/);
  assert.match(html, /<title>兵临九宫｜Q 版秦俑 3D 中国象棋<\/title>/);
  assert.match(html, /3D 中国象棋 · 本机双人/);
  assert.match(html, /可玩棋局 · POPULAR V1/);
  assert.match(html, /32 枚棋子按标准阵型列阵/);
  assert.match(html, /开始本机双人对局/);
  assert.match(html, /aria-label="Q 版秦俑沙盘中国象棋棋盘三维预览"/);
  assert.match(html, /俯视棋盘/);
  assert.match(html, /自动巡游/);
  assert.match(html, /换边视角/);
  assert.match(html, /9 纵 × 10 横/);
  assert.match(html, /双九宫 · 楚河汉界/);
  assert.match(html, /32 子 · 红方先行/);
  assert.match(html, /popular-v1 · 本机双人/);
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
  assert.match(game, /createInitialGame/);
  assert.match(game, /dispatch/);
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
  assert.match(page, /XiangqiGame/);
  assert.match(readme, /九道纵线、十道横线/);
  assert.ok(backdrop.size <= 250_000, "the highest-quality Qin panorama should stay below 250 KB");
  assert.ok(basisTranscoder.size > 500_000, "the local Basis transcoder should be self-hosted");
});
