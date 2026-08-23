"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";

import { boardIndex, type GameState, type Piece, type Square } from "../../../lib/xiangqi/index";
import type { AnimationRegistry } from "../animation/AnimationRegistry";
import { PieceActor } from "../pieces/PieceActor";
import type { PresentationStore } from "../presentation/PresentationStore";
import {
  BOARD_FILES,
  BOARD_RANKS,
  BOARD_SURFACE_Y,
  squareToWorld,
} from "../runtime/board-coordinates";
import { getQualityProfile, type QualityTier } from "../runtime/quality";
import { PieceLayer, type ScenePieceSlot } from "../scene/PieceLayer";
import { PieceCombatVfx } from "../vfx/PieceCombatVfx";

const ALL_SQUARES: readonly Square[] = Object.freeze(
  Array.from({ length: BOARD_FILES * BOARD_RANKS }, (_, index) => ({
    file: index % BOARD_FILES,
    rank: Math.floor(index / BOARD_FILES),
  })),
);

function BoardHitGrid({ disabled, onSquarePress }: {
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
    <instancedMesh ref={ref} args={[undefined, undefined, ALL_SQUARES.length]} onClick={handleClick}>
      <circleGeometry args={[0.52, 16]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} opacity={0.001} transparent />
    </instancedMesh>
  );
}

