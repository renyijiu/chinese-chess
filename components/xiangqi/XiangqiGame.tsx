"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { BoardViewer } from "../../app/BoardViewer";
import {
  createInitialGame,
  dispatch,
  formatSquareCoordinate,
  getPieceAt,
  type CommandErrorCode,
  type DomainEvent,
  type GameCommand,
  type GameState,
  type Side,
  type Square,
} from "../../lib/xiangqi/index";
import type { GameActionHandler, GameActionTransition } from "./game/actions";
import { AnimationRegistry } from "./animation/AnimationRegistry";
import { AudioEngine } from "./audio/AudioEngine";
import { handlePresentationAudioCue } from "./audio/presentation-audio";
import { SemanticAudioDirector } from "./audio/SemanticAudioDirector";
import {
  deriveSelection,
  moveKeyboardCursor,
  resolveBoardClick,
} from "./game/controller";
import { GameBoardLayer } from "./game/GameBoardLayer";
import { PresentationStore } from "./presentation/PresentationStore";
import {
  DEFAULT_GAME_SETTINGS,
  GAME_SETTINGS_KEY,
  loadGameSettings,
  loadGameSnapshot,
  saveGameSettings,
  saveGameSnapshot,
  type GameSettings,
  type StorageLike,
} from "./game/storage";
import {
  ConfirmDialog,
  formatGameOutcome,
  GameHud,
  GameMenu,
  GameOverPanel,
} from "./hud/GameHud";
import { KeyboardBoardControl } from "./hud/KeyboardBoardControl";

type Confirmation =
  | Readonly<{ kind: "new-game" | "restart" }>
  | Readonly<{ kind: "resign"; revision: number; side: GameState["sideToMove"] }>
  | null;

const ERROR_MESSAGES: Record<CommandErrorCode, string> = {
  "stale-revision": "这次操作已过期，请重新选择棋子。",
  "game-over": "棋局已经结束。",
  "invalid-square": "该交叉点不在棋盘范围内。",
  "no-piece": "起点没有棋子。",
  "not-your-turn": "现在轮到另一方行动。",
  "illegal-move": "该落点不符合当前局面的规则。",
  "cannot-undo": "当前不能再次悔棋。",
};

const ROLE_LABELS = {
  advisor: "仕士",
  cannon: "炮",
  chariot: "车",
  elephant: "相象",
  general: "帅将",
  horse: "马",
  soldier: "兵卒",
} as const;

const BOARD_NAVIGATION_KEYS = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "a",
  "d",
  "s",
  "w",
]);

function eventAnnouncement(events: readonly DomainEvent[], game: GameState) {
  const ended = events.find((event) => event.type === "GameEnded");
  if (ended) return formatGameOutcome(game);
  const undone = events.find((event) => event.type === "MoveUndone");
  if (undone?.type === "MoveUndone") return `已撤回 ${undone.move.notation}`;
  const move = events.find((event) => event.type === "MoveCommitted");
  const captured = events.some((event) => event.type === "PieceCaptured");
  const check = events.find((event) => event.type === "CheckDeclared");
  if (move?.type === "MoveCommitted") {
    const suffix = check?.type === "CheckDeclared" ? "，将军" : captured ? "，完成吃子" : "";
    return `${move.move.notation}${suffix}`;
  }
  return "棋局状态已更新。";
}

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function describeKeyboardSquare(game: GameState, square: Square) {
  const piece = getPieceAt(game, square);
  if (!piece) return "空交叉点";
  return `${piece.side === "red" ? "红方" : "黑方"}${ROLE_LABELS[piece.role]}`;
}

