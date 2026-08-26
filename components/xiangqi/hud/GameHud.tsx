"use client";

import { useEffect, useRef, useState } from "react";

import type { GameState, Side } from "../../../lib/xiangqi/index";
import type { GameSettings } from "../game/storage";

const SIDE_LABELS: Record<Side, string> = { red: "红方", black: "黑方" };
const QUALITY_LABELS = { high: "高", medium: "中", low: "低" } as const;
const VOLUME_CONTROLS = [
  ["masterVolume", "主音量"],
  ["musicVolume", "音乐"],
  ["ambientVolume", "环境"],
  ["voiceVolume", "角色语音"],
  ["sfxVolume", "战斗音效"],
  ["uiVolume", "界面音效"],
] as const satisfies readonly (readonly [keyof GameSettings, string])[];
const END_REASON_LABELS = {
  checkmate: "将死",
  stalemate: "困毙",
  repetition: "三次重复局面",
  "no-capture": "连续 100 手无吃子",
  resignation: "认输",
} as const;

export function formatGameOutcome(game: GameState) {
  if (game.status.kind !== "ended") return "棋局进行中";
  const reason = END_REASON_LABELS[game.status.reason];
  return game.status.winner
    ? `${SIDE_LABELS[game.status.winner]}胜 · ${reason}`
    : `和棋 · ${reason}`;
}

export function GameMenu({
  hasSave,
  loading,
  onContinue,
  onStart,
  warning,
}: {
  hasSave: boolean;
  loading: boolean;
  onContinue: () => void;
  onStart: () => void;
  warning?: string;
}) {
  return (
    <div className="game-menu game-overlay-panel" role="dialog" aria-labelledby="game-menu-title">
      <p className="game-kicker">LOCAL HOT-SEAT · 本机双人</p>
      <h2 id="game-menu-title">兵临九宫</h2>
      <p>红方先行。选择己方棋子，再点击米白圆点落位；朱砂圆环表示可吃子。</p>
      {warning ? <p className="game-warning" role="status">{warning}</p> : null}
      <div className="game-menu-actions">
        {hasSave ? (
          <button className="game-primary-action" disabled={loading} type="button" onClick={onContinue}>
            继续对局
          </button>
        ) : null}
        <button className={hasSave ? "game-secondary-action" : "game-primary-action"} disabled={loading} type="button" onClick={onStart}>
          {hasSave ? "开始新局" : "开始本机双人对局"}
        </button>
      </div>
      <small>{loading ? "正在检查本地存档…" : "自动保存 · 无计时 · 无需登录"}</small>
    </div>
  );
}

