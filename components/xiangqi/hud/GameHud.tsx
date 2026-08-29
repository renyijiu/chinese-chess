"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { CapturedPiece, GameState, MoveRecord, Role, Side } from "../../../lib/xiangqi/index";
import type { OpponentCoordinatorSnapshot } from "../ai/OpponentCoordinator";
import type {
  ComputerDifficulty,
  ComputerMatchConfig,
  OpponentTier,
  SavedMatch,
} from "../game/match";
import type { GameSettings } from "../game/storage";
import { ComputerMatchSetup, DIFFICULTY_LABELS } from "./ComputerMatchSetup";

const SIDE_LABELS: Record<Side, string> = { red: "红方", black: "黑方" };
const PIECE_GLYPHS: Record<Side, Record<Role, string>> = {
  red: {
    general: "帅",
    advisor: "仕",
    elephant: "相",
    chariot: "俥",
    horse: "傌",
    cannon: "炮",
    soldier: "兵",
  },
  black: {
    general: "将",
    advisor: "士",
    elephant: "象",
    chariot: "車",
    horse: "馬",
    cannon: "砲",
    soldier: "卒",
  },
};
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
const TIER_LABELS: Record<OpponentTier, string> = {
  "lightweight-easy": "简单",
  "lightweight-normal": "标准",
  "lightweight-hard": "困难",
  "fairy-master": "大师",
};

type CapturedPieceLedgerEntry = Readonly<{
  count: number;
  glyph: string;
  role: Role;
}>;

export function formatCaptureDetail(captured: CapturedPiece): string {
  const side = captured.side === "red" ? "红" : "黑";
  return `吃${side}${PIECE_GLYPHS[captured.side][captured.role]}`;
}

export function deriveCapturedPieceLedger(history: readonly MoveRecord[]): Readonly<
  Record<Side, readonly CapturedPieceLedgerEntry[]>
> {
  const grouped: Record<Side, Map<Role, number>> = {
    red: new Map<Role, number>(),
    black: new Map<Role, number>(),
  };
  for (const move of history) {
    if (!move.captured) continue;
    const losses = grouped[move.captured.side];
    losses.set(move.captured.role, (losses.get(move.captured.role) ?? 0) + 1);
  }
  return {
    red: [...grouped.red].map(([role, count]) => ({ count, glyph: PIECE_GLYPHS.red[role], role })),
    black: [...grouped.black].map(([role, count]) => ({ count, glyph: PIECE_GLYPHS.black[role], role })),
  };
}

export function deriveVisibleMoveHistory(
  history: readonly MoveRecord[],
  expanded: boolean,
): readonly MoveRecord[] {
  return history.slice(expanded ? 0 : -8).reverse();
}

const CapturedPieceLedger = memo(function CapturedPieceLedger({ history }: {
  history: readonly MoveRecord[];
}) {
  const ledger = useMemo(() => deriveCapturedPieceLedger(history), [history]);
  const format = (entries: readonly CapturedPieceLedgerEntry[]) => entries.length === 0
    ? "—"
    : entries.map((entry) => `${entry.glyph}${entry.count > 1 ? `×${entry.count}` : ""}`).join(" ");
  return (
    <div className="game-capture-ledger" aria-label="被吃棋子">
      <span className="red"><small>红方损失</small><strong>{format(ledger.red)}</strong></span>
      <span className="black"><small>黑方损失</small><strong>{format(ledger.black)}</strong></span>
    </div>
  );
});

export type OpponentHudState = Readonly<{
  config: ComputerMatchConfig;
  computerOwnsTurn: boolean;
  snapshot: OpponentCoordinatorSnapshot;
}>;

export type GameHudPermissions = Readonly<{
  showUndo: boolean;
  canUndo: boolean;
  canResign: boolean;
}>;

export function deriveGameHudPermissions(
  match: SavedMatch,
  commandBusy: boolean,
): GameHudPermissions {
  return {
    showUndo: match.config.mode === "local",
    canUndo: match.config.mode === "local"
      && match.game.lastAction?.kind === "move"
      && !commandBusy,
    canResign: match.game.status.kind === "playing"
      && !commandBusy
      && (match.config.mode === "local" || match.game.sideToMove === match.config.humanSide),
  };
}

