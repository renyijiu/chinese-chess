"use client";

import type { KeyboardEventHandler, Ref } from "react";

export function KeyboardBoardControl({
  active,
  announcement,
  controlRef,
  coordinate,
  interactionLocked,
  onBlur,
  onFocus,
  onKeyDown,
}: {
  active: boolean;
  announcement: string;
  controlRef: Ref<HTMLButtonElement>;
  coordinate: string;
  interactionLocked: boolean;
  onBlur: () => void;
  onFocus: () => void;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
}) {
  return (
    <div className="game-keyboard-control">
      <button
        aria-describedby="keyboard-board-help"
        aria-disabled={interactionLocked}
        aria-label={`棋盘键盘控制，当前 ${coordinate}，${announcement}`}
        aria-pressed={active}
        ref={controlRef}
        type="button"
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <span>键盘棋盘</span>
        <strong>{coordinate}</strong>
      </button>
      <small aria-hidden="true">方向键 / WASD 移动 · Enter 选择或落子 · Esc 取消</small>
      <span className="sr-only" id="keyboard-board-help">
        用方向键或 WASD 在九十个交叉点间移动焦点，Enter 选择棋子或确认落子，Escape 取消选择。
      </span>
    </div>
  );
}