export function ConfirmDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title,
}: {
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => cancelButton.current?.focus(), []);

  return (
    <div className="game-dialog-backdrop">
      <div className="game-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div>
          <button ref={cancelButton} className="game-secondary-action" type="button" onClick={onCancel}>取消</button>
          <button className="game-danger-action" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function GameOverPanel({
  canUndo,
  game,
  onRestart,
  onUndo,
}: {
  canUndo: boolean;
  game: GameState;
  onRestart: () => void;
  onUndo: () => void;
}) {
  return (
    <section className="game-over-panel game-overlay-panel" aria-labelledby="game-over-title">
      <p className="game-kicker">BATTLE CONCLUDED · 战局已定</p>
      <h2 id="game-over-title">{formatGameOutcome(game)}</h2>
      <p>将帅仍保留在规则棋盘中，后续战斗时间线可在这里叠加败亡演出。</p>
      <div className="game-menu-actions">
        {canUndo ? <button className="game-secondary-action" type="button" onClick={onUndo}>悔棋复战</button> : null}
        <button className="game-primary-action" type="button" onClick={onRestart}>开始新局</button>
      </div>
    </section>
  );
}

export function GameHud({
  game,
  interactionLocked,
  onResign,
  onRestart,
  onSettingsChange,
  onSkip,
  onUndo,
  selectedMoveCount,
  settings,
  warning,
}: {
  game: GameState;
  interactionLocked: boolean;
  onResign: () => void;
  onRestart: () => void;
  onSettingsChange: (settings: GameSettings) => void;
  onSkip: () => void;
  onUndo: () => void;
  selectedMoveCount: number;
  settings: GameSettings;
  warning?: string;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canUndo = game.lastAction?.kind === "move" && !interactionLocked;
  const ended = game.status.kind === "ended";
  const check = game.status.kind === "playing" ? game.status.check : null;

  return (
    <div className="game-hud" aria-label="对局控制台">
      <section
        className={`game-turn-card ${game.sideToMove}`}
        aria-label="当前回合"
        data-check={check ? "true" : undefined}
      >
        <span>{interactionLocked ? "演出处理中" : ended ? "棋局结束" : "当前行动"}</span>
        <strong>{ended ? formatGameOutcome(game) : SIDE_LABELS[game.sideToMove]}</strong>
        <small>
          {check ? `${SIDE_LABELS[check]}被将军` : selectedMoveCount > 0 ? `${selectedMoveCount} 个合法落点` : `第 ${game.history.length + 1} 手`}
        </small>
      </section>

      <aside className="game-history" aria-label="着法历史">
        <div>
          <span>着法历史</span>
          <strong>{game.history.length}</strong>
        </div>
        {game.history.length === 0 ? (
          <p>尚未落子</p>
        ) : (
          <ol>
            {game.history.slice(-8).reverse().map((move) => (
              <li key={move.revision}>
                <span>{move.revision}</span>
                <span>{move.notation}</span>
                {move.captured ? <em>吃</em> : null}
              </li>
            ))}
          </ol>
        )}
      </aside>

      {warning ? <p className="game-persistence-warning" role="status">{warning}</p> : null}

      <nav className="game-action-bar" aria-label="棋局操作">
        {interactionLocked ? <button className="game-skip-action" type="button" onClick={onSkip}>跳过演出</button> : null}
        <button disabled={!canUndo} type="button" onClick={onUndo}>悔棋</button>
        <button disabled={interactionLocked || ended} type="button" onClick={onResign}>认输</button>
        <button disabled={interactionLocked} type="button" onClick={onRestart}>重新开局</button>
        <button aria-expanded={settingsOpen} type="button" onClick={() => setSettingsOpen((open) => !open)}>设置</button>
      </nav>

      {settingsOpen ? (
        <section className="game-settings" aria-label="对局设置">
          <label>
            <span>画质</span>
            <select
              value={settings.quality}
              onChange={(event) => onSettingsChange({ ...settings, quality: event.target.value as GameSettings["quality"] })}
            >
              {Object.entries(QUALITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {VOLUME_CONTROLS.map(([key, label]) => {
            const value = settings[key];
            if (typeof value !== "number") return null;
            return (
              <label key={key}>
                <span>{label} · {Math.round(value * 100)}%</span>
                <input
                  aria-label={label}
                  max="1"
                  min="0"
                  step="0.01"
                  type="range"
                  value={value}
                  onChange={(event) => onSettingsChange({ ...settings, [key]: Number(event.target.value) })}
                />
              </label>
            );
          })}
          <label className="game-toggle-row">
            <input checked={settings.muted} type="checkbox" onChange={(event) => onSettingsChange({ ...settings, muted: event.target.checked })} />
            <span>静音</span>
          </label>
          <label className="game-toggle-row">
            <input checked={settings.reducedMotion} type="checkbox" onChange={(event) => onSettingsChange({ ...settings, reducedMotion: event.target.checked })} />
            <span>减少动态效果</span>
          </label>
          <p role="note">配乐与视觉采用秦风灵感的幻想沙盘设定，并非历史音乐或史实复原。</p>
        </section>
      ) : null}
    </div>
  );
}
