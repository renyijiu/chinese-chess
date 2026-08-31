"use client";

import Image from "next/image";
import { useState } from "react";

import type { OnlineMatchSessionSnapshot } from "./OnlineMatchSession";
import { OnlineStatusCard } from "./OnlineStatusCard";
import {
  createSignalingQrDataUrl,
  isShareCancellation,
  signalingTextFitsQr,
} from "./signaling-share";

export function SignalingWizard({
  role,
  snapshot,
  busy,
  error,
  onCancel,
  onReady,
  onSubmitSignal,
}: {
  role: "host" | "guest";
  snapshot: OnlineMatchSessionSnapshot | null;
  busy: boolean;
  error: string | undefined;
  onCancel: () => void;
  onReady: () => Promise<void>;
  onSubmitSignal: (signal: string) => Promise<boolean>;
}) {
  const [input, setInput] = useState("");
  const [qrBusySignal, setQrBusySignal] = useState<string>();
  const [qrResult, setQrResult] = useState<Readonly<{ signal: string; dataUrl: string }>>();
  const [qrNotice, setQrNotice] = useState<Readonly<{ signal: string; message: string }>>();
  const [shareNotice, setShareNotice] = useState<Readonly<{ signal: string; message: string }>>();
  const outbound = snapshot?.outboundSignal ?? "";
  const peerPhase = snapshot?.peer.phase ?? "idle";
  const coordinator = snapshot?.coordinator ?? null;
  const needsInput = role === "guest"
    ? outbound.length === 0
    : peerPhase === "waiting-answer";
  const inputKind = role === "guest" ? "Offer 邀请文本" : "Answer 响应文本";
  const gathering = peerPhase === "gathering";
  const canReady = coordinator?.phase === "awaiting-ready" && !coordinator.localReady;
  const qrAvailable = signalingTextFitsQr(outbound);
  const qrBusy = qrBusySignal === outbound;
  const qrDataUrl = qrResult?.signal === outbound ? qrResult.dataUrl : undefined;
  const visibleQrNotice = qrNotice?.signal === outbound ? qrNotice.message : undefined;
  const visibleShareNotice = shareNotice?.signal === outbound ? shareNotice.message : undefined;

  const copyOutbound = async () => {
    if (!outbound) return;
    try {
      await navigator.clipboard.writeText(outbound);
      setShareNotice({ signal: outbound, message: "已复制完整文本。" });
    } catch {
      setShareNotice({ signal: outbound, message: "复制失败，请手动选中并复制。" });
    }
  };

  const shareOutbound = async () => {
    if (!outbound || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: role === "host" ? "中国象棋好友直连邀请" : "中国象棋好友直连响应",
        text: outbound,
      });
      setShareNotice({ signal: outbound, message: "已打开系统分享。" });
    } catch (error) {
      setShareNotice({
        signal: outbound,
        message: isShareCancellation(error)
          ? "已取消系统分享。"
          : "未完成分享，可改用复制。",
      });
    }
  };

  const showQr = async () => {
    if (!outbound || qrBusy) return;
    setQrBusySignal(outbound);
    setQrNotice(undefined);
    try {
      setQrResult({ signal: outbound, dataUrl: await createSignalingQrDataUrl(outbound) });
    } catch {
      setQrNotice({ signal: outbound, message: "二维码生成失败，请改用复制或系统分享。" });
    } finally {
      setQrBusySignal((current) => current === outbound ? undefined : current);
    }
  };

  return (
    <section className="game-menu game-overlay-panel signaling-wizard" aria-labelledby="online-wizard-title">
      <p className="game-kicker">PEER TO PEER · 好友直连</p>
      <h2 id="online-wizard-title">{role === "host" ? "创建邀请" : "加入棋局"}</h2>
      <p>
        只交换棋局命令，不上传棋局到游戏服务端。首版不提供 TURN，部分企业网络或复杂 NAT 可能无法连接。
      </p>

      {snapshot ? <OnlineStatusCard snapshot={snapshot} /> : null}
      {gathering ? <p className="online-progress" role="status">正在等待 ICE gathering complete，请勿关闭页面…</p> : null}
      {error || snapshot?.error ? <p className="game-warning" role="alert">{error ?? snapshot?.error}</p> : null}

      {outbound ? (
        <div className="online-signal-block">
          <label htmlFor="online-outbound-signal">
            {role === "host" ? "完整 Offer 邀请文本" : "完整 Answer 响应文本"}
          </label>
          <textarea id="online-outbound-signal" readOnly rows={5} value={outbound} />
          <div className="online-inline-actions">
            <button className="game-secondary-action" type="button" onClick={() => { void copyOutbound(); }}>复制</button>
            {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
              <button className="game-secondary-action" type="button" onClick={() => { void shareOutbound(); }}>系统分享</button>
            ) : null}
            {qrAvailable ? (
              <button className="game-secondary-action" disabled={qrBusy} type="button" onClick={() => { void showQr(); }}>
                {qrBusy ? "正在生成…" : qrDataUrl ? "刷新二维码" : "显示二维码"}
              </button>
            ) : null}
          </div>
          {visibleShareNotice ? <small role="status">{visibleShareNotice}</small> : null}
          {!qrAvailable ? <small>邀请文本较长，二维码不可用；请使用复制或系统分享。</small> : null}
          {visibleQrNotice ? <small className="game-warning" role="alert">{visibleQrNotice}</small> : null}
          {qrDataUrl ? (
            <figure className="online-signal-qr">
              <Image alt={`完整${role === "host" ? "邀请" : "响应"}文本二维码`} height={280} src={qrDataUrl} unoptimized width={280} />
              <figcaption>二维码同样包含临时网络信息，只向本局好友展示。</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}

      {needsInput ? (
        <form
          className="online-signal-block"
          onSubmit={(event) => {
            event.preventDefault();
            if (input.trim()) {
              void Promise.resolve(onSubmitSignal(input.trim())).then((accepted) => {
                if (accepted) setInput("");
              });
            }
          }}
        >
          <label htmlFor="online-inbound-signal">粘贴好友的{inputKind}</label>
          <textarea
            id="online-inbound-signal"
            autoComplete="off"
            disabled={busy}
            rows={5}
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="game-primary-action" disabled={busy || input.trim().length === 0} type="submit">
            {busy ? "正在处理…" : role === "guest" ? "生成 Answer" : "接受 Answer 并连接"}
          </button>
        </form>
      ) : null}

      {canReady ? (
        <button className="game-primary-action online-ready-action" disabled={busy} type="button" onClick={() => { void onReady(); }}>
          我已准备
        </button>
      ) : null}
      {coordinator?.localReady && coordinator.phase !== "playable" ? <p className="online-progress">已准备，正在等待好友…</p> : null}

      <button className="game-secondary-action online-cancel-action" type="button" onClick={onCancel}>取消并关闭连接</button>
      <small>邀请文本包含临时网络信息，请只发给本局好友；刷新页面后需要重新配对。</small>
    </section>
  );
}