export function describeOpponentStatus(opponent: OpponentHudState): string {
  const { phase } = opponent.snapshot;
  let activity: string;
  switch (phase) {
    case "booting": activity = "正在加载电脑对手"; break;
    case "searching": activity = "电脑正在思考"; break;
    case "candidatePending": activity = "电脑已选定落点"; break;
    case "committing": activity = "电脑正在落子"; break;
    case "stopping": activity = "正在停止旧的计算"; break;
    case "fallback": activity = "电脑对手正在降级恢复"; break;
    case "hidden": activity = "页面已隐藏，电脑计算已暂停"; break;
    case "terminal": activity = "棋局已经结束"; break;
    case "failed": activity = "电脑对手暂时不可用，可重新开局重试"; break;
    case "disposed": activity = "电脑对手已经关闭"; break;
    default: activity = opponent.computerOwnsTurn ? "电脑准备思考" : "轮到你行动";
  }
  return opponent.config.requestedDifficulty === "master"
    && opponent.config.effectiveTier === "lightweight-hard"
    ? `大师引擎不可用，已保存并回退至困难；${activity}`
    : activity;
}

export function formatGameOutcome(game: GameState) {
  if (game.status.kind !== "ended") return "棋局进行中";
  const reason = END_REASON_LABELS[game.status.reason];
  return game.status.winner
    ? `${SIDE_LABELS[game.status.winner]}胜 · ${reason}`
    : `和棋 · ${reason}`;
}

