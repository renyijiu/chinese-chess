"use client";

/* oxlint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type * as THREE from "three";

import {
  interpolateSquareToWorld,
  squareToWorld,
  type BoardSquare,
} from "../runtime/board-coordinates";
import type { PresentationStore } from "../presentation/PresentationStore";
import { moveLandingProgress } from "../presentation/piece-motion";

export type MovingPiece = Readonly<{
  capture: boolean;
  from: BoardSquare;
  id: string;
  presentation: PresentationStore;
  to: BoardSquare;
}>;

export type ScenePieceSlot<T = unknown> = Readonly<{
  data: T;
  id: string;
  rotationY?: number;
  square: BoardSquare;
}>;

export function PieceLayer<T>({
  renderPiece,
  movingPiece,
  slots,
}: {
  renderPiece: (slot: ScenePieceSlot<T>) => ReactNode;
  movingPiece?: MovingPiece | undefined;
  slots: readonly ScenePieceSlot<T>[];
}) {
  const root = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (!movingPiece) {
      // Also settle an interrupted/erroring frame to the authoritative board.
      slots.forEach((slot) => {
        root.current
          ?.getObjectByName(`piece-slot:${slot.id}`)
          ?.position.fromArray(squareToWorld(slot.square));
      });
      return;
    }
    const piece = root.current?.getObjectByName(`piece-slot:${movingPiece.id}`);
    if (!piece) return;
    const update = () =>
      piece.position.fromArray(
        interpolateSquareToWorld(
          movingPiece.from,
          movingPiece.to,
          moveLandingProgress(movingPiece.presentation.getProgress(), movingPiece.capture),
        ),
      );
    update();
    return movingPiece.presentation.subscribeFrame(update);
  }, [movingPiece, slots]);

  return (
    <group ref={root} name="piece-layer">
      {slots.map((slot) => (
        <group key={slot.id} name={`piece-slot:${slot.id}`} position={squareToWorld(slot.square)}>
          <group name={`piece-facing:${slot.id}`} rotation={[0, slot.rotationY ?? 0, 0]}>
            {renderPiece(slot)}
          </group>
        </group>
      ))}
    </group>
  );
}
