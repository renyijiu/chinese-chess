"use client";

import dynamic from "next/dynamic";

function LoadingGameShell() {
  return (
    <section
      aria-busy="true"
      aria-label="Q 版秦俑沙盘中国象棋棋盘三维预览"
      className="viewer-shell board-viewer"
      data-environment-status="loading"
    >
      <div aria-hidden="true" className="viewer-canvas viewer-canvas--initializing" />
      <div className="viewer-hud" aria-hidden="true">
        <div className="viewer-controls">
          <button className="viewer-control" disabled type="button">
            俯视棋盘
          </button>
          <button className="viewer-control" disabled type="button">
            自动巡游
          </button>
          <button className="viewer-control" disabled type="button">
            换边视角 · 红
          </button>
        </div>
      </div>
      <div className="game-overlay">
        <section aria-label="兵临九宫" aria-busy="true" className="game-menu" role="dialog">
          <button disabled type="button">
            开始本机双人对局
          </button>
        </section>
      </div>
      <p className="sr-only" role="status">
        正在加载浏览器棋局运行时。
      </p>
    </section>
  );
}

export const XiangqiGameClient = dynamic(
  () => import("../components/xiangqi/XiangqiGame").then((module) => module.XiangqiGame),
  { loading: LoadingGameShell, ssr: false },
);
