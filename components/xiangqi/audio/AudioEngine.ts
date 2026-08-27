import type { AudioBus, AudioCueId, AudioMix, AudioTransientCueId } from "./audio-types";
import { DEFAULT_AUDIO_MIX } from "./audio-types";
import { AUDIO_PACK_BUDGETS, QIN_AUDIO_MANIFEST_URL, type QinAudioAssetId, type QinAudioAssetV1, type QinAudioPackManifestV1 } from "./qin-audio-pack-contract";
import {
  AUTHORED_ASSET_BY_TRANSIENT,
  ENGINE_DECODED_BUDGET_BYTES,
  decodedAudioBytes,
  resolveQinAudioPublicUrl,
  validateQinAudioPackManifest,
} from "./qin-audio-pack";

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

interface GainNodeLike extends AudioNodeLike { gain: AudioParamLike }
interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopEnd: number;
  loopStart: number;
  onended: (() => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
interface PannerNodeLike extends AudioNodeLike {
  distanceModel: DistanceModelType;
  maxDistance: number;
  panningModel: PanningModelType;
  positionX: AudioParamLike;
  positionY: AudioParamLike;
  positionZ: AudioParamLike;
  refDistance: number;
  rolloffFactor: number;
}

export type AudioListenerLike = Readonly<{
  forwardX?: AudioParamLike;
  forwardY?: AudioParamLike;
  forwardZ?: AudioParamLike;
  positionX?: AudioParamLike;
  positionY?: AudioParamLike;
  positionZ?: AudioParamLike;
  upX?: AudioParamLike;
  upY?: AudioParamLike;
  upZ?: AudioParamLike;
  setOrientation?: (forwardX: number, forwardY: number, forwardZ: number, upX: number, upY: number, upZ: number) => void;
  setPosition?: (x: number, y: number, z: number) => void;
}>;

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly listener: AudioListenerLike;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): BufferSourceLike;
  createGain(): GainNodeLike;
  createPanner(): PannerNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

type ActiveSourceKind = "ambient" | "authored-music" | "authored-transient" | "synth-music" | "synth-transient";

type ActiveSource = {
  buffer: AudioBuffer;
  cue: AudioCueId;
  gain: GainNodeLike;
  kind: ActiveSourceKind;
  nodes: readonly AudioNodeLike[];
  source: BufferSourceLike;
  stopRequested: boolean;
  stopWhen: number | null;
};

type SourceStartOptions = Readonly<{
  bus: AudioBus;
  cue: AudioCueId;
  kind: ActiveSourceKind;
  loop: boolean;
  position?: readonly [number, number, number];
  scheduleStart?: (source: BufferSourceLike, gain: GainNodeLike) => void;
}>;

type DocumentVisibility = Readonly<{
  addEventListener(type: "visibilitychange", listener: () => void): void;
  hidden: boolean;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}>;

export type AudioEngineState = "locked" | "running" | "muted";
type AudioPackState = "unrequested" | "loading" | "ready" | "unavailable";
type MusicMode = "authored" | "synth";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type DeadlineHandle = ReturnType<typeof setTimeout> | number;

export type AudioEngineOptions = Readonly<{
  baseUrl?: string;
  clearDeadline?: (handle: DeadlineHandle) => void;
  contextFactory?: (options?: AudioContextOptions) => AudioContextLike;
  fetcher?: FetchLike | null;
  maxVoicesPerCue?: number;
  packDeadlineMs?: number;
  scheduleDeadline?: (callback: () => void, delayMs: number) => DeadlineHandle;
  speech?: Pick<SpeechSynthesis, "cancel" | "speak"> | null;
  utteranceFactory?: (text: string) => SpeechSynthesisUtterance;
}>;

const BUS_BY_PREFIX: Readonly<Record<string, AudioBus>> = Object.freeze({
  ambient: "ambient",
  music: "music",
  system: "sfx",
  ui: "ui",
});

function contextFactory(options?: AudioContextOptions): AudioContextLike {
  const Constructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) throw new Error("Web Audio is unavailable");
  return new Constructor(options) as unknown as AudioContextLike;
}

function cueBus(cue: AudioCueId): AudioBus {
  return BUS_BY_PREFIX[cue.split(".")[0]!] ?? "sfx";
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function cueHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededNoise(seed: number) {
  let state = seed || 1;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return ((state >>> 8) / 0x01000000) * 2 - 1;
  };
}

