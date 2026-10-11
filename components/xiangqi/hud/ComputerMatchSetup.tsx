"use client";

import { useEffect, useRef, useState } from "react";

import type { ComputerDifficulty, ComputerMatchConfig } from "../game/match";

export const DIFFICULTY_LABELS: Record<ComputerDifficulty, string> = {
  easy: "简单",
  normal: "标准",
  hard: "困难",
  master: "大师",
};

const DIFFICULTY_DESCRIPTIONS: Record<ComputerDifficulty, string> = {
  easy: "节奏轻快，适合熟悉棋盘与角色。",
  normal: "出手较快，攻防均衡。",
  hard: "算得更深，适合有经验的棋手。",
  master: "最强的引擎，首次使用需要下载约 13 MB。",
};

const SIDE_LABELS = { red: "红方", black: "黑方" } as const;

export function ComputerMatchSetup({
  animateMatchId,
  difficulty,
  disabled = false,
  onConfirm,
  onDifficultyChange,
  onRoll,
  preparedConfig,
  reducedMotion,
}: {
  animateMatchId: string | null;
  difficulty: ComputerDifficulty;
  disabled?: boolean;
  onConfirm: () => void;
  onDifficultyChange: (difficulty: ComputerDifficulty) => void;
  onRoll: () => void;
  preparedConfig: ComputerMatchConfig | null;
  reducedMotion: boolean;
}) {
  const [settledMatchId, setSettledMatchId] = useState<string | null>(() =>
    preparedConfig && (reducedMotion || animateMatchId !== preparedConfig.matchId)
      ? preparedConfig.matchId
      : null,
  );
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!preparedConfig) return;
    if (reducedMotion || animateMatchId !== preparedConfig.matchId) {
      const focusFrame = window.requestAnimationFrame(() => confirmButton.current?.focus());
      return () => window.cancelAnimationFrame(focusFrame);
    }
    const timer = window.setTimeout(() => {
      setSettledMatchId(preparedConfig.matchId);
      confirmButton.current?.focus();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [animateMatchId, preparedConfig, reducedMotion]);

  const rolling = Boolean(preparedConfig && settledMatchId !== preparedConfig.matchId);
  const assignedSide = preparedConfig?.humanSide;

  return (
    <section className="computer-match-setup" aria-labelledby="computer-setup-title">
      <div className="computer-setup-heading">
        <div>
          <span>SOLO CAMPAIGN · 人机对战</span>
          <h3 id="computer-setup-title">选择难度</h3>
        </div>
        <p>掷一枚公平六面骰：奇数执红，偶数执黑；红方始终先行。</p>
      </div>

      <fieldset className="computer-difficulty" disabled={disabled || Boolean(preparedConfig)}>
        <legend className="sr-only">电脑难度</legend>
        {(Object.keys(DIFFICULTY_LABELS) as ComputerDifficulty[]).map((value) => (
          <label
            aria-label={`${DIFFICULTY_LABELS[value]}：${DIFFICULTY_DESCRIPTIONS[value]}`}
            htmlFor={`computer-difficulty-${value}`}
            key={value}
          >
            <input
              aria-label={DIFFICULTY_LABELS[value]}
              checked={difficulty === value}
              id={`computer-difficulty-${value}`}
              name="computer-difficulty"
              type="radio"
              value={value}
              onChange={() => onDifficultyChange(value)}
            />
            <span>
              <strong>{DIFFICULTY_LABELS[value]}</strong>
              <small>{DIFFICULTY_DESCRIPTIONS[value]}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {difficulty === "master" ? (
        <p className="computer-master-disclosure" role="note">
          大师难度首次使用需要下载约 13 MB 的引擎（Fairy-Stockfish，GPL
          许可）。如果浏览器不支持或下载失败，本局会改用困难难度并提示你，棋局照常进行。
        </p>
      ) : null}

      {preparedConfig ? (
        <div
          aria-label="阵营分配结果"
          aria-live="polite"
          aria-atomic="true"
          className="computer-die-result"
          role="status"
        >
          <div
            aria-hidden="true"
            className="computer-die"
            data-rolling={rolling ? "true" : undefined}
          >
            {preparedConfig.dieResult}
          </div>
          <div>
            <span>{rolling ? "铜骰正在落定…" : `掷出 ${preparedConfig.dieResult}`}</span>
            <strong>
              {rolling ? "正在分配阵营" : `你执${SIDE_LABELS[preparedConfig.humanSide]}`}
            </strong>
            <small>
              {preparedConfig.humanSide === "red"
                ? "你先行。确认后即可落子。"
                : "电脑执红先行。确认后它会立即思考开局。"}
            </small>
          </div>
        </div>
      ) : null}

      <div className="computer-setup-actions">
        {preparedConfig ? (
          <button
            className="game-primary-action"
            disabled={disabled || rolling}
            ref={confirmButton}
            type="button"
            onClick={onConfirm}
          >
            以{assignedSide ? SIDE_LABELS[assignedSide] : "已分配阵营"}开始对局
          </button>
        ) : (
          <button
            className="game-primary-action"
            disabled={disabled}
            type="button"
            onClick={onRoll}
          >
            掷骰决定阵营
          </button>
        )}
      </div>
    </section>
  );
}