function GameInitializationShell({
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

export function XiangqiGame({ onAction }: { onAction?: GameActionHandler }) {
  const [animations] = useState(() => new AnimationRegistry());
  const [audio] = useState(() => new AudioEngine());
  const [semanticAudio] = useState(() => new SemanticAudioDirector(audio));
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [keyboardSquare, setKeyboardSquare] = useState<Square>({ file: 4, rank: 0 });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("准备开始本机双人对局。");
  const [phase, setPhase] = useState<"menu" | "playing">("menu");
  const [presentation] = useState(() => new PresentationStore());
  const [savedGame, setSavedGame] = useState<GameState | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_GAME_SETTINGS);
  const [storageWarning, setStorageWarning] = useState<string>();
  const [unsafeSavePresent, setUnsafeSavePresent] = useState(false);
  const [viewSide, setViewSide] = useState<Side>("red");
  const actionInFlight = useRef(false);
  const keyboardControlRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const matchEpoch = useRef(0);
  const storageRef = useRef<StorageLike | null>(null);

  const selection = useMemo(
    () => deriveSelection(game, selectedPieceId),
    [game, selectedPieceId],
  );

  useEffect(() => {
    mounted.current = true;
    const initializationFrame = window.requestAnimationFrame(() => {
      const storage = browserStorage();
      storageRef.current = storage;
      if (!storage) {
        setStorageWarning("浏览器存储不可用，本局将只保存在内存中。");
        setLoading(false);
        return;
      }

      const loaded = loadGameSnapshot(storage);
      const loadedSettings = loadGameSettings(storage);
      let hasStoredSettings = false;
      try {
        hasStoredSettings = Boolean(storage.getItem(GAME_SETTINGS_KEY));
      } catch {
        // The load helpers already recover to safe defaults.
      }
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setSettings(hasStoredSettings
        ? loadedSettings
        : { ...loadedSettings, reducedMotion: prefersReducedMotion });
      setSavedGame(loaded.game);
      setStorageWarning(loaded.warning);
      setUnsafeSavePresent(loaded.source === "none" && Boolean(loaded.warning?.includes("损坏")));
      setLoading(false);
    });

    return () => {
      mounted.current = false;
      semanticAudio.dispose();
      presentation.dispose();
      animations.dispose();
      window.cancelAnimationFrame(initializationFrame);
    };
  }, [animations, presentation, semanticAudio]);

  useEffect(() => {
    const unsubscribeCue = presentation.subscribeCue((cue) => {
      semanticAudio.marker(cue.actionId, cue.marker);
      handlePresentationAudioCue(audio, cue);
    });
    const detachVisibility = audio.attachVisibility(document);
    return () => {
      unsubscribeCue();
      detachVisibility();
      void audio.dispose();
    };
  }, [audio, presentation, semanticAudio]);

  useEffect(() => {
    audio.setMix({
      ambient: settings.ambientVolume,
      master: settings.masterVolume,
      music: settings.musicVolume,
      sfx: settings.sfxVolume,
      ui: settings.uiVolume,
      voice: settings.voiceVolume,
    });
    audio.setMuted(settings.muted);
  }, [audio, settings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmation) {
        setConfirmation(null);
        setNotice("已取消确认操作。");
      } else if (selectedPieceId) {
        setSelectedPieceId(null);
        setNotice("已取消选择。 ");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmation, selectedPieceId]);

  const persist = useCallback((nextGame: GameState) => {
    const storage = storageRef.current;
    if (!storage) {
      setStorageWarning("浏览器存储不可用，本局将只保存在内存中。");
      return;
    }
    const result = saveGameSnapshot(storage, nextGame);
    if (!result.ok) setStorageWarning(result.warning);
  }, []);

  const finishAction = useCallback(() => {
    actionInFlight.current = false;
    if (mounted.current) setInteractionLocked(false);
  }, []);

  const applyCommand = useCallback((command: GameCommand) => {
    if (actionInFlight.current) return;
    const result = dispatch(game, command);
    if (result.error) {
      audio.play("ui.invalid");
      setNotice(ERROR_MESSAGES[result.error.code]);
      return;
    }

    actionInFlight.current = true;
    setInteractionLocked(true);
    setSelectedPieceId(null);
    setGame(result.state);
    setSavedGame(result.state);
    setUnsafeSavePresent(false);
    setNotice(eventAnnouncement(result.events, result.state));
    persist(result.state);

    const domainEventId = result.events[0]?.eventId ?? `${result.state.revision}:ui`;
    const transition: GameActionTransition = {
      actionId: `${matchEpoch.current}:${domainEventId}`,
      before: game,
      after: result.state,
      events: result.events,
      reducedMotion: settings.reducedMotion,
      viewSide,
    };
    try {
      if (presentation.active) {
        semanticAudio.cancelAll("game-replaced");
        presentation.skip("game-replaced");
      }
      semanticAudio.begin(transition);
      const visualAction = presentation.play(transition);
      const settledVisualAction = visualAction.then((result) => {
        semanticAudio.settle(
          transition.actionId,
          result.reason === "duplicate" ? "game-replaced" : result.reason,
        );
        return result;
      });
      const externalAction = onAction
        ? Promise.resolve().then(() => onAction(transition))
        : Promise.resolve();
      void Promise.allSettled([settledVisualAction, externalAction])
        .then((settled) => {
          if (settled.some((result) => result.status === "rejected") && mounted.current) {
            setNotice("演出未能完成，棋盘已直接对齐到正确局面。");
          }
        })
        .finally(finishAction);
    } catch {
      semanticAudio.settle(transition.actionId, "presentation-error");
      presentation.skip("presentation-error");
      setNotice("演出未能启动，棋盘已直接对齐到正确局面。");
      finishAction();
    }
  }, [audio, finishAction, game, onAction, persist, presentation, semanticAudio, settings.reducedMotion, viewSide]);

  const startFreshGame = useCallback(() => {
    const fresh = createInitialGame();
    semanticAudio.cancelAll("match-reset");
    presentation.skip("match-reset");
    actionInFlight.current = false;
    setGame(fresh);
    setKeyboardSquare({ file: 4, rank: 0 });
    setSavedGame(fresh);
    setSelectedPieceId(null);
    setInteractionLocked(false);
    setUnsafeSavePresent(false);
    setConfirmation(null);
    setPhase("playing");
    setNotice("新局开始，红方先行。 ");
    persist(fresh);
    matchEpoch.current += 1;
    window.requestAnimationFrame(() => keyboardControlRef.current?.focus());
  }, [persist, presentation, semanticAudio]);

  const unlockAudio = useCallback(async () => {
    try {
      await audio.unlock();
      return true;
    } catch {
      setNotice("音频系统不可用，棋局仍可正常进行。");
      return false;
    }
  }, [audio]);

  const handleStart = async () => {
    await unlockAudio();
    audio.play("ui.confirm");
    if (savedGame || unsafeSavePresent) {
      setConfirmation({ kind: "new-game" });
      return;
    }
    startFreshGame();
  };

  const handleContinue = async () => {
    await unlockAudio();
    audio.play("ui.confirm");
    if (!savedGame) return;
    semanticAudio.cancelAll("game-replaced");
    presentation.skip("game-replaced");
    setGame(savedGame);
    setKeyboardSquare(savedGame.lastAction?.kind === "move" ? savedGame.lastAction.move.to : { file: 4, rank: 0 });
    setPhase("playing");
    setSelectedPieceId(null);
    setNotice(savedGame.status.kind === "ended" ? formatGameOutcome(savedGame) : `${savedGame.sideToMove === "red" ? "红方" : "黑方"}继续行动。`);
    // An ended save can still be resumed through Undo, but adoption itself
    // never creates a presentation action or replays the historical result.
    matchEpoch.current += 1;
    window.requestAnimationFrame(() => keyboardControlRef.current?.focus());
  };

  const handleSquarePress = (square: Square) => {
    setKeyboardSquare(square);
    if (interactionLocked || game.status.kind === "ended") return;
    const decision = resolveBoardClick(game, selection, square);
    if (decision.kind === "move") {
      applyCommand(decision.command);
    } else {
      audio.play(decision.selection.pieceId ? "ui.select" : decision.announcement === "已取消选择。" ? "ui.select" : "ui.invalid");
      setSelectedPieceId(decision.selection.pieceId);
      setNotice(decision.announcement);
    }
  };

  const handleKeyboardBoardKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const normalizedKey = event.key.toLowerCase();
    if (BOARD_NAVIGATION_KEYS.has(normalizedKey)) {
      event.preventDefault();
      const nextSquare = moveKeyboardCursor(keyboardSquare, event.key);
      setKeyboardSquare(nextSquare);
      setNotice(`${formatSquareCoordinate(nextSquare)}，${describeKeyboardSquare(game, nextSquare)}。`);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (interactionLocked) {
      setNotice("演出处理中，可先跳过演出再继续操作。");
      return;
    }
    handleSquarePress(keyboardSquare);
  };

  const handleSettingsChange = (nextSettings: GameSettings) => {
    setSettings(nextSettings);
    const storage = storageRef.current;
    if (!storage) {
      setStorageWarning("设置仅在当前页面有效；浏览器存储不可用。 ");
      return;
    }
    const result = saveGameSettings(storage, nextSettings);
    if (!result.ok) setStorageWarning(result.warning);
  };

  const confirmDetails = confirmation?.kind === "resign"
    ? {
        title: "确认认输？",
        description: `${confirmation.side === "red" ? "红方" : "黑方"}认输后立即判负，且不能悔棋。`,
        label: "确认认输",
      }
    : {
        title: "覆盖当前棋局？",
        description: unsafeSavePresent
          ? "检测到损坏的本地存档。确认后将以标准初始局面覆盖它。"
          : "当前棋局和可恢复备份将被新的标准初始局面取代。",
        label: "开始新局",
      };

  const handleConfirm = () => {
    if (!confirmation) return;
    if (confirmation.kind === "resign") {
      const expectedRevision = confirmation.revision;
      setConfirmation(null);
      applyCommand({ type: "resign", expectedRevision });
      return;
    }
    startFreshGame();
  };

  const boardStatus = game.status.kind === "ended"
    ? formatGameOutcome(game)
    : `${game.sideToMove === "red" ? "红方" : "黑方"}行动${game.status.check ? " · 将军" : ""}`;

  return (
    <div
      className="xiangqi-game-shell"
      data-audio-state={audio.state === "locked" ? "locked" : settings.muted ? "muted" : "running"}
      data-game-revision={game.revision}
      data-quality={settings.quality}
      data-reduced-motion={settings.reducedMotion ? "true" : "false"}
    >
      <div inert={confirmation ? true : undefined} aria-hidden={confirmation ? true : undefined}>
        {loading ? (
          <GameInitializationShell onContinue={handleContinue} onStart={handleStart} />
        ) : (
          <BoardViewer
            animations={animations}
            audio={audio}
            overlay={phase === "menu" ? (
              <GameMenu
                hasSave={Boolean(savedGame)}
                loading={false}
                onContinue={handleContinue}
                onStart={handleStart}
                warning={storageWarning}
              />
            ) : (
              <>
                <GameHud
                  game={game}
                  interactionLocked={interactionLocked}
                  onResign={() => setConfirmation({ kind: "resign", revision: game.revision, side: game.sideToMove })}
                  onRestart={() => setConfirmation({ kind: "restart" })}
                  onUndo={() => applyCommand({ type: "undo", expectedRevision: game.revision })}
                  onSettingsChange={handleSettingsChange}
                  onSkip={() => presentation.skip("user-skip")}
                  selectedMoveCount={selection.legalMoves.length}
                  settings={settings}
                  warning={storageWarning}
                />
                {game.status.kind === "playing" ? (
                  <KeyboardBoardControl
                    active={keyboardActive}
                    announcement={describeKeyboardSquare(game, keyboardSquare)}
                    controlRef={keyboardControlRef}
                    coordinate={formatSquareCoordinate(keyboardSquare)}
                    interactionLocked={interactionLocked}
                    onBlur={() => setKeyboardActive(false)}
                    onFocus={() => setKeyboardActive(true)}
                    onKeyDown={handleKeyboardBoardKeyDown}
                  />
                ) : null}
                {game.status.kind === "ended" ? (
                  <GameOverPanel
                    canUndo={game.lastAction?.kind === "move" && !interactionLocked}
                    game={game}
                    onRestart={() => setConfirmation({ kind: "restart" })}
                    onUndo={() => applyCommand({ type: "undo", expectedRevision: game.revision })}
                  />
                ) : null}
              </>
            )}
            pieceLayer={(
              <GameBoardLayer
                animations={animations}
                disabled={phase !== "playing" || interactionLocked || game.status.kind === "ended"}
                game={game}
                keyboardSquare={keyboardActive ? keyboardSquare : null}
                legalMoves={selection.legalMoves}
                onSquarePress={handleSquarePress}
                presentation={presentation}
                quality={settings.quality}
                selectedPieceId={selection.pieceId}
              />
            )}
            quality={settings.quality}
            presentation={presentation}
            reducedMotion={settings.reducedMotion}
            status={boardStatus}
            viewSide={viewSide}
            onViewSideChange={setViewSide}
          />
        )}
      </div>

      {confirmation ? (
        <ConfirmDialog
          confirmLabel={confirmDetails.label}
          description={confirmDetails.description}
          onCancel={() => setConfirmation(null)}
          onConfirm={handleConfirm}
          title={confirmDetails.title}
        />
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">{notice}</p>
    </div>
  );
}