function LegalMoveMarkers({ game, moves }: { game: GameState; moves: readonly Square[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const colors = useMemo(
    () => moves.map((square) => game.board[boardIndex(square)]
      ? new THREE.Color(0xcc5441)
      : new THREE.Color(0xe3b75e)),
    [game.board, moves],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    moves.forEach((square, index) => {
      const [x, , z] = squareToWorld(square);
      transform.position.set(x, BOARD_SURFACE_Y + 0.033, z);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, colors[index]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [colors, moves]);

  if (moves.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, moves.length]}
      raycast={() => null}
    >
      <ringGeometry args={[0.12, 0.2, 24]} />
      <meshBasicMaterial depthWrite={false} opacity={0.88} transparent vertexColors />
    </instancedMesh>
  );
}

function KeyboardFocusMarker({ square }: { square: Square }) {
  return (
    <group position={squareToWorld(square)} raycast={() => null}>
      <mesh position={[0, 0.039, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.31, 0.39, 32]} />
        <meshBasicMaterial color="#f4e4a4" depthWrite={false} opacity={0.96} transparent />
      </mesh>
      <mesh position={[0, 0.041, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.48, 32]} />
        <meshBasicMaterial color="#789f94" depthWrite={false} opacity={0.78} transparent />
      </mesh>
    </group>
  );
}

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
      <meshBasicMaterial color="#030504" depthWrite={false} opacity={0.3} transparent />
    </instancedMesh>
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
  const active = visual.active;
  const moveEvent = active?.transition.events.find((event) =>
    event.type === "MoveCommitted" || event.type === "MoveUndone",
  );
  const move = moveEvent?.type === "MoveCommitted" || moveEvent?.type === "MoveUndone"
    ? moveEvent.move
    : null;
  const capturedEvent = active?.transition.events.find((event) => event.type === "PieceCaptured");
  const captured = capturedEvent?.type === "PieceCaptured" ? capturedEvent.piece : null;
  const capture = Boolean(captured);
  const progress = active?.progress ?? 1;
  const visualFrom = moveEvent?.type === "MoveUndone" ? move?.to : move?.from;
  const visualTo = moveEvent?.type === "MoveUndone" ? move?.from : move?.to;
  const movingPieceId = move?.pieceId ?? null;
  const moveLanding = capture
    ? smoothStep(Math.min(1, Math.max(0, (progress - 0.58) / 0.36)))
    : smoothStep(progress);
  const movingOffset = visualFrom && visualTo
    ? offsetBetween(visualFrom, visualTo, 1 - moveLanding)
    : ([0, 0, 0] as const);
  const terminalLoser = game.status.kind === "ended" && game.status.winner
    ? (game.status.winner === "red" ? "black" : "red")
    : null;
  const terminalDestroyProgress = active
    ? Math.min(0.98, Math.max(0, (progress - 0.52) / 0.42))
    : 0.98;

  const slots = useMemo<readonly ScenePieceSlot<Piece>[]>(
    () => game.board.flatMap((piece) => piece
      ? [{
          data: piece,
          id: piece.id,
          rotationY: piece.side === "red" ? Math.PI : 0,
          square: piece.square,
        }]
      : []),
    [game.board],
  );
  const ghostPiece: Piece | null = captured
    ? { ...captured, square: captured.square }
    : null;
  const movingPiece = move
    ? active?.transition.after.board.find((piece) => piece?.id === move.pieceId) ??
      active?.transition.before.board.find((piece) => piece?.id === move.pieceId) ?? null
    : null;
  const movingAnimation = capture
    ? progress < 0.58 ? "attack_primary" : progress < 0.88 ? "move_loop" : "move_end"
    : progress < 0.18 ? "move_start" : progress < 0.82 ? "move_loop" : "move_end";
  const ghostAnimation = progress < 0.48 ? "idle_loop" : progress < 0.62 ? "hit_react" : "destroy";
  const terminalAnimation = active
    ? progress < 0.48 ? "idle_loop" : progress < 0.62 ? "hit_react" : "destroy"
    : "destroy";
  const ghostDestroyProgress = Math.min(0.99, Math.max(0, (progress - 0.61) / 0.34));
  const qualityProfile = getQualityProfile(quality);
  const lod = qualityProfile.lod;

  return (
    <group name="interactive-game-layer">
      <BoardHitGrid disabled={disabled} onSquarePress={onSquarePress} />
      <LegalMoveMarkers game={game} moves={legalMoves} />
      {keyboardSquare ? <KeyboardFocusMarker square={keyboardSquare} /> : null}
      <PieceContactShadows pieces={slots} />
      <PieceLayer
        slots={slots}
        renderPiece={(slot) => (
          <PieceActor
            actorId={slot.id}
            animation={slot.id === movingPieceId
              ? movingAnimation
              : terminalLoser === slot.data.side && slot.data.role === "general"
                ? terminalAnimation
                : "idle_loop"}
            animations={animations}
            disabled={disabled}
            destroyProgress={terminalLoser === slot.data.side && slot.data.role === "general"
              ? terminalDestroyProgress
              : 0}
            lod={lod}
            onPress={(piece) => onSquarePress(piece.square)}
            piece={slot.data}
            selected={slot.id === selectedPieceId}
            visualOffset={slot.id === movingPieceId ? movingOffset : undefined}
          />
        )}
      />
      {ghostPiece ? (
        <group position={squareToWorld(ghostPiece.square)} rotation={[0, ghostPiece.side === "red" ? Math.PI : 0, 0]}>
          <PieceActor
            actorId={`captured:${active?.transition.actionId ?? "settled"}:${ghostPiece.id}`}
            animation={ghostAnimation}
            animations={animations}
            destroyProgress={ghostDestroyProgress}
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
        progress={progress}
        quality={qualityProfile}
        reducedMotion={active?.transition.reducedMotion ?? false}
        role={movingPiece?.role ?? "general"}
        side={movingPiece?.side ?? "red"}
        to={visualTo ?? { file: 4, rank: 0 }}
      />
    </group>
  );
}

function smoothStep(value: number) {
  return value * value * (3 - 2 * value);
}

function offsetBetween(from: Square, to: Square, remaining: number): readonly [number, number, number] {
  const [fromX, fromY, fromZ] = squareToWorld(from);
  const [toX, toY, toZ] = squareToWorld(to);
  return [
    (fromX - toX) * remaining,
    (fromY - toY) * remaining,
    (fromZ - toZ) * remaining,
  ];
}
