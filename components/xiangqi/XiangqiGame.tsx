"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { BoardViewer } from "../../app/BoardViewer";
import {
  LIGHTWEIGHT_TIER_LIMITS,
} from "../../lib/xiangqi/ai/index";
import {
  fingerprintGame,
  formatSquareCoordinate,
  getPieceAt,
  serializeGame,
  sha256Hex,
  type CommandErrorCode,
  type DomainEvent,
  type GameCommand,
  type GameState,
  type Side,
  type Square,
} from "../../lib/xiangqi/index";
import { decodeSignalingMessageV1 } from "../../lib/xiangqi/online";
import { LightweightWorkerProvider } from "./ai/LightweightWorkerProvider";
import {
  createMasterEngineProvider,
  MASTER_SEARCH_LIMITS,
} from "./ai/MasterEngineAdapter";
import {
  OpponentCoordinator,
  type OpponentCandidateRelease,
  type OpponentCoordinatorSnapshot,
} from "./ai/OpponentCoordinator";
import {
  canIssueHumanCommand,
  deriveBoardCommandsLocked,
  isComputerTurn,
  opponentTurnRequestKey,
  shouldRequestOpponentTurn,
  type GameActionHandler,
  type GameActionTransition,
  type GamePhase,
} from "./game/actions";
import { AnimationRegistry } from "./animation/AnimationRegistry";
import { AudioEngine } from "./audio/AudioEngine";
import { handlePresentationAudioCue } from "./audio/presentation-audio";
import { SemanticAudioDirector } from "./audio/SemanticAudioDirector";
import {
  AuthoritativeCommandGate,
  type CommandCommit,
  type CommandGateReceipt,
} from "./game/command-gate";
import { AuthoritativeInstallLedger } from "./game/authoritative-install-ledger";
import {
  deriveSelection,
  moveKeyboardCursor,
  resolveBoardClick,
} from "./game/controller";
import { GameBoardLayer } from "./game/GameBoardLayer";
import {
  createComputerMatch,
  createLocalMatch,
  createOnlineMatch,
  onlineSideForRematch,
  setEffectiveOpponentTier,
  type ComputerDifficulty,
  type SavedMatch,
} from "./game/match";
import {
  OnlineMatchSession,
  type BoundOnlineMatchIdentity,
  type OnlineMatchSessionIdentity,
  type OnlineMatchSessionSnapshot,
} from "./online/OnlineMatchSession";
import type { OnlineCommitContext } from "./online/OnlineMatchCoordinator";
import { OnlineStatusCard } from "./online/OnlineStatusCard";
import { SignalingWizard } from "./online/SignalingWizard";
import { resolveOnlineRuntimeConfig } from "./online/config";
import { PresentationStore } from "./presentation/PresentationStore";
import { attachAudioDiagnostics, attachPresentationDiagnostics } from "./runtime/test-faults";
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
  deriveGameHudPermissions,
  formatGameOutcome,
  GameHud,
  GameMenu,
  GameOverPanel,
} from "./hud/GameHud";
import { KeyboardBoardControl } from "./hud/KeyboardBoardControl";

type NewGameTarget =
  | Readonly<{ mode: "local" }>
  | Readonly<{ mode: "computer"; difficulty: ComputerDifficulty }>
  | Readonly<{ mode: "online"; role: "host" | "guest" }>;

type OnlineSetup = Readonly<{
  role: "host" | "guest";
  intent: "new" | "resume";
  resumeMatch: SavedMatch | null;
  busy: boolean;
  error?: string;
}>;

type Confirmation =
  | Readonly<{ kind: "new-game"; target: NewGameTarget }>
  | Readonly<{ kind: "restart" }>
  | Readonly<{ kind: "resign"; revision: number; side: GameState["sideToMove"] }>
  | null;

class ControllerRuntime {
  #match: SavedMatch;
  #mounted = true;
  #commit: (commit: CommandCommit) => Promise<void> = async () => undefined;
  #fallback: (matchId: string, toTier: "lightweight-hard") => Promise<void> = async () => undefined;

  constructor(match: SavedMatch) {
    this.#match = match;
  }

  get currentMatch(): SavedMatch {
    return this.#match;
  }

  get isMounted(): boolean {
    return this.#mounted;
  }

  synchronize(match: SavedMatch): void {
    this.#match = match;
  }

  setMounted(mounted: boolean): void {
    this.#mounted = mounted;
  }

  setHandlers(
    commit: (value: CommandCommit) => Promise<void>,
    fallback: (matchId: string, toTier: "lightweight-hard") => Promise<void>,
  ): void {
    this.#commit = commit;
    this.#fallback = fallback;
  }

  commit(value: CommandCommit): Promise<void> {
    return this.#commit(value);
  }

  fallback(matchId: string, toTier: "lightweight-hard"): Promise<void> {
    return this.#fallback(matchId, toTier);
  }
}

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

const ONLINE_RUNTIME_CONFIG = resolveOnlineRuntimeConfig(
  process.env.NEXT_PUBLIC_XIANGQI_ONLINE_ENABLED,
  process.env.NEXT_PUBLIC_XIANGQI_STUN_URLS,
);