function fillLoop(buffer: AudioBuffer, cue: "music.fortress" | "ambient.fortress") {
  const sampleRate = buffer.sampleRate;
  const random = seededNoise(cueHash(cue));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let wind = 0;
    for (let sample = 0; sample < data.length; sample += 1) {
      const time = sample / sampleRate;
      if (cue === "music.fortress") {
        const phrase = Math.floor(time * 1.5) % 8;
        const pentatonic = [0, 3, 5, 7, 10, 7, 5, 3]![phrase]!;
        const frequency = 82.41 * 2 ** (pentatonic / 12);
        const breath = 0.58 + 0.42 * Math.sin(Math.PI * ((time * 1.5) % 1));
        data[sample] = (
          Math.sin(Math.PI * 2 * frequency * time) * 0.055 +
          Math.sin(Math.PI * 2 * frequency * 0.5 * time + channel * 0.4) * 0.035 +
          Math.sin(Math.PI * 2 * 41.2 * time) * 0.025
        ) * breath;
      } else {
        wind = wind * 0.993 + random() * 0.007;
        const firePulse = Math.max(0, Math.sin(time * 13.7 + channel * 1.3)) ** 18;
        data[sample] = wind * 0.16 + firePulse * random() * 0.06;
      }
    }
  }
}

function cueDuration(cue: AudioCueId) {
  if (cue === "music.fortress") return 8;
  if (cue === "ambient.fortress") return 6;
  if (cue.startsWith("ui.")) return 0.09;
  if (cue === "system.capture") return 0.42;
  if (cue === "system.draw") return 1.1;
  if (cue.startsWith("system.")) return 0.75;
  if (cue.endsWith(".move")) return 0.24;
  if (cue.endsWith(".release")) return cue.startsWith("cannon.") ? 0.46 : 0.42;
  if (cue.endsWith(".impact")) return 0.48;
  return 0.7;
}

function fillCue(buffer: AudioBuffer, cue: AudioCueId) {
  const data = buffer.getChannelData(0);
  const random = seededNoise(cueHash(cue));
  const roleIndex = ["marshal", "advisor", "elephant", "chariot", "horse", "cannon", "soldier"]
    .findIndex((role) => cue.startsWith(role));
  const base = roleIndex < 0 ? 220 : [150, 330, 72, 105, 205, 235, 180]![roleIndex]!;
  const kind = cue.split(".")[1]!;
  for (let sample = 0; sample < data.length; sample += 1) {
    const time = sample / buffer.sampleRate;
    const phase = sample / data.length;
    const attack = Math.min(1, phase * 18);
    const envelope = attack * (1 - phase) ** (kind === "fracture" ? 1.3 : 2.2);
    let value: number;
    if (cue.startsWith("ui.")) {
      const invalid = cue === "ui.invalid";
      value = Math.sin(Math.PI * 2 * (invalid ? 145 : 520) * time) * envelope * 0.2;
    } else if (cue.startsWith("system.")) {
      if (cue === "system.capture") {
        const clayBody = Math.sin(Math.PI * 2 * (118 - phase * 32) * time) * 0.32;
        value = (clayBody + random() * Math.exp(-phase * 12) * 0.58) * envelope;
      } else if (cue === "system.draw") {
        const balanced = Math.sin(Math.PI * 2 * 174 * time) + Math.sin(Math.PI * 2 * 232 * time) * 0.72;
        value = balanced * envelope * 0.13;
      } else {
        const rising = cue !== "system.defeat";
        const frequency = (rising ? 185 : 150) * 2 ** ((rising ? phase : -phase) * 0.8);
        value = (Math.sin(Math.PI * 2 * frequency * time) + Math.sin(Math.PI * 4 * frequency * time) * 0.35) * envelope * 0.16;
      }
    } else if (kind === "move") {
      value = (Math.sin(Math.PI * 2 * base * 0.45 * time) * 0.5 + random() * 0.22) * envelope * 0.22;
    } else if (kind === "release") {
      const sweep = base * (cue.startsWith("cannon.") ? 1.4 + phase * 1.2 : 1.35 - phase * 0.55);
      const tensionSnap = cue.startsWith("cannon.") ? Math.exp(-phase * 15) * Math.sin(Math.PI * 2 * 760 * time) : 0;
      value = (Math.sin(Math.PI * 2 * sweep * time) * 0.68 + tensionSnap * 0.65 + random() * 0.18) * envelope * 0.25;
    } else if (kind === "impact") {
      value = (Math.sin(Math.PI * 2 * base * 0.42 * time) * 0.75 + random() * 0.55) * envelope * 0.3;
    } else {
      value = (random() * 0.7 + Math.sin(Math.PI * 2 * base * 0.3 * time) * 0.3) * envelope * 0.22;
    }
    data[sample] = Math.max(-0.9, Math.min(0.9, value));
  }
}

const SOURCE_KINDS: readonly ActiveSourceKind[] = [
  "ambient",
  "authored-music",
  "authored-transient",
  "synth-music",
  "synth-transient",
];

