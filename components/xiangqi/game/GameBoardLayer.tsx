"use client";

/* oxlint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import type { ThreeEvent } from "@react-three/fiber";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";

import {
  boardIndex,
  type GameState,
  type MoveRecord,
  type Piece,
  type Square,
} from "../../../lib/xiangqi/index";
import type { AnimationRegistry } from "../animation/AnimationRegistry";
import { PieceActor } from "../pieces/PieceActor";
import { FACTION_MARKER_CLEARANCE, FACTION_MARKER_STYLES } from "../pieces/faction-marker";
import type { PresentationStore } from "../presentation/PresentationStore";
import { moveLandingProgress } from "../presentation/piece-motion";
import {
  BOARD_FILES,
  BOARD_RANKS,
  BOARD_SURFACE_Y,
  interpolateSquareToWorld,
  squareToWorld,
} from "../runtime/board-coordinates";
import { getQualityProfile, type PieceLod, type QualityTier } from "../runtime/quality";
import { PieceLayer, type MovingPiece, type ScenePieceSlot } from "../scene/PieceLayer";
import { BOARD_HIT_RADIUS } from "../scene/board-geometry";
import { QIN_DIORAMA_THEME } from "../scene/scene-theme";
import { PieceCombatVfx } from "../vfx/PieceCombatVfx";
import { resolveLastMoveMarkerGeometry } from "./last-move-marker";

const ALL_SQUARES: readonly Square[] = Object.freeze(
  Array.from({ length: BOARD_FILES * BOARD_RANKS }, (_, index) => ({
    file: index % BOARD_FILES,
    rank: Math.floor(index / BOARD_FILES),
  })),
);

declare global {
  interface Window {
    __XIANGQI_COMMITTED_PIECE_LOD__?: PieceLod;
  }
}

function PieceLodCommitMarker({ lod }: { lod: PieceLod }) {
  useLayoutEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__XIANGQI_COMMITTED_PIECE_LOD__ = lod;
    return () => {
      if (window.__XIANGQI_COMMITTED_PIECE_LOD__ === lod) {
        delete window.__XIANGQI_COMMITTED_PIECE_LOD__;
      }
    };
  }, [lod]);
  return null;
}

function BoardHitGrid({
  disabled,
  onSquarePress,
}: {
  disabled: boolean;
  onSquarePress: (square: Square) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    ALL_SQUARES.forEach((square, index) => {
      const [x, , z] = squareToWorld(square);
      transform.position.set(x, BOARD_SURFACE_Y + 0.018, z);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (disabled || event.delta > 6 || event.instanceId === undefined) return;
    const square = ALL_SQUARES[event.instanceId];
    if (square) onSquarePress(square);
  };

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, ALL_SQUARES.length]}
      onClick={handleClick}
    >
      <circleGeometry args={[BOARD_HIT_RADIUS, 16]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} opacity={0.001} transparent />
    </instancedMesh>
  );
}

function MoveMarkerInstances({
  capture,
  squares,
}: {
  capture: boolean;
  squares: readonly Square[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    squares.forEach((square, index) => {
      const [x, , z] = squareToWorld(square);
      transform.position.set(x, BOARD_SURFACE_Y + 0.033, z);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [squares]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, squares.length]} raycast={() => null}>
      {capture ? <ringGeometry args={[0.48, 0.54, 36]} /> : <circleGeometry args={[0.125, 20]} />}
      <meshBasicMaterial
        color={
          capture ? QIN_DIORAMA_THEME.states.capture.color : QIN_DIORAMA_THEME.states.legal.color
        }
        depthWrite={false}
        opacity={capture ? 0.94 : 0.9}
        transparent
      />
    </instancedMesh>
  );
}

function LegalMoveMarkers({ game, moves }: { game: GameState; moves: readonly Square[] }) {
  const legalMoves = useMemo(
    () => moves.filter((square) => !game.board[boardIndex(square)]),
    [game.board, moves],
  );
  const captureMoves = useMemo(
    () => moves.filter((square) => Boolean(game.board[boardIndex(square)])),
    [game.board, moves],
  );

  if (moves.length === 0) return null;
  return (
    <group name="legal-move-markers" raycast={() => null}>
      {legalMoves.length > 0 ? <MoveMarkerInstances capture={false} squares={legalMoves} /> : null}
      {captureMoves.length > 0 ? <MoveMarkerInstances capture squares={captureMoves} /> : null}
    </group>
  );
}

function KeyboardFocusMarker({ square }: { square: Square }) {
  return (
    <group position={squareToWorld(square)} raycast={() => null}>
      <mesh position={[0, 0.039, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.31, 0.39, 32]} />
        <meshBasicMaterial
          color={QIN_DIORAMA_THEME.states.keyboardFocus.color}
          depthWrite={false}
          opacity={0.96}
          transparent
        />
      </mesh>
      <mesh position={[0, 0.041, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.48, 32]} />
        <meshBasicMaterial
          color={QIN_DIORAMA_THEME.materials.chalk}
          depthWrite={false}
          opacity={0.76}
          transparent
        />
      </mesh>
    </group>
  );
}

const LastMoveMarker = memo(function LastMoveMarker({ move }: { move: MoveRecord | null }) {
  const geometry = useMemo(() => (move ? resolveLastMoveMarkerGeometry(move) : null), [move]);
  const quaternion = useMemo(
    () =>
      geometry
        ? new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(...geometry.direction),
          )
        : new THREE.Quaternion(),
    [geometry],
  );
  if (!geometry) return null;
  const factionColor = QIN_DIORAMA_THEME.factions[geometry.side].glow;
  const destinationColor = geometry.capture ? QIN_DIORAMA_THEME.states.capture.color : factionColor;

  return (
    <group name="last-move-marker" raycast={() => null}>
      <mesh
        position={geometry.start}
        raycast={() => null}
        renderOrder={5}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.12, 0.18, 28]} />
        <meshBasicMaterial color={factionColor} depthWrite={false} opacity={0.56} transparent />
      </mesh>
      <group position={geometry.midpoint} quaternion={quaternion}>
        <mesh raycast={() => null} renderOrder={5}>
          <cylinderGeometry args={[0.014, 0.014, geometry.length, 8]} />
          <meshBasicMaterial color={factionColor} depthWrite={false} opacity={0.58} transparent />
        </mesh>
      </group>
      <mesh
        position={geometry.end}
        raycast={() => null}
        renderOrder={6}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={geometry.capture ? [0.34, 0.43, 32] : [0.22, 0.31, 32]} />
        <meshBasicMaterial color={destinationColor} depthWrite={false} opacity={0.84} transparent />
      </mesh>
      {geometry.capture ? (
        <mesh
          position={[geometry.end[0], geometry.end[1] + 0.004, geometry.end[2]]}
          raycast={() => null}
          renderOrder={6}
          rotation={[-Math.PI / 2, 0, Math.PI / 4]}
        >
          <ringGeometry args={[0.12, 0.17, 4]} />
          <meshBasicMaterial
            color={QIN_DIORAMA_THEME.materials.chalk}
            depthWrite={false}
            opacity={0.8}
            transparent
          />
        </mesh>
      ) : null}
    </group>
  );
});

function PieceContactShadows({ pieces }: { pieces: readonly ScenePieceSlot<Piece>[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    pieces.forEach((piece, index) => {
      const [x, , z] = squareToWorld(piece.square);
      transform.position.set(x, BOARD_SURFACE_Y + 0.022, z);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.scale.set(0.56, 0.38, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [pieces]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pieces.length]} raycast={() => null}>
      <circleGeometry args={[0.62, 20]} />
      <meshBasicMaterial
        color={QIN_DIORAMA_THEME.materials.blackLacquer}
        depthWrite={false}
        opacity={0.28}
        transparent
      />
    </instancedMesh>
  );
}

function FactionMarkerInstances({
  pieces,
  movingPiece,
  side,
}: {
  pieces: readonly ScenePieceSlot<Piece>[];
  movingPiece?: MovingPiece | undefined;
  side: Piece["side"];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const style = FACTION_MARKER_STYLES[side];

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    pieces.forEach((piece, index) => {
      const [x, y, z] = squareToWorld(piece.square);
      transform.position.set(x, y + FACTION_MARKER_CLEARANCE, z);
      transform.rotation.set(-Math.PI / 2, 0, style.rotationZ);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, pieces.length * 16);
    if (!movingPiece) return;
    const index = pieces.findIndex((piece) => piece.id === movingPiece.id);
    if (index < 0) return;
    const update = () => {
      const [x, y, z] = interpolateSquareToWorld(
        movingPiece.from,
        movingPiece.to,
        moveLandingProgress(movingPiece.presentation.getProgress(), movingPiece.capture),
      );
      transform.position.set(x, y + FACTION_MARKER_CLEARANCE, z);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.instanceMatrix.addUpdateRange(index * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    };
    update();
    return movingPiece.presentation.subscribeFrame(update);
  }, [pieces, movingPiece, style.rotationZ]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, pieces.length]}
      name={`faction-base-markers:${side}`}
      raycast={() => null}
      renderOrder={3}
    >
      <ringGeometry args={[style.innerRadius, style.outerRadius, style.segments]} />
      <meshBasicMaterial
        color={QIN_DIORAMA_THEME.factions[side].trim}
        depthWrite={false}
        opacity={0.96}
        toneMapped={false}
        transparent
      />
    </instancedMesh>
  );
}

function FactionBaseMarkers({
  pieces,
  movingPiece,
}: {
  pieces: readonly ScenePieceSlot<Piece>[];
  movingPiece?: MovingPiece | undefined;
}) {
  const redPieces = useMemo(() => pieces.filter((piece) => piece.data.side === "red"), [pieces]);
  const blackPieces = useMemo(
    () => pieces.filter((piece) => piece.data.side === "black"),
    [pieces],
  );

  return (
    <group name="faction-base-markers" raycast={() => null}>
      {redPieces.length > 0 ? (
        <FactionMarkerInstances pieces={redPieces} movingPiece={movingPiece} side="red" />
      ) : null}
      {blackPieces.length > 0 ? (
        <FactionMarkerInstances pieces={blackPieces} movingPiece={movingPiece} side="black" />
      ) : null}
    </group>
  );
}

export function GameBoardLayer({
  animations,
  disabled,
  game,
  keyboardSquare,
  legalMoves,
  onSquarePress,
  presentation,
  quality,
  selectedPieceId,
}: {
  animations: AnimationRegistry;
  disabled: boolean;
  game: GameState;
  keyboardSquare: Square | null;
  legalMoves: readonly Square[];
  onSquarePress: (square: Square) => void;
  presentation: PresentationStore;
  quality: QualityTier;
  selectedPieceId: string | null;
}) {
  const visual = useSyncExternalStore(
    presentation.subscribe,
    presentation.getSnapshot,
    presentation.getSnapshot,
  );
  const handlePiecePress = useCallback(
    (piece: Piece) => onSquarePress(piece.square),
    [onSquarePress],
  );
  const lastMove = game.history.at(-1) ?? null;
  const active = visual.active;
  const moveEvent = active?.transition.events.find(
    (event) => event.type === "MoveCommitted" || event.type === "MoveUndone",
  );
  const move =
    moveEvent?.type === "MoveCommitted" || moveEvent?.type === "MoveUndone" ? moveEvent.move : null;
  const capturedEvent = active?.transition.events.find((event) => event.type === "PieceCaptured");
  const captured = capturedEvent?.type === "PieceCaptured" ? capturedEvent.piece : null;
  const capture = Boolean(captured);
  const visualFrom = moveEvent?.type === "MoveUndone" ? move?.to : move?.from;
  const visualTo = moveEvent?.type === "MoveUndone" ? move?.from : move?.to;
  const movingPieceId = move?.pieceId ?? null;
  const pieceMotion = useMemo<MovingPiece | undefined>(
    () =>
      visualFrom && visualTo && movingPieceId
        ? { capture, from: visualFrom, id: movingPieceId, presentation, to: visualTo }
        : undefined,
    [capture, movingPieceId, presentation, visualFrom, visualTo],
  );
  const terminalLoser =
    game.status.kind === "ended" && game.status.winner
      ? game.status.winner === "red"
        ? "black"
        : "red"
      : null;
  const slots = useMemo<readonly ScenePieceSlot<Piece>[]>(
    () =>
      game.board.flatMap((piece) =>
        piece
          ? [
              {
                data: piece,
                id: piece.id,
                rotationY: piece.side === "red" ? Math.PI : 0,
                square: piece.square,
              },
            ]
          : [],
      ),
    [game.board],
  );
  const ghostPiece: Piece | null = captured ? { ...captured, square: captured.square } : null;
  const movingPiece = move
    ? (active?.transition.after.board.find((piece) => piece?.id === move.pieceId) ??
      active?.transition.before.board.find((piece) => piece?.id === move.pieceId) ??
      null)
    : null;
  const qualityProfile = getQualityProfile(quality);
  const lod = qualityProfile.lod;

  return (
    <group name="interactive-game-layer">
      <BoardHitGrid disabled={disabled} onSquarePress={onSquarePress} />
      <LastMoveMarker move={lastMove} />
      <LegalMoveMarkers game={game} moves={legalMoves} />
      {keyboardSquare ? <KeyboardFocusMarker square={keyboardSquare} /> : null}
      <PieceContactShadows pieces={slots} />
      <FactionBaseMarkers pieces={slots} movingPiece={pieceMotion} />
      <PieceLayer
        movingPiece={pieceMotion}
        slots={slots}
        renderPiece={(slot) => (
          <PieceActor
            actorId={slot.id}
            animation={
              terminalLoser === slot.data.side && slot.data.role === "general"
                ? "destroy"
                : "idle_loop"
            }
            motion={
              slot.id === movingPieceId
                ? capture
                  ? "capture"
                  : "move"
                : active && terminalLoser === slot.data.side && slot.data.role === "general"
                  ? "defeat"
                  : undefined
            }
            presentation={presentation}
            animations={animations}
            disabled={disabled}
            destroyProgress={
              terminalLoser === slot.data.side && slot.data.role === "general" ? 0.98 : 0
            }
            lod={lod}
            onPress={handlePiecePress}
            piece={slot.data}
            selected={slot.id === selectedPieceId}
          />
        )}
      />
      <PieceLodCommitMarker lod={lod} />
      {ghostPiece ? (
        <group
          position={squareToWorld(ghostPiece.square)}
          rotation={[0, ghostPiece.side === "red" ? Math.PI : 0, 0]}
        >
          <PieceActor
            actorId={`captured:${active?.transition.actionId ?? "settled"}:${ghostPiece.id}`}
            motion="captured"
            presentation={presentation}
            animations={animations}
            disabled
            ghost
            lod={lod}
            onPress={() => undefined}
            piece={ghostPiece}
            selected={false}
          />
        </group>
      ) : null}
      <PieceCombatVfx
        active={Boolean(active && move && movingPiece)}
        capture={capture}
        from={visualFrom ?? { file: 4, rank: 0 }}
        presentation={presentation}
        quality={qualityProfile}
        reducedMotion={active?.transition.reducedMotion ?? false}
        role={movingPiece?.role ?? "general"}
        side={movingPiece?.side ?? "red"}
        to={visualTo ?? { file: 4, rank: 0 }}
      />
    </group>
  );
}