function randomOnlineId(prefix: string): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

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
  const [animateDieMatchId, setAnimateDieMatchId] = useState<string | null>(null);
  const [audio] = useState(() => new AudioEngine());
  const [semanticAudio] = useState(() => new SemanticAudioDirector(audio));
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [match, setMatch] = useState<SavedMatch>(() => createLocalMatch());
  const [commandBusy, setCommandBusy] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [keyboardSquare, setKeyboardSquare] = useState<Square>({ file: 4, rank: 0 });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("准备开始本机双人对局。");
  const [onlineSession, setOnlineSession] = useState<OnlineMatchSession | null>(null);
  const [onlineSnapshot, setOnlineSnapshot] = useState<OnlineMatchSessionSnapshot | null>(null);
  const [onlineSetup, setOnlineSetup] = useState<OnlineSetup | null>(null);
  const [phase, setPhase] = useState<GamePhase>("menu");
  const [presentation] = useState(() => new PresentationStore());
  const [resumableMatch, setResumableMatch] = useState<SavedMatch | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_GAME_SETTINGS);
  const [storageWarning, setStorageWarning] = useState<string>();
  const [unsafeSavePresent, setUnsafeSavePresent] = useState(false);
  const [viewSide, setViewSide] = useState<Side>("red");
  const focusBoardWhenReady = useRef(false);
  const keyboardControlRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const matchEpoch = useRef(0);
  const storageRef = useRef<StorageLike | null>(null);
  const matchRef = useRef(match);
  const gameRef = useRef(match.game);
  const phaseRef = useRef<GamePhase>(phase);
  const settingsRef = useRef(settings);
  const viewSideRef = useRef(viewSide);
  const onActionRef = useRef(onAction);
  const onlineSessionRef = useRef<OnlineMatchSession | null>(null);
  const [runtime] = useState(() => new ControllerRuntime(match));
  const [installLedger] = useState(() => new AuthoritativeInstallLedger());
  const [opponent] = useState(() => new OpponentCoordinator({
    providerFactory: async (tier) => {
      if (tier === "fairy-master") return createMasterEngineProvider();
      return new LightweightWorkerProvider();
    },
    onFallback: ({ matchId, toTier }) => {
      if (toTier !== "lightweight-hard") return;
      return runtime.fallback(matchId, toTier);
    },
  }));
  const [opponentSnapshot, setOpponentSnapshot] = useState<OpponentCoordinatorSnapshot>(
    () => opponent.getSnapshot(),
  );
  const [commandGate] = useState(() => new AuthoritativeCommandGate({
    getCurrentMatch: () => runtime.currentMatch,
    commit: (commit) => runtime.commit(commit),
    onBusyChange: (busy) => {
      if (runtime.isMounted) setCommandBusy(busy);
    },
  }));

  const game = match.game;

  useEffect(() => {
    matchRef.current = match;
    gameRef.current = match.game;
    phaseRef.current = phase;
    settingsRef.current = settings;
    viewSideRef.current = viewSide;
    onActionRef.current = onAction;
    runtime.synchronize(match);
  }, [match, onAction, phase, runtime, settings, viewSide]);

  const selection = useMemo(
    () => deriveSelection(game, selectedPieceId),
    [game, selectedPieceId],
  );

  useEffect(() => {
    mounted.current = true;
    runtime.setMounted(true);
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
      setResumableMatch(loaded.savedMatch);
      setStorageWarning(loaded.warning);
      setUnsafeSavePresent(loaded.source === "none" && Boolean(loaded.warning?.includes("损坏")));
      setLoading(false);
    });

    return () => {
      mounted.current = false;
      runtime.setMounted(false);
      commandGate.invalidate();
      installLedger.invalidate();
      onlineSessionRef.current?.dispose();
      opponent.dispose();
      semanticAudio.dispose();
      presentation.dispose();
      animations.dispose();
      window.cancelAnimationFrame(initializationFrame);
    };
  }, [animations, commandGate, installLedger, opponent, presentation, runtime, semanticAudio]);

  useEffect(() => {
    if (!onlineSession) return;
    return onlineSession.subscribe((snapshot) => {
      if (mounted.current) setOnlineSnapshot(snapshot);
    });
  }, [onlineSession]);

  useEffect(() => opponent.subscribe((snapshot) => {
    if (mounted.current) setOpponentSnapshot(snapshot);
  }), [opponent]);

  useEffect(() => {
    const handleVisibility = () => opponent.setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [opponent]);

  useEffect(() => {
    const unsubscribeCue = presentation.subscribeCue((cue) => {
      semanticAudio.marker(cue.actionId, cue.marker);
      handlePresentationAudioCue(audio, cue);
    });
    const detachVisibility = audio.attachVisibility(document);
    const detachDiagnostics = attachAudioDiagnostics(audio);
    const detachPresentationDiagnostics = attachPresentationDiagnostics(presentation);
    return () => {
      unsubscribeCue();
      detachVisibility();
      detachDiagnostics();
      detachPresentationDiagnostics();
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

  useEffect(() => {
    if (phase !== "playing" || !focusBoardWhenReady.current) return;
    keyboardControlRef.current?.focus();
    focusBoardWhenReady.current = false;
  }, [game, phase]);

  const persistMatch = useCallback((nextMatch: SavedMatch): boolean => {
    const storage = storageRef.current;
    if (!storage) {
      setStorageWarning("浏览器存储不可用，本局将只保存在内存中。");
      return false;
    }
    const result = saveGameSnapshot(storage, nextMatch);
    if (!result.ok) setStorageWarning(result.warning);
    return result.ok;
  }, []);

  useEffect(() => {
    const handleOnlineVisibility = () => {
      const visible = document.visibilityState !== "hidden";
      void onlineSessionRef.current?.setVisible(visible);
      if (!visible && matchRef.current.config.mode === "online") {
        persistMatch(matchRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleOnlineVisibility);
    handleOnlineVisibility();
    return () => document.removeEventListener("visibilitychange", handleOnlineVisibility);
  }, [onlineSession, persistMatch]);

  const handleCommandCommit = useCallback(async (commit: CommandCommit) => {
    const nextMatch = commit.after;
    // Storage is attempted before React exposes the new state. Failure is
    // recoverable: the in-memory SavedMatch remains authoritative and the UI
    // is marked non-resumable through the warning.
    const resumable = persistMatch(nextMatch);
    matchRef.current = nextMatch;
    gameRef.current = nextMatch.game;
    runtime.synchronize(nextMatch);
    setMatch(nextMatch);
    setResumableMatch(resumable ? nextMatch : null);
    setSelectedPieceId(null);
    setUnsafeSavePresent(false);
    setNotice(eventAnnouncement(commit.events, nextMatch.game));
    installLedger.markInstalled(commit.token);

    const domainEventId = commit.events[0]?.eventId ?? `${nextMatch.revision}:ui`;
    const transition: GameActionTransition = {
      actionId: `${matchEpoch.current}:${domainEventId}:${commit.token}`,
      before: commit.before.game,
      after: nextMatch.game,
      events: commit.events,
      reducedMotion: settingsRef.current.reducedMotion,
      viewSide: viewSideRef.current,
    };

    let settledVisualAction: Promise<unknown> = Promise.resolve();
    try {
      if (presentation.active) {
        semanticAudio.cancelAll("game-replaced");
        presentation.skip("game-replaced");
      }
      semanticAudio.begin(transition);
      const visualAction = presentation.play(transition);
      settledVisualAction = visualAction.then((result) => {
        semanticAudio.settle(
          transition.actionId,
          result.reason === "duplicate" ? "game-replaced" : result.reason,
        );
        return result;
      });
    } catch {
      semanticAudio.settle(transition.actionId, "presentation-error");
      presentation.skip("presentation-error");
      if (mounted.current) setNotice("演出未能启动，棋盘已直接对齐到正确局面。");
    }

    const externalAction = onActionRef.current
      ? Promise.resolve().then(() => onActionRef.current?.(transition))
      : Promise.resolve();
    const settled = await Promise.allSettled([settledVisualAction, externalAction]);
    if (settled.some((result) => result.status === "rejected") && mounted.current) {
      setNotice("演出未能完成，棋盘已直接对齐到正确局面。");
    }
  }, [installLedger, persistMatch, presentation, runtime, semanticAudio]);

  const handleOpponentFallback = useCallback(async (
    matchId: string,
    toTier: "lightweight-hard",
  ) => {
    const current = matchRef.current;
    if (current.config.mode !== "computer" || current.config.matchId !== matchId) return;
    const fallback = setEffectiveOpponentTier(current, toTier);
    const resumable = persistMatch(fallback);
    matchRef.current = fallback;
    gameRef.current = fallback.game;
    runtime.synchronize(fallback);
    setMatch(fallback);
    setResumableMatch(resumable ? fallback : null);
    if (mounted.current) setNotice("大师引擎当前不可用，本局已切换为困难难度。");
  }, [persistMatch, runtime]);

  useEffect(() => {
    runtime.setHandlers(handleCommandCommit, handleOpponentFallback);
  }, [handleCommandCommit, handleOpponentFallback, runtime]);

  const beforeCommandCommit = useCallback((commit: CommandCommit) => {
    if (commit.after.config.mode === "computer" && commit.after.game.status.kind === "ended") {
      opponent.setTerminal();
    }
  }, [opponent]);

  const applyCommand = useCallback(async (
    command: GameCommand,
    source: "human" | "opponent" = "human",
    opponentGuard?: (current: SavedMatch) => boolean,
  ): Promise<CommandGateReceipt> => {
    const current = matchRef.current;
    if (source === "human" && !canIssueHumanCommand(current, command)) {
      audio.play("ui.invalid");
      setNotice(command.type === "undo"
        ? "人机对局不支持悔棋。"
        : "当前由电脑行动，请等待对手落子。");
      return { status: "superseded", reason: "guard" };
    }

    const receipt = await commandGate.execute(command, {
      guard: (latest) => source === "human"
        ? canIssueHumanCommand(latest, command)
        : Boolean(opponentGuard?.(latest)),
      beforeCommit: beforeCommandCommit,
    });
    if (receipt.status === "rejected") {
      audio.play("ui.invalid");
      if (mounted.current) setNotice(ERROR_MESSAGES[receipt.error.code]);
    } else if (receipt.status === "superseded" && receipt.reason === "busy" && source === "human") {
      if (mounted.current) setNotice("当前动作仍在结算，请稍候。");
    }
    return receipt;
  }, [audio, beforeCommandCommit, commandGate]);

  const commitOnlineCommand = useCallback(async (
    command: GameCommand,
    context: OnlineCommitContext,
  ): Promise<{ status: "committed" | "rejected" | "superseded" }> => {
    await commandGate.whenIdle();
    const holder: { token?: string; installed?: Promise<void> } = {};
    const gateReceipt = commandGate.execute(command, {
      guard: (latest) => {
        if (latest.config.mode !== "online" || latest.game.status.kind !== "playing") return false;
        const actorSide = context.origin === "local"
          ? latest.config.localSide
          : latest.config.localSide === "red" ? "black" : "red";
        if (command.expectedRevision !== latest.revision) return false;
        if (command.type === "resign") return command.side === actorSide;
        return command.type === "move" && latest.game.sideToMove === actorSide;
      },
      beforeCommit: (commit) => {
        beforeCommandCommit(commit);
        holder.token = commit.token;
        holder.installed = installLedger.waitFor(commit.token);
      },
    });

    if (!holder.installed) {
      const receipt = await gateReceipt;
      return { status: receipt.status === "committed" ? "committed" : receipt.status };
    }

    return new Promise((resolve) => {
      let resolved = false;
      holder.installed?.then(() => {
        if (resolved) return;
        resolved = true;
        resolve({ status: "committed" });
      });
      void gateReceipt.then((receipt) => {
        if (receipt.status !== "committed" && holder.token) installLedger.cancel(holder.token);
        if (resolved) return;
        resolved = true;
        resolve({ status: receipt.status === "committed" ? "committed" : receipt.status });
      });
    });
  }, [beforeCommandCommit, commandGate, installLedger]);

  const installRecoveredOnlineGame = useCallback(async (recoveredGame: GameState) => {
    await commandGate.whenIdle();
    const current = matchRef.current;
    if (current.config.mode !== "online") return false;
    commandGate.invalidate();
    semanticAudio.cancelAll("game-replaced");
    presentation.skip("game-replaced");
    const recovered: SavedMatch = {
      config: current.config,
      game: recoveredGame,
      revision: recoveredGame.revision,
    };
    const resumable = persistMatch(recovered);
    matchRef.current = recovered;
    gameRef.current = recovered.game;
    runtime.synchronize(recovered);
    setMatch(recovered);
    setResumableMatch(resumable ? recovered : null);
    setSelectedPieceId(null);
    setNotice("已从双方一致的命令日志恢复棋局。");
    return true;
  }, [commandGate, persistMatch, presentation, runtime, semanticAudio]);

  const installFreshMatch = useCallback((
    fresh: SavedMatch,
    nextPhase: GamePhase,
    alreadyPersisted = false,
  ) => {
    opponent.invalidate();
    commandGate.invalidate();
    installLedger.invalidate();
    semanticAudio.cancelAll("match-reset");
    presentation.skip("match-reset");
    // Persist the complete match config (including the die result) before any
    // setup animation or playable state is exposed.
    const resumable = alreadyPersisted || persistMatch(fresh);
    matchEpoch.current += 1;
    matchRef.current = fresh;
    gameRef.current = fresh.game;
    phaseRef.current = nextPhase;
    runtime.synchronize(fresh);
    focusBoardWhenReady.current = nextPhase === "playing";
    setMatch(fresh);
    setKeyboardSquare({ file: 4, rank: 0 });
    setSelectedPieceId(null);
    setUnsafeSavePresent(false);
    setConfirmation(null);
    setPhase(nextPhase);
    setResumableMatch(resumable ? fresh : null);
    return resumable;
  }, [commandGate, installLedger, opponent, persistMatch, presentation, runtime, semanticAudio]);

  const replaceOnlineSession = useCallback((next: OnlineMatchSession | null) => {
    const previous = onlineSessionRef.current;
    if (previous !== next) previous?.dispose();
    onlineSessionRef.current = next;
    setOnlineSession(next);
    setOnlineSnapshot(next?.getSnapshot() ?? null);
  }, []);

  const createBrowserOnlineSession = useCallback((
    identity: OnlineMatchSessionIdentity,
    resumeMatch: SavedMatch | null,
  ) => new OnlineMatchSession({
    identity,
    rtcConfiguration: ONLINE_RUNTIME_CONFIG.rtcConfiguration,
    peerConnectionFactory: (configuration) => new RTCPeerConnection(configuration),
    getGame: () => gameRef.current,
    bindMatch: async (bound: BoundOnlineMatchIdentity) => {
      if (resumeMatch) {
        const config = resumeMatch.config;
        if (
          config.mode !== "online"
          || bound.intent !== "resume"
          || config.pairingId !== bound.pairingId
          || config.matchId !== bound.matchId
          || config.localPeerId !== bound.localPeerId
          || config.remotePeerId !== bound.remotePeerId
          || config.signalingRole !== bound.signalingRole
          || config.localSide !== bound.localSide
        ) return false;
        installFreshMatch(resumeMatch, "menu");
        setViewSide(config.localSide);
        setNotice("直连已建立，正在核对本地存档与好友棋局。");
        return true;
      }
      if (bound.intent !== "new") return false;
      const fresh = createOnlineMatch({
        mode: "online",
        protocolVersion: 1,
        pairingId: bound.pairingId,
        matchId: bound.matchId,
        rematchIndex: 0,
        localPeerId: bound.localPeerId,
        remotePeerId: bound.remotePeerId,
        localSide: bound.localSide,
        signalingRole: bound.signalingRole,
      });
      installFreshMatch(fresh, "menu");
      setViewSide(bound.localSide);
      setNotice(`已连接好友，你执${bound.localSide === "red" ? "红方" : "黑方"}。`);
      return true;
    },
    commitCommand: commitOnlineCommand,
    installRecoveredGame: installRecoveredOnlineGame,
    installRematch: async (identity, proposal) => {
      await commandGate.whenIdle();
      const current = matchRef.current;
      if (
        current.config.mode !== "online"
        || current.game.status.kind !== "ended"
        || current.revision !== proposal.terminalRevision
        || await sha256Hex(serializeGame(current.game)) !== proposal.terminalHash
        || current.config.pairingId !== identity.pairingId
        || current.config.localPeerId !== identity.localPeerId
        || current.config.remotePeerId !== identity.remotePeerId
        || current.config.signalingRole !== identity.signalingRole
        || proposal.nextMatchId !== identity.matchId
        || proposal.nextRematchIndex !== current.config.rematchIndex + 1
        || identity.localSide !== onlineSideForRematch(
          proposal.nextRematchIndex,
          identity.signalingRole,
        )
      ) return false;
      const fresh = createOnlineMatch({
        mode: "online",
        protocolVersion: 1,
        pairingId: identity.pairingId,
        matchId: identity.matchId,
        rematchIndex: proposal.nextRematchIndex,
        localPeerId: identity.localPeerId,
        remotePeerId: identity.remotePeerId,
        localSide: identity.localSide,
        signalingRole: identity.signalingRole,
      });
      if (!persistMatch(fresh)) return false;
      installFreshMatch(fresh, "menu", true);
      setViewSide(identity.localSide);
      setNotice(`再来一局已创建，你执${identity.localSide === "red" ? "红方" : "黑方"}；请双方重新准备。`);
      return true;
    },
    digest: sha256Hex,
    createId: () => randomOnlineId("command"),
  }), [commandGate, commitOnlineCommand, installFreshMatch, installRecoveredOnlineGame, persistMatch]);

  const beginOnlinePairing = useCallback(async (
    role: "host" | "guest",
    intent: "new" | "resume",
    resumeMatch: SavedMatch | null,
  ) => {
    if (!ONLINE_RUNTIME_CONFIG.enabled) return;
    replaceOnlineSession(null);
    setOnlineSetup({ role, intent, resumeMatch, busy: role === "host" });

    if (role === "guest") {
      setNotice(intent === "resume"
        ? "请粘贴好友为这份在线存档生成的新 Offer。"
        : "请粘贴房主发来的完整 Offer 邀请文本。");
      return;
    }

    const resumedConfig = resumeMatch?.config.mode === "online" ? resumeMatch.config : null;
    const identity: OnlineMatchSessionIdentity = resumedConfig
      ? {
          role,
          sessionId: randomOnlineId("session"),
          pairingId: resumedConfig.pairingId,
          matchId: resumedConfig.matchId,
          localPeerId: resumedConfig.localPeerId,
          remotePeerId: resumedConfig.remotePeerId,
          intent,
          localSide: resumedConfig.localSide,
          rematchIndex: resumedConfig.rematchIndex,
        }
      : {
          role,
          sessionId: randomOnlineId("session"),
          pairingId: randomOnlineId("pairing"),
          matchId: randomOnlineId("match"),
          localPeerId: randomOnlineId("peer"),
          intent,
          localSide: role === "host" ? "red" : "black",
        };
    const session = createBrowserOnlineSession(identity, resumeMatch);
    replaceOnlineSession(session);
    if (role !== "host") {
      setOnlineSetup((current) => current ? { ...current, busy: false } : current);
      return;
    }
    try {
      await session.createOffer();
      setOnlineSetup((current) => current ? { ...current, busy: false, error: undefined } : current);
      setNotice("完整 Offer 已生成，请发送给好友并等待 Answer。");
    } catch {
      setOnlineSetup((current) => current ? { ...current, busy: false, error: "无法生成邀请，请关闭后重试。" } : current);
    }
  }, [createBrowserOnlineSession, replaceOnlineSession]);

  const handleOnlineSignal = useCallback(async (signal: string): Promise<boolean> => {
    const setup = onlineSetup;
    if (!setup || setup.busy) return false;
    setOnlineSetup({ ...setup, busy: true, error: undefined });
    try {
      let session = onlineSessionRef.current;
      if (setup.role === "guest" && !session) {
        const decoded = decodeSignalingMessageV1(signal, "offer");
        if (!decoded.ok || decoded.value.kind !== "offer" || decoded.value.intent !== setup.intent) {
          throw new Error("invalid-offer");
        }
        const offer = decoded.value;
        const resumedConfig = setup.resumeMatch?.config.mode === "online"
          ? setup.resumeMatch.config
          : null;
        if (resumedConfig && (
          offer.pairingId !== resumedConfig.pairingId
          || offer.matchId !== resumedConfig.matchId
          || offer.hostPeerId !== resumedConfig.remotePeerId
          || resumedConfig.signalingRole !== "guest"
        )) throw new Error("resume-identity-mismatch");
        const identity: OnlineMatchSessionIdentity = {
          role: "guest",
          sessionId: offer.sessionId,
          pairingId: offer.pairingId,
          matchId: offer.matchId,
          localPeerId: resumedConfig?.localPeerId ?? randomOnlineId("peer"),
          remotePeerId: offer.hostPeerId,
          intent: offer.intent,
          localSide: resumedConfig?.localSide ?? "black",
          rematchIndex: resumedConfig?.rematchIndex ?? 0,
        };
        session = createBrowserOnlineSession(identity, setup.resumeMatch);
        replaceOnlineSession(session);
      }
      if (!session) throw new Error("session-missing");
      if (setup.role === "guest") {
        await session.acceptOffer(signal);
        setNotice("完整 Answer 已生成，请发送给房主；浏览器会继续尝试直连。");
      } else {
        await session.acceptAnswer(signal);
        setNotice("Answer 已接受，正在建立好友直连。");
      }
      setOnlineSetup((current) => current ? { ...current, busy: false, error: undefined } : current);
      return true;
    } catch {
      setOnlineSetup((current) => current ? {
        ...current,
        busy: false,
        error: "信令文本无效、已过期或与当前棋局不匹配，请重新配对。",
      } : current);
      return false;
    }
  }, [createBrowserOnlineSession, onlineSetup, replaceOnlineSession]);

  const handleOnlineReady = useCallback(async () => {
    const session = onlineSessionRef.current;
    if (!session || onlineSetup?.busy) return;
    setOnlineSetup((current) => current ? { ...current, busy: true, error: undefined } : current);
    const result = await session.setLocalReady();
    setOnlineSetup((current) => current ? {
      ...current,
      busy: false,
      error: result.ok ? undefined : "当前还不能准备，请等待连接与棋局校验完成。",
    } : current);
  }, [onlineSetup?.busy]);

  const cancelOnlinePairing = useCallback(() => {
    replaceOnlineSession(null);
    setOnlineSetup(null);
    setPhase("menu");
    phaseRef.current = "menu";
    setNotice("已关闭本次直连；如需继续在线存档，请重新配对。");
  }, [replaceOnlineSession]);

  useEffect(() => {
    if (onlineSnapshot?.coordinator?.phase !== "playable" || phaseRef.current === "playing") return;
    phaseRef.current = "playing";
    focusBoardWhenReady.current = true;
    setPhase("playing");
    setOnlineSetup((current) => current ? { ...current, busy: false, error: undefined } : current);
    setNotice("双方已准备，红方先行。");
  }, [onlineSnapshot?.coordinator?.phase]);

  const startLocalGame = useCallback(() => {
    const fresh = createLocalMatch();
    installFreshMatch(fresh, "playing");
    setAnimateDieMatchId(null);
    setViewSide("red");
    setNotice("本机双人新局开始，红方先行。");
  }, [installFreshMatch]);

  const prepareComputerGame = useCallback((difficulty: ComputerDifficulty) => {
    const fresh = createComputerMatch(difficulty);
    installFreshMatch(fresh, "menu");
    if (fresh.config.mode !== "computer") return;
    setViewSide(fresh.config.humanSide);
    setAnimateDieMatchId(fresh.config.matchId);
    setNotice(`掷出 ${fresh.config.dieResult}，你执${fresh.config.humanSide === "red" ? "红方" : "黑方"}。`);
  }, [installFreshMatch]);

  const startPreparedComputerGame = useCallback(() => {
    const current = matchRef.current.config.mode === "computer"
      ? matchRef.current
      : resumableMatch?.config.mode === "computer"
        ? resumableMatch
        : null;
    if (
      !current
      || current.config.mode !== "computer"
      || current.game.revision !== 0
      || current.game.history.length !== 0
    ) return;
    opponent.invalidate();
    commandGate.invalidate();
    matchEpoch.current += 1;
    matchRef.current = current;
    gameRef.current = current.game;
    phaseRef.current = "playing";
    runtime.synchronize(current);
    focusBoardWhenReady.current = true;
    setMatch(current);
    setSelectedPieceId(null);
    setPhase("playing");
    setViewSide(current.config.humanSide);
    setAnimateDieMatchId(null);
    setNotice(current.config.humanSide === "red"
      ? "你执红方，轮到你先行。"
      : "你执黑方，电脑将以红方先行。");
  }, [commandGate, opponent, resumableMatch, runtime]);

  const activatedMatchId = useRef<string | null>(null);
  const requestedOpponentTurn = useRef<string | null>(null);
  useEffect(() => {
    const current = matchRef.current;
    if (phase !== "playing" || current.config.mode !== "computer") {
      activatedMatchId.current = null;
      return;
    }
    if (activatedMatchId.current === current.config.matchId) return;
    activatedMatchId.current = current.config.matchId;
    const matchId = current.config.matchId;
    void opponent.activateMatch({
      matchId,
      seed: current.config.seed,
      tier: current.config.effectiveTier,
    }).then(() => {
      const latest = matchRef.current;
      if (
        latest.config.mode === "computer"
        && latest.config.matchId === matchId
        && latest.game.status.kind === "ended"
      ) opponent.setTerminal();
    });
  }, [match.config, opponent, phase]);

  useEffect(() => {
    if (!shouldRequestOpponentTurn(
      match,
      phase,
      opponentSnapshot.phase,
      opponentSnapshot.generation,
      requestedOpponentTurn.current,
    )) return;
    const config = match.config;
    if (config.mode !== "computer") return;
    const tier = opponentSnapshot.effectiveTier;
    if (!tier) return;
    const requestKey = opponentTurnRequestKey(match, opponentSnapshot.generation);
    if (!requestKey || requestedOpponentTurn.current === requestKey) return;
    requestedOpponentTurn.current = requestKey;
    const limits = tier === "fairy-master"
      ? MASTER_SEARCH_LIMITS
      : LIGHTWEIGHT_TIER_LIMITS[tier];
    void opponent.requestTurn({
      matchId: config.matchId,
      serializedGame: serializeGame(match.game),
      positionRevision: match.revision,
      sideToMove: match.game.sideToMove,
      status: "playing",
      ...limits,
    });
  }, [match, opponent, opponentSnapshot.effectiveTier, opponentSnapshot.generation, opponentSnapshot.phase, phase]);

  const commitOpponentCandidate = useCallback(async (
    release: OpponentCandidateRelease,
    serializedAtRelease: string,
  ) => {
    const receipt = await applyCommand({
      type: "move",
      expectedRevision: release.turn.positionRevision,
      from: release.candidate.from,
      to: release.candidate.to,
    }, "opponent", (current) => current.config.mode === "computer"
      && current.config.matchId === release.turn.matchId
      && current.revision === release.turn.positionRevision
      && current.game.sideToMove === release.turn.sideToMove
      && current.game.status.kind === "playing"
      && phaseRef.current === "playing"
      && current.game.sideToMove !== current.config.humanSide
      && serializeGame(current.game) === serializedAtRelease);
    return { ...release.turn, status: receipt.status };
  }, [applyCommand]);

  useEffect(() => {
    if (opponentSnapshot.phase !== "candidatePending") return;
    void (async () => {
      await commandGate.whenIdle();
      const serializedGame = serializeGame(gameRef.current);
      let positionFingerprint: string;
      try {
        positionFingerprint = await fingerprintGame(gameRef.current);
      } catch {
        opponent.invalidate();
        if (mounted.current) setNotice("无法校验电脑落子，本次计算已取消。");
        return;
      }
      const latest = matchRef.current;
      const matchId = latest.config.mode === "computer" ? latest.config.matchId : "local";
      await opponent.commitPending({
        matchId,
        positionRevision: latest.revision,
        positionFingerprint,
        sideToMove: latest.game.sideToMove,
        status: latest.game.status.kind === "playing" ? "playing" : "terminal",
      }, (release) => commitOpponentCandidate(release, serializedGame));
    })();
  }, [commandGate, commitOpponentCandidate, opponent, opponentSnapshot.phase]);

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
    if (resumableMatch || unsafeSavePresent) {
      setConfirmation({ kind: "new-game", target: { mode: "local" } });
      return;
    }
    startLocalGame();
  };

  const handleRollComputer = async (difficulty: ComputerDifficulty) => {
    await unlockAudio();
    audio.play("ui.confirm");
    if (resumableMatch || unsafeSavePresent) {
      setConfirmation({ kind: "new-game", target: { mode: "computer", difficulty } });
      return;
    }
    prepareComputerGame(difficulty);
  };

  const handleStartOnline = async (role: "host" | "guest") => {
    await unlockAudio();
    audio.play("ui.confirm");
    if (!ONLINE_RUNTIME_CONFIG.enabled) return;
    if (resumableMatch || unsafeSavePresent) {
      setConfirmation({ kind: "new-game", target: { mode: "online", role } });
      return;
    }
    await beginOnlinePairing(role, "new", null);
  };

  const handleConfirmComputer = async () => {
    await unlockAudio();
    audio.play("ui.confirm");
    startPreparedComputerGame();
  };

  const handleContinue = async () => {
    await unlockAudio();
    audio.play("ui.confirm");
    if (!resumableMatch) return;
    const resumableConfig = resumableMatch.config;
    if (resumableConfig.mode === "online") {
      if (!ONLINE_RUNTIME_CONFIG.enabled) {
        setNotice("在线好友模式当前未启用；存档仍保留，启用功能后可重新配对。");
        return;
      }
      const saved = resumableMatch;
      installFreshMatch(saved, "menu");
      setViewSide(resumableConfig.localSide);
      await beginOnlinePairing(resumableConfig.signalingRole, "resume", saved);
      setNotice(resumableConfig.signalingRole === "host"
        ? "正在为在线存档生成新的 Offer；不会复用上一次 SDP/ICE。"
        : "请粘贴好友为这份在线存档生成的新 Offer。");
      return;
    }
    opponent.invalidate();
    commandGate.invalidate();
    semanticAudio.cancelAll("game-replaced");
    presentation.skip("game-replaced");
    matchEpoch.current += 1;
    matchRef.current = resumableMatch;
    gameRef.current = resumableMatch.game;
    phaseRef.current = "playing";
    runtime.synchronize(resumableMatch);
    focusBoardWhenReady.current = true;
    setMatch(resumableMatch);
    if (resumableMatch.config.mode === "computer") {
      setViewSide(resumableMatch.config.humanSide);
    }
    setKeyboardSquare(resumableMatch.game.lastAction?.kind === "move"
      ? resumableMatch.game.lastAction.move.to
      : { file: 4, rank: 0 });
    setPhase("playing");
    setSelectedPieceId(null);
    setNotice(resumableMatch.game.status.kind === "ended"
      ? formatGameOutcome(resumableMatch.game)
      : `${resumableMatch.game.sideToMove === "red" ? "红方" : "黑方"}继续行动。`);
    // Local ended saves retain the existing single-step undo behavior. A
    // computer save never makes undo reachable through the command policy.
  };

  const computerOwnsTurn = isComputerTurn(match);
  const onlineCommandsLocked = match.config.mode === "online" && (
    onlineSnapshot?.peer.phase !== "open"
    || onlineSnapshot.coordinator?.phase !== "playable"
    || match.game.sideToMove !== match.config.localSide
  );
  const boardCommandsLocked = onlineCommandsLocked || deriveBoardCommandsLocked({
    phase,
    commandBusy,
    computerOwnsTurn,
    confirmationOpen: confirmation !== null,
    terminal: game.status.kind === "ended",
  });

  const handleSquarePress = (square: Square) => {
    setKeyboardSquare(square);
    if (boardCommandsLocked) return;
    const decision = resolveBoardClick(game, selection, square);
    if (decision.kind === "move") {
      if (matchRef.current.config.mode === "online") {
        const session = onlineSessionRef.current;
        if (!session) {
          setNotice("好友直连尚未就绪，请重新配对。");
          return;
        }
        void session.submitLocalMove(decision.command).then((result) => {
          if (!result.ok && mounted.current) setNotice("本次在线落子未提交，请等待连接与棋局状态就绪。");
        });
      } else {
        void applyCommand(decision.command);
      }
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
    if (boardCommandsLocked) {
      setNotice(onlineCommandsLocked
        ? "正在等待好友连接、准备或行动。"
        : computerOwnsTurn ? "电脑正在思考，请稍候。" : "当前动作仍在结算，请稍候。");
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
    : confirmation?.kind === "restart"
      ? {
          title: "确认重新开局？",
          description: match.config.mode === "computer"
            ? "当前棋局将被替换，并重新掷骰决定你在新局中的阵营。"
            : "当前棋局和可恢复备份将被新的标准初始局面取代。",
          label: "重新开局",
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
      const resigningSide = confirmation.side;
      setConfirmation(null);
      const current = matchRef.current;
      if (current.config.mode === "online") {
        if (
          current.revision !== expectedRevision
          || current.config.localSide !== resigningSide
        ) {
          setNotice("棋局状态已经变化，请重新确认认输。");
          return;
        }
        const session = onlineSessionRef.current;
        if (!session) {
          setNotice("好友直连已关闭，请返回菜单重新配对。");
          return;
        }
        void session.submitLocalResign().then((result) => {
          if (!result.ok && mounted.current) {
            setNotice("当前无法同步认输，请等待连接恢复或重新配对。");
          }
        });
      } else {
        void applyCommand({ type: "resign", expectedRevision });
      }
      return;
    }
    if (confirmation.kind === "new-game") {
      if (confirmation.target.mode === "computer") {
        prepareComputerGame(confirmation.target.difficulty);
      } else if (confirmation.target.mode === "online") {
        setConfirmation(null);
        void beginOnlinePairing(confirmation.target.role, "new", null);
      } else {
        startLocalGame();
      }
      return;
    }
    if (matchRef.current.config.mode === "computer") {
      prepareComputerGame(matchRef.current.config.requestedDifficulty);
    } else if (matchRef.current.config.mode === "online") {
      setConfirmation(null);
      cancelOnlinePairing();
    } else {
      startLocalGame();
    }
  };

  const boardStatus = game.status.kind === "ended"
    ? formatGameOutcome(game)
    : `${game.sideToMove === "red" ? "红方" : "黑方"}行动${game.status.check ? " · 将军" : ""}`;
  const preparedComputerMatch = phase === "menu"
    ? match.config.mode === "computer" && match.revision === 0 && match.game.history.length === 0
      ? match.config
      : resumableMatch?.config.mode === "computer"
        && resumableMatch.revision === 0
        && resumableMatch.game.history.length === 0
        ? resumableMatch.config
        : null
    : null;
  const hudPermissions = deriveGameHudPermissions(match, commandBusy, match.config.mode === "online" ? {
    peerOpen: onlineSnapshot?.peer.phase === "open",
    coordinatorPhase: onlineSnapshot?.coordinator?.phase ?? null,
    conflict: Boolean(
      onlineSnapshot?.error
      || onlineSnapshot?.reconnectRequired
      || onlineSnapshot?.coordinator?.error
      || onlineSnapshot?.coordinator?.issue,
    ),
  } : undefined);

  return (
    <div
      className="xiangqi-game-shell"
      data-audio-state={audio.state === "locked" ? "locked" : settings.muted ? "muted" : "running"}
      data-game-revision={game.revision}
      data-match-mode={match.config.mode}
      data-quality={settings.quality}
      data-reduced-motion={settings.reducedMotion ? "true" : "false"}
      data-human-side={match.config.mode === "computer"
        ? match.config.humanSide
        : match.config.mode === "online" ? match.config.localSide : undefined}
    >
      <div inert={confirmation ? true : undefined} aria-hidden={confirmation ? true : undefined}>
        {loading ? (
          <GameInitializationShell onContinue={handleContinue} onStart={handleStart} />
        ) : (
          <BoardViewer
            animations={animations}
            audio={audio}
            overlay={phase === "menu" ? onlineSetup ? (
              <SignalingWizard
                busy={onlineSetup.busy}
                error={onlineSetup.error}
                role={onlineSetup.role}
                snapshot={onlineSnapshot}
                onCancel={cancelOnlinePairing}
                onReady={handleOnlineReady}
                onSubmitSignal={handleOnlineSignal}
              />
            ) : (
              <GameMenu
                animateMatchId={animateDieMatchId}
                hasSave={Boolean(resumableMatch)}
                key={preparedComputerMatch?.matchId ?? "new-match-menu"}
                loading={false}
                onConfirmComputer={handleConfirmComputer}
                onContinue={handleContinue}
                onCreateOnline={() => { void handleStartOnline("host"); }}
                onJoinOnline={() => { void handleStartOnline("guest"); }}
                onRollComputer={handleRollComputer}
                onStart={handleStart}
                onlineEnabled={ONLINE_RUNTIME_CONFIG.enabled}
                preparedComputerMatch={preparedComputerMatch}
                reducedMotion={settings.reducedMotion}
                resumeMode={resumableMatch?.config.mode}
                warning={storageWarning}
              />
            ) : (
              <>
                <GameHud
                  game={game}
                  onlineStatus={onlineSnapshot ? (
                    <OnlineStatusCard snapshot={onlineSnapshot} onReconnect={cancelOnlinePairing} />
                  ) : undefined}
                  opponent={match.config.mode === "computer" ? {
                    config: match.config,
                    computerOwnsTurn,
                    snapshot: opponentSnapshot,
                  } : undefined}
                  onResign={() => {
                    if (match.config.mode === "online") {
                      setConfirmation({
                        kind: "resign",
                        revision: game.revision,
                        side: match.config.localSide,
                      });
                      return;
                    }
                    if (match.config.mode === "computer" && game.sideToMove !== match.config.humanSide) {
                      setNotice("只能在你的回合认输。");
                      return;
                    }
                    setConfirmation({ kind: "resign", revision: game.revision, side: game.sideToMove });
                  }}
                  onRestart={() => match.config.mode === "online"
                    ? cancelOnlinePairing()
                    : setConfirmation({ kind: "restart" })}
                  onUndo={() => { void applyCommand({ type: "undo", expectedRevision: game.revision }); }}
                  onSettingsChange={handleSettingsChange}
                  onSkip={() => presentation.skip("user-skip")}
                  permissions={hudPermissions}
                  presentationBusy={commandBusy}
                  restartLabel={match.config.mode === "online" ? "重新配对" : "重新开局"}
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
                    interactionLocked={boardCommandsLocked}
                    onBlur={() => setKeyboardActive(false)}
                    onFocus={() => setKeyboardActive(true)}
                    onKeyDown={handleKeyboardBoardKeyDown}
                  />
                ) : null}
                {game.status.kind === "ended" ? (
                  <GameOverPanel
                    canUndo={match.config.mode === "local" && game.lastAction?.kind === "move" && !commandBusy}
                    game={game}
                    onRestart={match.config.mode === "online"
                      ? undefined
                      : () => setConfirmation({ kind: "restart" })}
                    onUndo={() => { void applyCommand({ type: "undo", expectedRevision: game.revision }); }}
                    onlineRematch={match.config.mode === "online" && onlineSnapshot?.coordinator ? {
                      supported: onlineSnapshot.coordinator.rematch.supported,
                      available: onlineSnapshot.peer.phase === "open"
                        && onlineSnapshot.coordinator.phase === "terminal",
                      status: onlineSnapshot.coordinator.rematch.status,
                      onRequest: () => {
                        void onlineSessionRef.current?.requestRematch().then((result) => {
                          if (!result.ok && mounted.current) setNotice("暂时无法邀请再来一局，请检查连接状态。");
                        });
                      },
                      onAccept: () => {
                        void onlineSessionRef.current?.acceptRematch().then((result) => {
                          if (!result.ok && mounted.current) setNotice("未能接受重开邀请，请重新配对。");
                        });
                      },
                      onDecline: () => {
                        void onlineSessionRef.current?.declineRematch().then((result) => {
                          if (!result.ok && mounted.current) setNotice("未能发送拒绝响应，请检查连接状态。");
                        });
                      },
                      onCancel: () => {
                        void onlineSessionRef.current?.cancelRematch().then((result) => {
                          if (!result.ok && mounted.current) setNotice("未能取消邀请，请检查连接状态。");
                        });
                      },
                      onReconnect: cancelOnlinePairing,
                    } : undefined}
                  />
                ) : null}
              </>
            )}
            pieceLayer={(
              <GameBoardLayer
                animations={animations}
                disabled={boardCommandsLocked}
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