function emptySourceKindCounts() {
  return Object.fromEntries(SOURCE_KINDS.map((kind) => [kind, 0])) as Record<ActiveSourceKind, number>;
}

function buffersByteSize(buffers: Iterable<AudioBuffer>) {
  const unique = new Set(buffers);
  let total = 0;
  for (const buffer of unique) total += decodedAudioBytes(buffer);
  return total;
}

/** One application-wide Web Audio graph with an optional, atomically loaded authored pack. */
export class AudioEngine {
  private readonly active = new Set<ActiveSource>();
  private readonly activeByCue = new Map<AudioCueId, number>();
  private readonly baseUrl: string;
  private readonly buffers = new Map<AudioCueId, AudioBuffer>();
  private readonly clearDeadline: (handle: DeadlineHandle) => void;
  private readonly contextFactory: (options?: AudioContextOptions) => AudioContextLike;
  private readonly fetcher: FetchLike | null;
  private readonly maxVoicesPerCue: number;
  private readonly packDeadlineMs: number;
  private readonly scheduleDeadline: (callback: () => void, delayMs: number) => DeadlineHandle;
  private readonly speech: Pick<SpeechSynthesis, "cancel" | "speak"> | null;
  private readonly utteranceFactory: ((text: string) => SpeechSynthesisUtterance) | null;
  private readonly visibilityDetachers = new Set<() => void>();
  private abortCount = 0;
  private authoredBuffers = new Map<QinAudioAssetId, AudioBuffer>();
  private authoredMusic: ActiveSource | null = null;
  private buses: Partial<Record<"master" | AudioBus, GainNodeLike>> = {};
  private context: AudioContextLike | null = null;
  private contextGeneration = 0;
  private contextQueue: Promise<void> = Promise.resolve();
  private deadlineHandle: DeadlineHandle | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private foregroundEligible = false;
  private foregroundVisible = true;
  private loadingAuthoredBuffers = new Map<QinAudioAssetId, AudioBuffer>();
  private manifest: QinAudioPackManifestV1 | null = null;
  private maxInFlightDecodes = 0;
  private maxInFlightFetches = 0;
  private mix: AudioMix = DEFAULT_AUDIO_MIX;
  private musicMode: MusicMode = "synth";
  private muted = false;
  private packAbort: AbortController | null = null;
  private packGeneration = 0;
  private packState: AudioPackState = "unrequested";
  private pendingDecodes = 0;
  private pendingFetches = 0;
  private sourceEnds = 0;
  private readonly sourceEndsByKind = emptySourceKindCounts();
  private readonly sourceStartAttemptsByKind = emptySourceKindCounts();
  private sourceStarts = 0;
  private readonly sourceStartsByCue = new Map<AudioCueId, number>();
  private readonly sourceStartsByKind = emptySourceKindCounts();
  private sourceStops = 0;
  private readonly sourceStopsByKind = emptySourceKindCounts();
  private synthMusic: ActiveSource | null = null;
  private synthStartTime = 0;
  private unlocked = false;
  private voiceCount = 0;

