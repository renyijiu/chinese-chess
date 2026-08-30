"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import type { ReactNode } from "react";

import {
  squareToWorld,
  type BoardSquare,
  type WorldPosition,
} from "../runtime/board-coordinates";

export type ScenePieceSlot<T = unknown> = Readonly<{
  data: T;
  id: string;
  rotationY?: number;
  square: BoardSquare;
}>;

export function PieceLayer<T>({
  renderPiece,
  resolveWorldPosition,
  slots,
}: {
  renderPiece: (slot: ScenePieceSlot<T>) => ReactNode;
  resolveWorldPosition?: (slot: ScenePieceSlot<T>) => WorldPosition | undefined;
  slots: readonly ScenePieceSlot<T>[];
}) {
  return (
    <group name="piece-layer">
      {slots.map((slot) => (
        <group
          key={slot.id}
          name={`piece-slot:${slot.id}`}
          position={resolveWorldPosition?.(slot) ?? squareToWorld(slot.square)}
        >
          <group
            name={`piece-facing:${slot.id}`}
            rotation={[0, slot.rotationY ?? 0, 0]}
          >
            {renderPiece(slot)}
          </group>
        </group>
      ))}
    </group>
  );
}
