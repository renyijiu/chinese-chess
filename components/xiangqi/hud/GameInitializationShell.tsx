import { GameMenu } from "./GameHud";

export function GameInitializationShell({
  onContinue,
  onStart,
}: {
  onContinue: () => void;
  onStart: () => void;
}) {
  return (
    <section
      aria-busy="true"
      aria-label="Q 版秦俑沙盘中国象棋棋盘三维预览"
      className="viewer-shell board-viewer"
      data-environment-status="loading"
    >
      <div aria-hidden="true" className="viewer-canvas viewer-canvas--initializing" />
      <div className="viewer-corner-label" aria-hidden="true">
        <span>QIN DIORAMA</span>
        <strong>秦俑沙盘 · 01</strong>
      </div>
      <div className="viewer-hud" aria-hidden="true">
        <div className="viewer-controls">
          <button className="viewer-control" disabled type="button">俯视棋盘</button>
          <button className="viewer-control" disabled type="button">自动巡游</button>
          <button className="viewer-control" disabled type="button">换边视角 · 红</button>
        </div>
      </div>
      <div className="game-overlay">
        <GameMenu
          hasSave={false}
          loading
          onContinue={onContinue}
          onStart={onStart}
        />
      </div>
      <p className="sr-only" role="status">正在读取本地棋局与画质设置。</p>
    </section>
  );
}
