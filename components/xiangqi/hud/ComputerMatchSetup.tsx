"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ComputerDifficulty,
  ComputerMatchConfig,
} from "../game/match";

export const DIFFICULTY_LABELS: Record<ComputerDifficulty, string> = {
  easy: "简单",
  normal: "标准",
  hard: "困难",
  master: "大师",
};

const DIFFICULTY_DESCRIPTIONS: Record<ComputerDifficulty, string> = {
  easy: "节奏轻快，适合熟悉棋盘与角色。",
  normal: "兼顾响应速度与基础攻防。",
  hard: "更深的局面搜索，适合有经验的棋手。",
  master: "可选强力引擎，首次使用需要下载运行资源。",
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
  const [settledMatchId, setSettledMatchId] = useState<string | null>(() => (
    preparedConfig && (reducedMotion || animateMatchId !== preparedConfig.matchId)
      ? preparedConfig.matchId
      : null
  ));
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
          <h3 id="computer-setup-title">选择对手强度</h3>
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
          大师模式首次使用需要下载并缓存 GPL 强力引擎资源；若浏览器能力、下载或初始化不可用，本局会明确提示并保存为困难难度继续，不会锁死棋盘。
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
            <strong>{rolling ? "正在分配阵营" : `你执${SIDE_LABELS[preparedConfig.humanSide]}`}</strong>
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
          <button className="game-primary-action" disabled={disabled} type="button" onClick={onRoll}>
            掷骰决定阵营
          </button>
        )}
      </div>
    </section>
  );
}
