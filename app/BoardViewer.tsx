"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import type { AnimationRegistry } from "../components/xiangqi/animation/AnimationRegistry";
import type { AudioEngine } from "../components/xiangqi/audio/AudioEngine";
import type { PresentationStore } from "../components/xiangqi/presentation/PresentationStore";
import { BoardScene } from "../components/xiangqi/scene/BoardScene";
import type { BoardView, BoardViewSide } from "../components/xiangqi/scene/BoardCamera";
import type { EnvironmentStatus } from "../components/xiangqi/scene/diorama-environment";
import { SceneErrorBoundary } from "../components/xiangqi/runtime/SceneErrorBoundary";
import {
  getQualityProfile,
  type QualityTier,
} from "../components/xiangqi/runtime/quality";
import { detectWebGL2 } from "../components/xiangqi/runtime/webgl";

const QUALITY_LABELS: Record<QualityTier, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function BoardViewer({
  animations,
  audio,
  overlay,
  pieceLayer,
  presentation,
  quality = "high",
  reducedMotion = false,
  status = "9 × 10 线位 · 双九宫 · 本机双人",
}: {
  animations: AnimationRegistry;
  audio: AudioEngine;
  overlay?: ReactNode;
  pieceLayer?: ReactNode;
  presentation: PresentationStore;
  quality?: QualityTier;
  reducedMotion?: boolean;
  status?: string;
}) {
  const drawCallsRef = useRef<HTMLSpanElement>(null);
  const [autoTour, setAutoTour] = useState(false);
  const [environmentStatus, setEnvironmentStatus] = useState<EnvironmentStatus>("loading");
  const [error, setError] = useState(false);
  const [view, setView] = useState<BoardView>("battle");
  const [viewSide, setViewSide] = useState<BoardViewSide>("red");
  const [webglAvailable, setWebglAvailable] = useState(true);
  const qualityProfile = useMemo(() => getQualityProfile(quality), [quality]);

  useEffect(() => {
    const availabilityFrame = window.requestAnimationFrame(() => {
      setWebglAvailable(detectWebGL2());
      if (reducedMotion) setAutoTour(false);
    });
    return () => {
      window.cancelAnimationFrame(availabilityFrame);
    };
  }, [reducedMotion]);

  const handleSceneError = useCallback(() => setError(true), []);
  const runtimeStatus = !webglAvailable
    ? "WebGL2 三维预览不可用"
    : error
      ? "棋盘场景加载失败"
      : status;

  return (
    <section
      className="viewer-shell board-viewer"
      aria-label="写实要塞风中国象棋棋盘三维预览"
      data-environment-status={environmentStatus}
    >
      <div className="viewer-canvas">
        {webglAvailable ? (
          <SceneErrorBoundary
            fallback={<p className="viewer-fallback" role="status">棋盘场景加载失败。</p>}
            onError={handleSceneError}
          >
            <Canvas
              camera={{ fov: 37, near: 0.1, far: 140, position: [10.2, 8.7, 13.4] }}
              dpr={[qualityProfile.dpr[0], qualityProfile.dpr[1]]}
              fallback={<p className="viewer-fallback">此设备无法启动三维预览。</p>}
              frameloop="demand"
              gl={{ antialias: quality !== "low", alpha: false, powerPreference: "high-performance" }}
              shadows={qualityProfile.shadows ? "percentage" : false}
              onCreated={({ gl }) => {
                gl.info.autoReset = false;
                gl.outputColorSpace = THREE.SRGBColorSpace;
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                // Preserve pigment and clay mid-tones instead of pushing the
                // bright panorama and chalk feedback toward the same white.
                gl.toneMappingExposure = 1.08;
                gl.shadowMap.enabled = qualityProfile.shadows;
                gl.shadowMap.type = THREE.PCFShadowMap;
              }}
            >
              <BoardScene
                ambientMotion={!reducedMotion}
                animations={animations}
                audio={audio}
                autoTour={autoTour}
                drawCallsRef={drawCallsRef}
                onEnvironmentStatusChange={setEnvironmentStatus}
                pieceLayer={pieceLayer}
                presentation={presentation}
                quality={qualityProfile}
                reducedMotion={reducedMotion}
                view={view}
                viewSide={viewSide}
              />
            </Canvas>
          </SceneErrorBoundary>
        ) : (
          <p className="viewer-fallback" role="status">
            当前设备或浏览器未提供 WebGL2，无法显示三维棋盘。
          </p>
        )}
      </div>

      <div className="viewer-corner-label" aria-hidden="true">
        <span>FORTRESS BOARD</span>
        <strong>要塞棋盘 · 01</strong>
      </div>

      <div className="viewer-hud">
        <span className="viewer-stat">
          {runtimeStatus}
          {webglAvailable && !error ? <>{" · "}<span data-testid="runtime-performance" ref={drawCallsRef}>— 绘制调用</span></> : null}
        </span>
        <div className="viewer-controls">
          <button
            aria-pressed={view === "overhead"}
            className="viewer-control"
            type="button"
            onClick={() => setView((current) => (current === "battle" ? "overhead" : "battle"))}
          >
            {view === "battle" ? "俯视棋盘" : "战场视角"}
          </button>
          <button
            aria-pressed={autoTour}
            className="viewer-control"
            disabled={view === "overhead" || reducedMotion}
            type="button"
            onClick={() => setAutoTour((enabled) => !enabled)}
          >
            {autoTour ? "停止巡游" : "自动巡游"}
          </button>
          <button
            aria-label={`切换到${viewSide === "red" ? "黑方" : "红方"}视角`}
            className="viewer-control"
            type="button"
            onClick={() => setViewSide((side) => (side === "red" ? "black" : "red"))}
          >
            换边视角 · {viewSide === "red" ? "红" : "黑"}
          </button>
        </div>
      </div>

      {overlay ? <div className="game-overlay">{overlay}</div> : null}

      <p className="sr-only" aria-live="polite">
        {runtimeStatus}。当前为{viewSide === "red" ? "红方" : "黑方"}
        {view === "battle" ? "战场透视" : "正上方俯视"}视角，{QUALITY_LABELS[quality]}画质。
      </p>
    </section>
  );
}
