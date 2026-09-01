"use client";

import type { OnlineMatchSessionSnapshot } from "./OnlineMatchSession";

const PEER_LABELS: Record<OnlineMatchSessionSnapshot["peer"]["phase"], string> = {
  idle: "等待开始",
  gathering: "正在收集网络候选地址",
  "waiting-answer": "邀请已生成，等待好友响应",
  "answer-ready": "响应已生成，等待好友完成连接",
  connecting: "正在建立直连",
  open: "直连通道已打开",
  "disconnected-grace": "连接短暂中断，正在等待恢复",
  failed: "直连失败",
  closed: "连接已关闭",
};

const COORDINATOR_LABELS = {
  idle: "等待协议启动",
  handshaking: "正在校验棋局版本",
  "awaiting-ready": "等待双方准备",
  playable: "双方已准备，可以落子",
  "awaiting-ack": "等待好友确认落子",
  revalidating: "正在重新校验连接与棋局",
  stalled: "联机响应超时，棋盘已暂时锁定",
  syncing: "正在恢复一致棋局",
  terminal: "棋局已经结束",
  "repair-required": "局面不一致，已锁定输入",
  failed: "联机协议失败",
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
      {failed ? <em>棋盘输入已锁定；请返回菜单后重新配对。</em> : null}
      {snapshot.rotatingToMatchId ? <em>正在保留当前直连并创建下一局…</em> : null}
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
