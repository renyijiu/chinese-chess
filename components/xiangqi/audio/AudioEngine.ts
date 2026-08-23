import type { AudioBus, AudioCueId, AudioMix } from "./audio-types";
import { DEFAULT_AUDIO_MIX } from "./audio-types";

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
  onended: (() => void) | null;
  start(when?: number): void;
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
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

type ActiveSource = Readonly<{
  cue: AudioCueId;
  nodes: readonly AudioNodeLike[];
  source: BufferSourceLike;
}>;

type DocumentVisibility = Readonly<{
  addEventListener(type: "visibilitychange", listener: () => void): void;
  hidden: boolean;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}>;

export type AudioEngineState = "locked" | "running" | "muted";

export type AudioEngineOptions = Readonly<{
  contextFactory?: () => AudioContextLike;
  maxVoicesPerCue?: number;
  speech?: Pick<SpeechSynthesis, "cancel" | "speak"> | null;
  utteranceFactory?: (text: string) => SpeechSynthesisUtterance;
}>;

const BUS_BY_PREFIX: Readonly<Record<string, AudioBus>> = Object.freeze({
  ambient: "ambient",
  music: "music",
  system: "ui",
  ui: "ui",
});

function contextFactory(): AudioContextLike {
  const Constructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) throw new Error("Web Audio is unavailable");
  return new Constructor() as unknown as AudioContextLike;
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
      const rising = cue !== "system.defeat";
      const frequency = (rising ? 185 : 150) * 2 ** ((rising ? phase : -phase) * 0.8);
      value = (Math.sin(Math.PI * 2 * frequency * time) + Math.sin(Math.PI * 4 * frequency * time) * 0.35) * envelope * 0.16;
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

/** One application-wide Web Audio graph. Cues are generated from original synthesis parameters; no samples are downloaded. */
export class AudioEngine {
  private readonly active = new Set<ActiveSource>();
  private readonly activeByCue = new Map<AudioCueId, number>();
  private readonly buffers = new Map<AudioCueId, AudioBuffer>();
  private readonly contextFactory: () => AudioContextLike;
  private readonly maxVoicesPerCue: number;
  private readonly speech: Pick<SpeechSynthesis, "cancel" | "speak"> | null;
  private readonly utteranceFactory: ((text: string) => SpeechSynthesisUtterance) | null;
  private buses: Partial<Record<"master" | AudioBus, GainNodeLike>> = {};
  private context: AudioContextLike | null = null;
  private mix: AudioMix = DEFAULT_AUDIO_MIX;
  private muted = false;
  private unlocked = false;
  private voiceCount = 0;

  constructor(options: AudioEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? contextFactory;
    this.maxVoicesPerCue = Math.max(1, options.maxVoicesPerCue ?? 4);
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
    if (!this.context) {
      this.context = this.contextFactory();
      this.createGraph(this.context);
    }
    if (this.context.state !== "running") await this.context.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      this.applyMix();
      this.playInternal("music.fortress", true);
      this.playInternal("ambient.fortress", true);
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
    if (muted) this.speech?.cancel();
    this.applyMix();
  }

  play(cue: AudioCueId, options: { position?: readonly [number, number, number] } = {}) {
    if (!this.unlocked || this.muted || !this.context) return false;
    return this.playInternal(cue, false, options.position);
  }

  speak(text: string, options: { rate?: number; volumeScale?: number } = {}) {
    if (!this.unlocked || this.muted || !this.speech || !this.utteranceFactory || this.voiceCount >= 2) return false;
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

  /** Keeps the context's single listener attached to the active R3F camera. */
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
    const handleVisibility = () => {
      if (!this.context || !this.unlocked) return;
      if (documentLike.hidden) {
        void this.context.suspend().catch(() => undefined);
        this.speech?.cancel();
      } else {
        void this.context.resume().catch(() => undefined);
      }
    };
    documentLike.addEventListener("visibilitychange", handleVisibility);
    return () => documentLike.removeEventListener("visibilitychange", handleVisibility);
  }

  debugSnapshot() {
    return {
      activeSources: this.active.size,
      cachedBuffers: this.buffers.size,
      mix: this.mix,
      state: this.state,
      voiceCount: this.voiceCount,
    } as const;
  }

  async dispose() {
    this.speech?.cancel();
    this.voiceCount = 0;
    for (const entry of [...this.active]) {
      entry.source.onended = null;
      try { entry.source.stop(); } catch { /* An already-ended source is harmless. */ }
      entry.nodes.forEach((node) => {
        try { node.disconnect(); } catch { /* Best-effort Web Audio cleanup. */ }
      });
    }
    this.active.clear();
    this.activeByCue.clear();
    this.buffers.clear();
    Object.values(this.buses).forEach((node) => {
      try { node?.disconnect(); } catch { /* Best-effort Web Audio cleanup. */ }
    });
    this.buses = {};
    const context = this.context;
    this.context = null;
    this.unlocked = false;
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

  private getBuffer(cue: AudioCueId) {
    const cached = this.buffers.get(cue);
    if (cached) return cached;
    if (!this.context) throw new Error("Audio context is locked");
    const loop = cue === "music.fortress" || cue === "ambient.fortress";
    const buffer = this.context.createBuffer(loop ? 2 : 1, Math.ceil(cueDuration(cue) * this.context.sampleRate), this.context.sampleRate);
    if (loop) fillLoop(buffer, cue); else fillCue(buffer, cue);
    this.buffers.set(cue, buffer);
    return buffer;
  }

  private playInternal(cue: AudioCueId, loop: boolean, position?: readonly [number, number, number]) {
    const context = this.context;
    const bus = this.buses[cueBus(cue)];
    if (!context || !bus) return false;
    const activeCount = this.activeByCue.get(cue) ?? 0;
    if (!loop && activeCount >= this.maxVoicesPerCue) return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.getBuffer(cue);
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
      panner.connect(bus);
      nodes.push(panner);
    } else {
      gain.connect(bus);
    }
    const entry: ActiveSource = { cue, nodes, source };
    const cleanup = () => {
      if (!this.active.delete(entry)) return;
      this.activeByCue.set(cue, Math.max(0, (this.activeByCue.get(cue) ?? 1) - 1));
      nodes.forEach((node) => {
        try { node.disconnect(); } catch { /* Browser may already have disconnected it. */ }
      });
    };
    source.onended = cleanup;
    this.active.add(entry);
    this.activeByCue.set(cue, activeCount + 1);
    try {
      source.start();
      return true;
    } catch {
      cleanup();
      return false;
    }
  }
}
