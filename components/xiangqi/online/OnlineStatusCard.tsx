"use client";

import type { OnlineMatchSessionSnapshot } from "./OnlineMatchSession";

const PEER_LABELS: Record<OnlineMatchSessionSnapshot["peer"]["phase"], string> = {
  idle: "等待开始",
  gathering: "正在探测网络",
  "waiting-answer": "邀请已生成，等待好友回复",
  "answer-ready": "回复已生成，等待好友完成连接",
  connecting: "正在连接",
  open: "已连接",
  "disconnected-grace": "连接短暂中断，正在等待恢复",
  failed: "连接失败",
  closed: "连接已关闭",
};

const COORDINATOR_LABELS = {
  idle: "等待连接",
  handshaking: "正在核对双方版本",
  "awaiting-ready": "等待双方准备",
  playable: "双方已准备，可以落子",
  "awaiting-ack": "等待好友确认落子",
  revalidating: "正在重新核对连接与棋局",
  stalled: "等待好友响应超时，棋盘已暂时锁定",
  syncing: "正在同步棋局",
  terminal: "棋局已经结束",
  "repair-required": "双方局面不一致，棋盘已锁定",
  failed: "联机出错",
  disposed: "联机会话已关闭",
} as const;

export function OnlineStatusCard({
  snapshot,
  onReconnect,
}: {
  snapshot: OnlineMatchSessionSnapshot;
  onReconnect?: () => void;
}) {
  const coordinator = snapshot.coordinator;
  const peerOwnsStatus =
    snapshot.peer.phase === "disconnected-grace" ||
    snapshot.peer.phase === "failed" ||
    snapshot.peer.phase === "closed";
  const status =
    coordinator && !peerOwnsStatus
      ? COORDINATOR_LABELS[coordinator.phase]
      : PEER_LABELS[snapshot.peer.phase];
  const failed =
    snapshot.peer.phase === "failed" ||
    coordinator?.phase === "failed" ||
    coordinator?.phase === "repair-required";
  const canChooseReconnect =
    failed ||
    snapshot.reconnectRequired ||
    snapshot.peer.phase === "disconnected-grace" ||
    coordinator?.phase === "stalled" ||
    coordinator?.phase === "revalidating";

  return (
    <section
      className="online-status-card"
      aria-label="好友直连状态"
      aria-live="polite"
      data-online-phase={coordinator?.phase ?? snapshot.peer.phase}
      role="status"
    >
      <div>
        <span>好友直连</span>
        <strong>
          {snapshot.identity?.localSide === "black"
            ? "执黑"
            : snapshot.identity
              ? "执红"
              : "配对中"}
        </strong>
      </div>
      <p>{status}</p>
      {coordinator ? (
        <small>
          你{coordinator.localReady ? "已准备" : "未准备"} · 好友
          {coordinator.remoteReady ? "已准备" : "未准备"}
        </small>
      ) : null}
      {failed ? <em>棋盘已锁定，请返回菜单重新配对。</em> : null}
      {snapshot.rotatingToMatchId ? <em>正在创建下一局，连接保持不变…</em> : null}
      {canChooseReconnect && onReconnect ? (
        <button
          className="game-secondary-action online-reconnect-action"
          type="button"
          onClick={onReconnect}
        >
          返回菜单重新配对
        </button>
      ) : null}
    </section>
  );
}
