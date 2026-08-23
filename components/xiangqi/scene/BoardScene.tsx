"use client";

import { Suspense, useCallback, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Selection } from "@react-three/postprocessing";

import { AnimationDirector } from "../animation/AnimationDirector";
import type { AnimationRegistry } from "../animation/AnimationRegistry";
import { AudioListenerBridge } from "../audio/AudioListenerBridge";
import type { AudioEngine } from "../audio/AudioEngine";
import { PieceAssetLoaderProvider } from "../pieces/asset-loader";
import type { PresentationStore } from "../presentation/PresentationStore";
import { FrameScheduler } from "../runtime/FrameScheduler";
import { PerformanceSummary } from "../runtime/PerformanceSummary";
import { StaticShadowMap } from "../runtime/StaticShadowMap";
import { WebGLContextRecovery } from "../runtime/WebGLContextRecovery";
import type { QualityProfile } from "../runtime/quality";
import { BoardCamera, type BoardView, type BoardViewSide } from "./BoardCamera";
import { BattlePostprocessing } from "./BattlePostprocessing";
import { CameraFeedback } from "./CameraFeedback";
import { BoardSurface } from "./BoardSurface";
import { FortressEnvironment } from "./FortressEnvironment";
import { PieceLayer, type ScenePieceSlot } from "./PieceLayer";
import { PrototypeMarshal } from "./PrototypeMarshal";

type BoardSceneProps = {
  ambientMotion: boolean;
  animations: AnimationRegistry;
  audio: AudioEngine;
  autoTour: boolean;
  drawCallsRef: RefObject<HTMLSpanElement | null>;
  pieceLayer?: ReactNode;
  presentation: PresentationStore;
  quality: QualityProfile;
  reducedMotion: boolean;
  view: BoardView;
  viewSide: BoardViewSide;
};

const prototypeSlots: readonly ScenePieceSlot<"prototype-marshal">[] = [
  {
    data: "prototype-marshal",
    id: "red:general:0",
    square: { file: 4, rank: 0 },
  },
];

function PrototypePieceLayer() {
  return <PieceLayer slots={prototypeSlots} renderPiece={() => <PrototypeMarshal />} />;
}

function ConditionalBattlePostprocessing({ presentation }: { presentation: PresentationStore }) {
  const getCaptureSnapshot = useCallback(
    () => Boolean(presentation.getSnapshot().active?.transition.events.some((event) => event.type === "PieceCaptured")),
    [presentation],
  );
  const hasCapture = useSyncExternalStore(
    presentation.subscribe,
    getCaptureSnapshot,
    getCaptureSnapshot,
  );
  return hasCapture ? <BattlePostprocessing /> : null;
}

function AmbientScene({
  animate,
  presentation,
  quality,
}: {
  animate: boolean;
  presentation: PresentationStore;
  quality: QualityProfile;
}) {
  const getActionSnapshot = useCallback(
    () => Boolean(presentation.getSnapshot().active),
    [presentation],
  );
  const actionActive = useSyncExternalStore(
    presentation.subscribe,
    getActionSnapshot,
    getActionSnapshot,
  );
  const animateEnvironment = animate && !actionActive;
  return (
    <>
      <FortressEnvironment animate={animateEnvironment} quality={quality} />
      <BoardSurface animate={animateEnvironment} shadows={quality.shadows} />
    </>
  );
}

export function BoardScene({
  ambientMotion,
  animations,
  audio,
  autoTour,
  drawCallsRef,
  pieceLayer,
  presentation,
  quality,
  reducedMotion,
  view,
  viewSide,
}: BoardSceneProps) {
  return (
    <FrameScheduler ambientFps={quality.ambientFps}>
      <Selection enabled={quality.postprocessing}>
        <PieceAssetLoaderProvider>
          <AnimationDirector animations={animations} presentation={presentation} />
          <WebGLContextRecovery animations={animations} presentation={presentation} />
          <StaticShadowMap enabled={quality.shadows} />
          <AmbientScene animate={ambientMotion} presentation={presentation} quality={quality} />
          <Suspense fallback={null}>{pieceLayer ?? <PrototypePieceLayer />}</Suspense>
          <BoardCamera autoTour={autoTour} side={viewSide} view={view} />
          <CameraFeedback presentation={presentation} quality={quality.postprocessing ? "high" : quality.dynamicEffectLights ? "medium" : "low"} reducedMotion={reducedMotion} />
          <AudioListenerBridge audio={audio} />
          <PerformanceSummary drawCallsRef={drawCallsRef} />
          {quality.postprocessing ? <ConditionalBattlePostprocessing presentation={presentation} /> : null}
        </PieceAssetLoaderProvider>
      </Selection>
    </FrameScheduler>
  );
}