export function GameMenu({
  animateMatchId = null,
  hasSave,
  loading,
  onConfirmComputer,
  onContinue,
  onRollComputer,
  onStart,
  preparedComputerMatch = null,
  reducedMotion = false,
  warning,
}: {
  animateMatchId?: string | null;
  hasSave: boolean;
  loading: boolean;
  onConfirmComputer?: () => void;
  onContinue: () => void;
  onRollComputer?: (difficulty: ComputerDifficulty) => void;
  onStart: () => void;
  preparedComputerMatch?: ComputerMatchConfig | null;
  reducedMotion?: boolean;
  warning?: string;
}) {
  const [mode, setMode] = useState<"local" | "computer">(
    preparedComputerMatch ? "computer" : "local",
  );
  const [difficulty, setDifficulty] = useState<ComputerDifficulty>(
    preparedComputerMatch?.requestedDifficulty ?? "normal",
  );

  return (
    <div className="game-menu game-overlay-panel" role="dialog" aria-labelledby="game-menu-title">
      <p className="game-kicker">QIN DIORAMA · 秦俑棋局</p>
      <h2 id="game-menu-title">兵临九宫</h2>
      <p>选择本机双人或无需后端的人机对战。规则仍由同一套中国象棋引擎裁定，红方先行。</p>
      {warning ? <p className="game-warning" role="status">{warning}</p> : null}
      {hasSave && !preparedComputerMatch ? (
        <button className="game-continue-action game-primary-action" disabled={loading} type="button" onClick={onContinue}>
          继续对局
        </button>
      ) : null}

      <div className="game-mode-switch" role="group" aria-label="对局模式">
        <button aria-pressed={mode === "local"} disabled={loading} type="button" onClick={() => setMode("local")}>本机双人</button>
        <button aria-pressed={mode === "computer"} disabled={loading} type="button" onClick={() => setMode("computer")}>人机对战</button>
      </div>

      {mode === "local" ? (
        <section className="local-match-setup" aria-labelledby="local-setup-title">
          <h3 id="local-setup-title">同屏对弈</h3>
          <p>红黑双方轮流操作；保留单步悔棋，所有走法、将军与终局规则保持不变。</p>
          <button className="game-primary-action" disabled={loading} type="button" onClick={onStart}>
            {hasSave ? "开始新的本机双人对局" : "开始本机双人对局"}
          </button>
        </section>
      ) : (
        <ComputerMatchSetup
          animateMatchId={animateMatchId}
          difficulty={difficulty}
          disabled={loading}
          onConfirm={() => onConfirmComputer?.()}
          onDifficultyChange={setDifficulty}
          onRoll={() => onRollComputer?.(difficulty)}
          preparedConfig={preparedComputerMatch}
          reducedMotion={reducedMotion}
        />
      )}
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
  opponent,
  onResign,
  onRestart,
  onSettingsChange,
  onSkip,
  onUndo,
  permissions,
  presentationBusy,
  selectedMoveCount,
  settings,
  warning,
}: {
  game: GameState;
  opponent?: OpponentHudState;
  onResign: () => void;
  onRestart: () => void;
  onSettingsChange: (settings: GameSettings) => void;
  onSkip: () => void;
  onUndo: () => void;
  permissions: GameHudPermissions;
  presentationBusy: boolean;
  selectedMoveCount: number;
  settings: GameSettings;
  warning?: string;
}) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ended = game.status.kind === "ended";
  const check = game.status.kind === "playing" ? game.status.check : null;
  const opponentStatus = opponent ? describeOpponentStatus(opponent) : null;
  const turnLabel = presentationBusy ? "演出处理中"
    : ended ? "棋局结束"
      : opponent ? opponent.computerOwnsTurn ? "电脑回合" : "你的回合"
        : "当前行动";
  const toggleHistory = () => {
    const expanded = !historyExpanded;
    setHistoryExpanded(expanded);
    if (expanded) setSettingsOpen(false);
  };
  const toggleSettings = () => {
    const open = !settingsOpen;
    setSettingsOpen(open);
    if (open) setHistoryExpanded(false);
  };

  return (
    <div className="game-hud" aria-label="对局控制台">
      <section
        className={`game-turn-card ${game.sideToMove}`}
        aria-label="当前回合"
        aria-live="polite"
        role="status"
        data-check={check ? "true" : undefined}
      >
        <span>{turnLabel}</span>
        <strong>{ended ? formatGameOutcome(game) : SIDE_LABELS[game.sideToMove]}</strong>
        <small>
          {check ? `${SIDE_LABELS[check]}被将军` : selectedMoveCount > 0 ? `${selectedMoveCount} 个合法落点` : `第 ${game.history.length + 1} 手`}
        </small>
      </section>

      {opponent ? (
        <section className="game-opponent-status" aria-label="对手状态" aria-live="polite" role="status">
          <div>
            <span>电脑对手</span>
            <strong>{DIFFICULTY_LABELS[opponent.config.requestedDifficulty]}</strong>
          </div>
          <p>{opponentStatus}</p>
          <small>
            你执{SIDE_LABELS[opponent.config.humanSide]} · 实际强度 {TIER_LABELS[opponent.config.effectiveTier]}
          </small>
          {opponent.snapshot.failure ? <em>当前局面保持不变，可使用“重新开局”重试。</em> : null}
        </section>
      ) : null}

      <aside
        className="game-history"
        aria-label="着法历史"
        data-expanded={historyExpanded ? "true" : "false"}
      >
        <div className="game-history-heading">
          <span>着法历史</span>
          <strong>{game.history.length}</strong>
          <button
            aria-controls="game-history-moves"
            aria-expanded={historyExpanded}
            aria-label={historyExpanded ? "收起着法历史" : "展开完整着法历史"}
            type="button"
            onClick={toggleHistory}
          >
            {historyExpanded ? "收起" : "展开"}
          </button>
        </div>
        <CapturedPieceLedger history={game.history} />
        {game.history.length === 0 ? (
          <p>尚未落子</p>
        ) : (
          <ol id="game-history-moves">
            {deriveVisibleMoveHistory(game.history, historyExpanded).map((move, index) => (
              <li
                data-capture={move.captured ? "true" : undefined}
                data-last-move={index === 0 ? "true" : undefined}
                key={move.revision}
              >
                <span>{move.revision}</span>
                <span>{move.notation}</span>
                {move.captured ? <em>{formatCaptureDetail(move.captured)}</em> : null}
              </li>
            ))}
          </ol>
        )}
      </aside>

      {warning ? <p className="game-persistence-warning" role="status">{warning}</p> : null}

      <nav className="game-action-bar" aria-label="棋局操作">
        {presentationBusy ? <button className="game-skip-action" type="button" onClick={onSkip}>跳过演出</button> : null}
        {permissions.showUndo ? <button disabled={!permissions.canUndo} type="button" onClick={onUndo}>悔棋</button> : null}
        <button disabled={!permissions.canResign || ended} type="button" onClick={onResign}>认输</button>
        <button type="button" onClick={onRestart}>重新开局</button>
        <button aria-expanded={settingsOpen} type="button" onClick={toggleSettings}>设置</button>
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
