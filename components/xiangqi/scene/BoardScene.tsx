"use client";

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

import { AnimationDirector } from "../animation/AnimationDirector";
import type { AnimationRegistry } from "../animation/AnimationRegistry";
import { AudioListenerBridge } from "../audio/AudioListenerBridge";
import type { AudioEngine } from "../audio/AudioEngine";
import { PieceAssetLoaderProvider } from "../pieces/asset-loader";
import type { PresentationStore } from "../presentation/PresentationStore";
import { FrameScheduler } from "../runtime/FrameScheduler";
import { PerformanceSummary } from "../runtime/PerformanceSummary";
import { PauseSceneRendering, SceneWarmup } from "../runtime/SceneWarmup";
import { StaticShadowMap } from "../runtime/StaticShadowMap";
import { WebGLContextRecovery } from "../runtime/WebGLContextRecovery";
import type { QualityProfile } from "../runtime/quality";
import { BoardCamera, type BoardView, type BoardViewSide } from "./BoardCamera";
import { CameraFeedback } from "./CameraFeedback";
import { BoardSurface } from "./BoardSurface";
import { DioramaEnvironment } from "./DioramaEnvironment";
import {
  resolveEnvironmentStatus,
  type EnvironmentLayerStatus,
  type EnvironmentStatus,
} from "./diorama-environment";
import { PieceLayer, type ScenePieceSlot } from "./PieceLayer";
import { PrototypeMarshal } from "./PrototypeMarshal";

let battlePostprocessing: Promise<{ default: () => ReactNode }> | undefined;
function loadBattlePostprocessing() {
  return (battlePostprocessing ??= import("./BattlePostprocessing")
    .then((module) => ({ default: module.BattlePostprocessing }))
    .catch((error: unknown) => {
      console.warn("Optional battle glow could not load", error);
      return { default: () => null };
    }));
}
const BattlePostprocessing = lazy<() => ReactNode>(loadBattlePostprocessing);

type BoardSceneProps = {
  ambientMotion: boolean;
  animations: AnimationRegistry;
  audio: AudioEngine;
  autoTour: boolean;
  drawCallsRef: RefObject<HTMLSpanElement | null>;
  pieceLayer?: ReactNode;
  onEnvironmentStatusChange?: (status: EnvironmentStatus) => void;
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
  const getActionSnapshot = useCallback(
    () => presentation.getSnapshot().active?.transition ?? null,
    [presentation],
  );
  const transition = useSyncExternalStore(
    presentation.subscribe,
    getActionSnapshot,
    getActionSnapshot,
  );
  useEffect(() => {
    // Warm the optional module on the first action, before a later capture needs it.
    if (transition) void loadBattlePostprocessing();
  }, [transition]);
  return transition?.events.some((event) => event.type === "PieceCaptured") ? (
    <Suspense fallback={null}>
      <BattlePostprocessing key={transition.actionId} />
    </Suspense>
  ) : null;
}

function AmbientScene({
  animate,
  onEnvironmentStatusChange,
  presentation,
  quality,
}: {
  animate: boolean;
  onEnvironmentStatusChange?: (status: EnvironmentStatus) => void;
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
  const [dioramaStatus, setDioramaStatus] = useState<EnvironmentLayerStatus>("loading");
  const [riverStatus, setRiverStatus] = useState<EnvironmentLayerStatus>("loading");
  const environmentStatus = resolveEnvironmentStatus([dioramaStatus, riverStatus]);

  useEffect(
    () => onEnvironmentStatusChange?.(environmentStatus),
    [environmentStatus, onEnvironmentStatusChange],
  );
  return (
    <>
      <DioramaEnvironment
        animate={animateEnvironment}
        onStatusChange={setDioramaStatus}
        quality={quality}
      />
      <BoardSurface
        animate={animateEnvironment && quality.environment.motion.river}
        onRiverStatusChange={setRiverStatus}
        shadows={quality.shadows}
      />
    </>
  );
}

export function BoardScene({
  ambientMotion,
  animations,
  audio,
  autoTour,
  drawCallsRef,
  onEnvironmentStatusChange,
  pieceLayer,
  presentation,
  quality,
  reducedMotion,
  view,
  viewSide,
}: BoardSceneProps) {
  const [environment, setEnvironment] = useState<{
    quality: QualityProfile;
    status: EnvironmentStatus;
  }>({ quality, status: "loading" });
  const [preparedQuality, setPreparedQuality] = useState<QualityProfile | null>(null);
  const environmentStatus = environment.quality === quality ? environment.status : "loading";
  const reportEnvironment = useCallback(
    (status: EnvironmentStatus) => setEnvironment({ quality, status }),
    [quality],
  );
  const prepared = useCallback(
    (ready: boolean) => setPreparedQuality(ready ? quality : null),
    [quality],
  );
  useEffect(() => {
    onEnvironmentStatusChange?.(preparedQuality === quality ? environmentStatus : "loading");
  }, [environmentStatus, onEnvironmentStatusChange, preparedQuality, quality]);
  return (
    <FrameScheduler ambientFps={quality.ambientFps}>
      <PieceAssetLoaderProvider>
        <AnimationDirector animations={animations} presentation={presentation} />
        <WebGLContextRecovery animations={animations} presentation={presentation} />
        <StaticShadowMap enabled={quality.shadows} />
        <AmbientScene
          animate={ambientMotion}
          key={`${quality.environment.panorama}:${quality.environment.detailLevel}`}
          presentation={presentation}
          quality={quality}
          onEnvironmentStatusChange={reportEnvironment}
        />
        <Suspense fallback={<PauseSceneRendering />}>
          {pieceLayer ?? <PrototypePieceLayer />}
          <SceneWarmup
            key={`${quality.environment.panorama}:${quality.environment.detailLevel}`}
            postprocessing={quality.postprocessing}
            onReadyChange={prepared}
          />
        </Suspense>
        <BoardCamera
          autoTour={autoTour}
          reducedMotion={reducedMotion}
          side={viewSide}
          view={view}
        />
        <CameraFeedback
          presentation={presentation}
          quality={quality.postprocessing ? "high" : quality.dynamicEffectLights ? "medium" : "low"}
          reducedMotion={reducedMotion}
        />
        <AudioListenerBridge audio={audio} />
        <PerformanceSummary drawCallsRef={drawCallsRef} />
        {quality.postprocessing && preparedQuality === quality ? (
          <ConditionalBattlePostprocessing presentation={presentation} />
        ) : null}
      </PieceAssetLoaderProvider>
    </FrameScheduler>
  );
}