  constructor(options: AudioEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? contextFactory;
    this.maxVoicesPerCue = Math.max(1, options.maxVoicesPerCue ?? 4);
    this.baseUrl = options.baseUrl ?? (
      (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"
    );
    this.fetcher = options.fetcher === undefined
      ? typeof window !== "undefined" && typeof fetch === "function" ? fetch.bind(globalThis) : null
      : options.fetcher;
    this.packDeadlineMs = Math.max(1, options.packDeadlineMs ?? 30_000);
    this.scheduleDeadline = options.scheduleDeadline ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearDeadline = options.clearDeadline ?? (
      (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    );
    this.speech = options.speech === undefined
      ? typeof speechSynthesis === "undefined" ? null : speechSynthesis
      : options.speech;
    this.utteranceFactory = options.utteranceFactory ?? (
      typeof SpeechSynthesisUtterance === "undefined" ? null : (text) => new SpeechSynthesisUtterance(text)
    );
  }

  get state(): AudioEngineState {
    if (!this.unlocked) return "locked";
    return this.muted ? "muted" : "running";
  }

  async unlock() {
    if (this.disposed) return;
    if (!this.context) {
      try {
        this.context = this.contextFactory({ sampleRate: 48_000 });
      } catch {
        this.context = this.contextFactory();
      }
      this.createGraph(this.context);
    }
    const contextGeneration = this.contextGeneration;
    const resumed = await this.enqueueContextOperation(contextGeneration, async (context) => {
      if (context.state !== "running") await context.resume();
      return context.state === "running";
    });
    if (!resumed || this.disposed || contextGeneration !== this.contextGeneration) return;
    if (!this.unlocked) {
      this.unlocked = true;
      this.foregroundEligible = this.foregroundVisible && !this.muted;
      this.applyMix();
      this.startSynthMusic(1);
      this.playInternal("ambient.fortress", true);
      this.startPackLoading();
    }
  }

  setMix(mix: AudioMix) {
    this.mix = {
      ambient: clamp01(mix.ambient),
      master: clamp01(mix.master),
      music: clamp01(mix.music),
      sfx: clamp01(mix.sfx),
      ui: clamp01(mix.ui),
      voice: clamp01(mix.voice),
    };
    this.applyMix();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.foregroundEligible = this.computeForegroundEligibility();
    if (muted) this.speech?.cancel();
    this.applyMix();
    if (!muted) this.maybeStartAuthoredMusic();
  }

  isTransientEligible() {
    return this.foregroundEligible && this.computeForegroundEligibility();
  }

  play(cue: AudioCueId, options: { position?: readonly [number, number, number] } = {}) {
    if (cue in AUTHORED_ASSET_BY_TRANSIENT) {
      return this.playTransient(cue as AudioTransientCueId, options);
    }
    if (!this.isTransientEligible()) return false;
    return this.playInternal(cue, false, options.position);
  }

  playTransient(cue: AudioTransientCueId, options: { position?: readonly [number, number, number] } = {}) {
    if (!this.isTransientEligible()) return false;
    const authoredId = AUTHORED_ASSET_BY_TRANSIENT[cue];
    const authoredBuffer = this.packState === "ready" ? this.authoredBuffers.get(authoredId) : null;
    if (!authoredBuffer) return this.playInternal(cue, false, options.position);
    const authored = this.startSource(authoredBuffer, {
      bus: "sfx",
      cue,
      kind: "authored-transient",
      loop: false,
      position: options.position,
    });
    if (authored) return true;
    const fallbackPlayed = this.playInternal(cue, false, options.position);
    this.failPack(this.packGeneration, false);
    return fallbackPlayed;
  }

  speak(text: string, options: { rate?: number; volumeScale?: number } = {}) {
    if (!this.isTransientEligible() || !this.speech || !this.utteranceFactory || this.voiceCount >= 2) return false;
    const utterance = this.utteranceFactory(text);
    utterance.lang = "zh-CN";
    utterance.pitch = 0.82;
    utterance.rate = options.rate ?? 0.92;
    utterance.volume = clamp01(this.mix.master * this.mix.voice * (options.volumeScale ?? 1));
    this.voiceCount += 1;
    const settle = () => { this.voiceCount = Math.max(0, this.voiceCount - 1); };
    utterance.onend = settle;
    utterance.onerror = settle;
    this.speech.speak(utterance);
    return true;
  }

  setListenerPose(
    position: readonly [number, number, number],
    forward: readonly [number, number, number],
    up: readonly [number, number, number],
  ) {
    const context = this.context;
    if (!context || !this.unlocked) return;
    const listener = context.listener;
    const at = context.currentTime;
    if (listener.positionX && listener.positionY && listener.positionZ) {
      listener.positionX.setValueAtTime(position[0], at);
      listener.positionY.setValueAtTime(position[1], at);
      listener.positionZ.setValueAtTime(position[2], at);
    } else {
      listener.setPosition?.(position[0], position[1], position[2]);
    }
    if (listener.forwardX && listener.forwardY && listener.forwardZ && listener.upX && listener.upY && listener.upZ) {
      listener.forwardX.setValueAtTime(forward[0], at);
      listener.forwardY.setValueAtTime(forward[1], at);
      listener.forwardZ.setValueAtTime(forward[2], at);
      listener.upX.setValueAtTime(up[0], at);
      listener.upY.setValueAtTime(up[1], at);
      listener.upZ.setValueAtTime(up[2], at);
    } else {
      listener.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  attachVisibility(documentLike: DocumentVisibility) {
    if (this.disposed) return () => undefined;
    this.foregroundVisible = !documentLike.hidden;
    this.foregroundEligible = this.computeForegroundEligibility();
    let attached = true;
    const handleVisibility = () => {
      if (documentLike.hidden) {
        this.foregroundVisible = false;
        this.foregroundEligible = false;
        this.speech?.cancel();
        const contextGeneration = this.contextGeneration;
        void this.enqueueContextOperation(contextGeneration, async (context) => {
          if (context.state === "running") await context.suspend();
          return false;
        });
      } else {
        this.foregroundVisible = true;
        this.foregroundEligible = false;
        const contextGeneration = this.contextGeneration;
        void this.enqueueContextOperation(contextGeneration, async (context) => {
          if (context.state !== "running") await context.resume();
          return context.state === "running";
        }).then((running) => {
          if (
            !running ||
            contextGeneration !== this.contextGeneration ||
            !this.foregroundVisible ||
            this.disposed
          ) return;
          this.foregroundEligible = this.computeForegroundEligibility();
          this.maybeStartAuthoredMusic();
        });
      }
    };
    documentLike.addEventListener("visibilitychange", handleVisibility);
    const detach = () => {
      if (!attached) return;
      attached = false;
      documentLike.removeEventListener("visibilitychange", handleVisibility);
      this.visibilityDetachers.delete(detach);
    };
    this.visibilityDetachers.add(detach);
    return detach;
  }

  debugSnapshot() {
    const activeSourcesByKind = emptySourceKindCounts();
    for (const entry of this.active) activeSourcesByKind[entry.kind] += 1;
    return {
      abortCount: this.abortCount,
      activeSources: this.active.size,
      activeSourcesByKind,
      authoredBufferCount: this.authoredBuffers.size,
      authoredDecodedBytes: this.authoredDecodedBytes(),
      cachedBuffers: this.buffers.size,
      contextPresent: this.context !== null,
      contextGeneration: this.contextGeneration,
      disposed: this.disposed,
      foregroundEligible: this.isTransientEligible(),
      listenerAttachments: this.visibilityDetachers.size,
      loadingAuthoredBufferCount: this.loadingAuthoredBuffers.size,
      maxInFlightDecodes: this.maxInFlightDecodes,
      maxInFlightFetches: this.maxInFlightFetches,
      mix: { ...this.mix },
      musicMode: this.musicMode,
      packState: this.packState,
      pendingDecodes: this.pendingDecodes,
      pendingFetches: this.pendingFetches,
      packGeneration: this.packGeneration,
      sourceEnds: this.sourceEnds,
      sourceEndsByKind: { ...this.sourceEndsByKind },
      sourceStartAttemptsByKind: { ...this.sourceStartAttemptsByKind },
      sourceStarts: this.sourceStarts,
      sourceStartsByCue: Object.fromEntries(this.sourceStartsByCue),
      sourceStartsByKind: { ...this.sourceStartsByKind },
      sourceStops: this.sourceStops,
      sourceStopsByKind: { ...this.sourceStopsByKind },
      state: this.state,
      totalDecodedBytes: this.totalDecodedBytes(),
      voiceCount: this.voiceCount,
    } as const;
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.performDispose();
    return this.disposePromise;
  }

  private async performDispose() {
    this.disposed = true;
    this.foregroundEligible = false;
    this.foregroundVisible = false;
    this.contextGeneration += 1;
    this.packGeneration += 1;
    this.abortPack();
    this.clearPackDeadline();
    this.speech?.cancel();
    this.voiceCount = 0;
    for (const detach of [...this.visibilityDetachers]) detach();
    await this.contextQueue.catch(() => undefined);
    for (const entry of [...this.active]) {
      entry.source.onended = null;
      this.stopEntry(entry);
      this.cleanupEntry(entry);
    }
    this.active.clear();
    this.activeByCue.clear();
    this.buffers.clear();
    this.authoredBuffers.clear();
    this.loadingAuthoredBuffers.clear();
    this.manifest = null;
    this.synthMusic = null;
    this.authoredMusic = null;
    Object.values(this.buses).forEach((node) => {
      try { node?.disconnect(); } catch { /* Best-effort Web Audio cleanup. */ }
    });
    this.buses = {};
    const context = this.context;
    this.context = null;
    this.unlocked = false;
    this.musicMode = "synth";
    this.packState = "unrequested";
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
  }

  private createGraph(context: AudioContextLike) {
    const master = context.createGain();
    master.connect(context.destination);
    this.buses.master = master;
    (["music", "ambient", "voice", "sfx", "ui"] as const).forEach((name) => {
      const bus = context.createGain();
      bus.connect(master);
      this.buses[name] = bus;
    });
  }

  private applyMix() {
    const context = this.context;
    if (!context) return;
    const at = context.currentTime;
    this.buses.master?.gain.setValueAtTime(this.muted ? 0 : this.mix.master, at);
    this.buses.music?.gain.setValueAtTime(this.mix.music, at);
    this.buses.ambient?.gain.setValueAtTime(this.mix.ambient, at);
    this.buses.voice?.gain.setValueAtTime(this.mix.voice, at);
    this.buses.sfx?.gain.setValueAtTime(this.mix.sfx, at);
    this.buses.ui?.gain.setValueAtTime(this.mix.ui, at);
  }

  private computeForegroundEligibility() {
    return Boolean(
      !this.disposed &&
      this.unlocked &&
      !this.muted &&
      this.foregroundVisible &&
      this.context?.state === "running"
    );
  }

  private enqueueContextOperation(
    contextGeneration: number,
    operation: (context: AudioContextLike) => Promise<boolean>,
  ) {
    let result = false;
    const run = this.contextQueue.then(async () => {
      const context = this.context;
      if (
        !context ||
        this.disposed ||
        contextGeneration !== this.contextGeneration ||
        context.state === "closed"
      ) return;
      result = await operation(context);
    });
    this.contextQueue = run.catch(() => undefined);
    return run.then(() => result, () => false);
  }

  private getBuffer(cue: AudioCueId) {
    const cached = this.buffers.get(cue);
    if (cached) return cached;
    if (!this.context) throw new Error("Audio context is locked");
    const loop = cue === "music.fortress" || cue === "ambient.fortress";
    const buffer = this.context.createBuffer(
      loop ? 2 : 1,
      Math.ceil(cueDuration(cue) * this.context.sampleRate),
      this.context.sampleRate,
    );
    if (loop) fillLoop(buffer, cue); else fillCue(buffer, cue);
    this.buffers.set(cue, buffer);
    if (
      (this.packState === "loading" || this.packState === "ready") &&
      this.totalDecodedBytes() > ENGINE_DECODED_BUDGET_BYTES
    ) {
      this.failPack(this.packGeneration);
    }
    return buffer;
  }

  private playInternal(cue: AudioCueId, loop: boolean, position?: readonly [number, number, number]) {
    const kind: ActiveSourceKind = cue === "music.fortress"
      ? "synth-music"
      : cue === "ambient.fortress" ? "ambient" : "synth-transient";
    return Boolean(this.startSource(this.getBuffer(cue), {
      bus: cueBus(cue),
      cue,
      kind,
      loop,
      position,
    }));
  }

  private startSynthMusic(initialGain: number) {
    if (this.synthMusic && this.active.has(this.synthMusic) && !this.synthMusic.stopRequested) return this.synthMusic;
    const context = this.context;
    if (!context) return null;
    const entry = this.startSource(this.getBuffer("music.fortress"), {
      bus: "music",
      cue: "music.fortress",
      kind: "synth-music",
      loop: true,
      scheduleStart: (source, gain) => {
        gain.gain.setValueAtTime(initialGain, context.currentTime);
        source.start();
      },
    });
    if (!entry) return null;
    this.synthMusic = entry;
    this.synthStartTime = context.currentTime;
    this.musicMode = "synth";
    return entry;
  }

  private startSource(
    buffer: AudioBuffer,
    { bus, cue, kind, loop, position, scheduleStart }: SourceStartOptions,
  ) {
    const context = this.context;
    const busNode = this.buses[bus];
    if (!context || !busNode || this.disposed) return null;
    const activeCount = this.activeByCue.get(cue) ?? 0;
    if (!loop && activeCount >= this.maxVoicesPerCue) return null;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);
    const nodes: AudioNodeLike[] = [source, gain];
    if (position) {
      const panner = context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2.2;
      panner.maxDistance = 26;
      panner.rolloffFactor = 0.7;
      panner.positionX.setValueAtTime(position[0], context.currentTime);
      panner.positionY.setValueAtTime(position[1], context.currentTime);
      panner.positionZ.setValueAtTime(position[2], context.currentTime);
      gain.connect(panner);
      panner.connect(busNode);
      nodes.push(panner);
    } else {
      gain.connect(busNode);
    }
    const entry: ActiveSource = { buffer, cue, gain, kind, nodes, source, stopRequested: false, stopWhen: null };
    source.onended = () => {
      this.sourceEnds += 1;
      this.sourceEndsByKind[kind] += 1;
      this.cleanupEntry(entry);
    };
    this.active.add(entry);
    this.activeByCue.set(cue, activeCount + 1);
    this.sourceStartAttemptsByKind[kind] += 1;
    try {
      if (scheduleStart) scheduleStart(source, gain); else source.start();
      this.sourceStarts += 1;
      this.sourceStartsByCue.set(cue, (this.sourceStartsByCue.get(cue) ?? 0) + 1);
      this.sourceStartsByKind[kind] += 1;
      return entry;
    } catch {
      source.onended = null;
      this.cleanupEntry(entry);
      return null;
    }
  }

  private cleanupEntry(entry: ActiveSource) {
    if (!this.active.delete(entry)) return;
    this.activeByCue.set(entry.cue, Math.max(0, (this.activeByCue.get(entry.cue) ?? 1) - 1));
    if (this.synthMusic === entry) this.synthMusic = null;
    if (this.authoredMusic === entry) this.authoredMusic = null;
    entry.nodes.forEach((node) => {
      try { node.disconnect(); } catch { /* Browser may already have disconnected it. */ }
    });
  }

  private stopEntry(entry: ActiveSource, when?: number) {
    if (entry.stopRequested) return;
    entry.stopRequested = true;
    entry.stopWhen = when ?? null;
    this.sourceStops += 1;
    this.sourceStopsByKind[entry.kind] += 1;
    try { entry.source.stop(when); } catch { this.cleanupEntry(entry); }
  }

  private startPackLoading() {
    if (this.packState !== "unrequested" || this.disposed) return;
    if (!this.fetcher) {
      this.packState = "unavailable";
      return;
    }
    this.packState = "loading";
    const packGeneration = ++this.packGeneration;
    this.packAbort = new AbortController();
    this.deadlineHandle = this.scheduleDeadline(() => {
      if (!this.isCurrentPackGeneration(packGeneration) || this.packState !== "loading") return;
      this.abortPack();
      this.failPack(packGeneration, false);
    }, this.packDeadlineMs);
    void this.loadPack(packGeneration, this.packAbort.signal).catch(() => this.failPack(packGeneration));
  }

  private async loadPack(packGeneration: number, signal: AbortSignal) {
    const manifestBytes = await this.fetchBytes(
      resolveQinAudioPublicUrl(QIN_AUDIO_MANIFEST_URL, this.baseUrl),
      "application/json",
      signal,
    );
    this.guardPackGeneration(packGeneration);
    const manifest = validateQinAudioPackManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
    const decoded = new Map<QinAudioAssetId, AudioBuffer>();
    this.loadingAuthoredBuffers = decoded;

    for (const asset of manifest.assets) {
      this.guardPackGeneration(packGeneration);
      let encoded: ArrayBuffer | null = await this.fetchBytes(
        resolveQinAudioPublicUrl(asset.url, this.baseUrl),
        asset.mimeType,
        signal,
      );
      if (encoded.byteLength !== asset.bytes) throw new Error(asset.id + " byte count mismatch");
      if (await this.sha256(encoded) !== asset.sha256) throw new Error(asset.id + " SHA-256 mismatch");
      this.guardPackGeneration(packGeneration);
      const buffer = await this.decode(encoded);
      encoded = null;
      this.guardPackGeneration(packGeneration);
      this.validateDecodedAsset(asset, buffer);
      decoded.set(asset.id, buffer);
      if (buffersByteSize(decoded.values()) > AUDIO_PACK_BUDGETS.authoredDecodedBytes) {
        throw new Error("Authored decoded budget exceeded");
      }
      if (this.totalDecodedBytes() > ENGINE_DECODED_BUDGET_BYTES) {
        throw new Error("Engine decoded budget exceeded");
      }
    }

    this.guardPackGeneration(packGeneration);
    this.authoredBuffers = new Map(decoded);
    this.loadingAuthoredBuffers = new Map();
    this.manifest = manifest;
    this.packState = "ready";
    this.packAbort = null;
    this.clearPackDeadline();
    this.maybeStartAuthoredMusic();
  }

  private async fetchBytes(url: string, expectedMime: string, signal: AbortSignal) {
    const fetcher = this.fetcher;
    if (!fetcher) throw new Error("Pack fetch is unavailable");
    this.pendingFetches += 1;
    this.maxInFlightFetches = Math.max(this.maxInFlightFetches, this.pendingFetches);
    try {
      const response = await this.abortable(fetcher(url, { signal }), signal);
      if (!response.ok) throw new Error("Audio request failed with " + response.status);
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== expectedMime) throw new Error("Unexpected audio MIME " + (contentType ?? "missing"));
      return await this.abortable(response.arrayBuffer(), signal);
    } finally {
      this.pendingFetches = Math.max(0, this.pendingFetches - 1);
    }
  }

  private async decode(encoded: ArrayBuffer) {
    const context = this.context;
    if (!context) throw new Error("Audio context closed during decode");
    this.pendingDecodes += 1;
    this.maxInFlightDecodes = Math.max(this.maxInFlightDecodes, this.pendingDecodes);
    try {
      return await context.decodeAudioData(encoded);
    } finally {
      this.pendingDecodes = Math.max(0, this.pendingDecodes - 1);
    }
  }

  private async abortable<T>(promise: Promise<T>, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    let rejectAbort: ((reason: unknown) => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const handleAbort = () => rejectAbort?.(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", handleAbort, { once: true });
    try {
      return await Promise.race([promise, aborted]);
    } finally {
      signal.removeEventListener("abort", handleAbort);
    }
  }

  private async sha256(bytes: ArrayBuffer) {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private validateDecodedAsset(asset: QinAudioAssetV1, buffer: AudioBuffer) {
    if (buffer.numberOfChannels !== asset.channels) {
      throw new Error(asset.id + " decoded channels mismatch");
    }
    const duration = buffer.duration;
    if (!Number.isFinite(duration) || Math.abs(duration - asset.durationSeconds) > 0.25) {
      throw new Error(asset.id + " decoded duration mismatch");
    }
    if (asset.kind === "background") {
      if (asset.loop!.endSeconds > duration) {
        throw new Error(asset.id + " decoded loop range is invalid");
      }
    }
  }

  private maybeStartAuthoredMusic() {
    const context = this.context;
    if (
      !context ||
      this.disposed ||
      !this.foregroundVisible ||
      context.state !== "running" ||
      this.packState !== "ready" ||
      this.authoredMusic
    ) return;
    const asset = this.manifest?.assets.find((candidate) => candidate.id === "music.qin-procession");
    const buffer = this.authoredBuffers.get("music.qin-procession");
    const synth = this.synthMusic;
    if (!asset?.loop || !buffer || !synth) return;
    const elapsed = Math.max(0, context.currentTime - this.synthStartTime);
    const boundaryTime = this.synthStartTime + (Math.floor(elapsed / 8) + 1) * 8;
    const fadeEnd = boundaryTime + 1;
    const authored = this.startSource(buffer, {
      bus: "music",
      cue: "music.fortress",
      kind: "authored-music",
      loop: true,
      scheduleStart: (source, gain) => {
        source.loopStart = asset.loop!.startSeconds;
        source.loopEnd = asset.loop!.endSeconds;
        gain.gain.setValueAtTime(0, boundaryTime);
        gain.gain.linearRampToValueAtTime(1, fadeEnd);
        source.start(boundaryTime, asset.loop!.startSeconds);
      },
    });
    if (!authored) {
      this.failPack(this.packGeneration, false);
      return;
    }
    this.authoredMusic = authored;
    this.musicMode = "authored";
    synth.gain.gain.setValueAtTime(1, boundaryTime);
    synth.gain.gain.linearRampToValueAtTime(0, fadeEnd);
    this.stopEntry(synth, fadeEnd);
  }

  private failPack(packGeneration: number, abort = true) {
    if (
      this.disposed ||
      packGeneration !== this.packGeneration ||
      this.packState === "unavailable" ||
      this.packState === "unrequested"
    ) return;
    if (abort) this.abortPack();
    this.clearPackDeadline();
    this.packState = "unavailable";
    this.loadingAuthoredBuffers.clear();
    this.authoredBuffers.clear();
    this.manifest = null;
    this.fallbackToSynthMusic();
  }

  private fallbackToSynthMusic() {
    const context = this.context;
    const authored = this.authoredMusic;
    if (!context || !authored) {
      this.musicMode = "synth";
      if (!this.synthMusic && this.unlocked && !this.disposed) this.startSynthMusic(1);
      return;
    }
    const retiringSynth = this.synthMusic;
    const synth = this.startSynthMusic(0);
    if (synth) {
      const now = context.currentTime;
      const fadeEnd = retiringSynth?.stopRequested && retiringSynth.stopWhen !== null
        ? Math.max(now + 1, retiringSynth.stopWhen)
        : now + 1;
      synth.gain.gain.setValueAtTime(0, now);
      synth.gain.gain.linearRampToValueAtTime(1, fadeEnd);
      authored.gain.gain.setValueAtTime(1, now);
      authored.gain.gain.linearRampToValueAtTime(0, now + 1);
      this.stopEntry(authored, now + 1);
    }
    this.musicMode = "synth";
  }

  private abortPack() {
    const controller = this.packAbort;
    this.packAbort = null;
    if (!controller || controller.signal.aborted) return;
    this.abortCount += 1;
    controller.abort();
  }

  private clearPackDeadline() {
    if (this.deadlineHandle === null) return;
    this.clearDeadline(this.deadlineHandle);
    this.deadlineHandle = null;
  }

  private isCurrentPackGeneration(packGeneration: number) {
    return !this.disposed && packGeneration === this.packGeneration;
  }

  private guardPackGeneration(packGeneration: number) {
    if (!this.isCurrentPackGeneration(packGeneration) || this.packState !== "loading") {
      throw new Error("Stale audio pack generation");
    }
  }

  private authoredDecodedBytes() {
    return buffersByteSize([
      ...this.authoredBuffers.values(),
      ...this.loadingAuthoredBuffers.values(),
      ...[...this.active]
        .filter((entry) => entry.kind.startsWith("authored"))
        .map((entry) => entry.buffer),
    ]);
  }

  private totalDecodedBytes() {
    return buffersByteSize([
      ...this.buffers.values(),
      ...this.authoredBuffers.values(),
      ...this.loadingAuthoredBuffers.values(),
      ...[...this.active].map((entry) => entry.buffer),
    ]);
  }
}
