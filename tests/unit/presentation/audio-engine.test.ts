import { describe, expect, it, vi } from "vitest";

import {
  AudioEngine,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
} from "../../../components/xiangqi/audio/AudioEngine";
import { DEFAULT_AUDIO_MIX } from "../../../components/xiangqi/audio/audio-types";

class FakeParam implements AudioParamLike {
  value = 1;
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
}

class FakeNode implements AudioNodeLike {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class FakeGain extends FakeNode { gain = new FakeParam(); }

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onended?.());
}

class FakePanner extends FakeNode {
  panningModel: PanningModelType = "HRTF";
  distanceModel: DistanceModelType = "inverse";
  refDistance = 1;
  maxDistance = 100;
  rolloffFactor = 1;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
}

class FakeBuffer {
  readonly channels: Float32Array[];
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  constructor(channels: number, length: number, sampleRate = 8_000) {
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
    this.length = length;
    this.numberOfChannels = channels;
    this.sampleRate = sampleRate;
  }
  getChannelData(channel: number) { return this.channels[channel]!; }
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  destination = new FakeNode();
  listener = {
    positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
    forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(),
    upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam(),
  };
  sampleRate = 8_000;
  state: AudioContextState = "suspended";
  sources: FakeSource[] = [];
  close = vi.fn(async () => { this.state = "closed"; });
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => new FakeBuffer(channels, length, sampleRate) as unknown as AudioBuffer);
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
  createGain = vi.fn(() => new FakeGain());
  createPanner = vi.fn(() => new FakePanner());
  resume = vi.fn(async () => { this.state = "running"; });
  suspend = vi.fn(async () => { this.state = "suspended"; });
}

describe("AudioEngine", () => {
  it("stays locked until a user gesture unlocks its one reusable context", async () => {
    const context = new FakeContext();
    const factory = vi.fn(() => context);
    const engine = new AudioEngine({ contextFactory: factory });

    expect(engine.state).toBe("locked");
    expect(engine.play("ui.select")).toBe(false);
    await engine.unlock();
    await engine.unlock();

    expect(engine.state).toBe("running");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.play("ui.select")).toBe(true);
    expect(context.createBuffer).toHaveBeenCalledTimes(3); // music, ambient, ui cue
    engine.setListenerPose([1, 2, 3], [0, 0, -1], [0, 1, 0]);
    expect(context.listener.positionX.value).toBe(1);
    expect(context.listener.forwardZ.value).toBe(-1);
  });

  it("supports legacy listener methods and suspends while the document is hidden", async () => {
    const context = new FakeContext();
    const setPosition = vi.fn();
    const setOrientation = vi.fn();
    Object.defineProperty(context, "listener", { value: { setOrientation, setPosition } });
    const engine = new AudioEngine({ contextFactory: () => context });
    await engine.unlock();
    engine.setListenerPose([4, 5, 6], [0, 0, -1], [0, 1, 0]);
    expect(setPosition).toHaveBeenCalledWith(4, 5, 6);
    expect(setOrientation).toHaveBeenCalledWith(0, 0, -1, 0, 1, 0);

    let visibilityListener: (() => void) | null = null;
    let hidden = true;
    const documentLike = {
      addEventListener: (_name: string, listener: () => void) => { visibilityListener = listener; },
      get hidden() { return hidden; },
      removeEventListener: vi.fn(),
    };
    const detach = engine.attachVisibility(documentLike);
    (visibilityListener as (() => void) | null)?.();
    await Promise.resolve();
    expect(context.suspend).toHaveBeenCalledOnce();
    hidden = false;
    (visibilityListener as (() => void) | null)?.();
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(2); // unlock + visibility restoration
    detach();
    expect(documentLike.removeEventListener).toHaveBeenCalledOnce();
  });

  it("reuses synthesized buffers while creating and cleaning independent sources", async () => {
    const context = new FakeContext();
    const engine = new AudioEngine({ contextFactory: () => context });
    await engine.unlock();
    const initialBuffers = context.createBuffer.mock.calls.length;

    expect(engine.play("soldier.release", { position: [1, 0, 2] })).toBe(true);
    expect(engine.play("soldier.release", { position: [2, 0, 2] })).toBe(true);
    expect(context.createBuffer.mock.calls.length).toBe(initialBuffers + 1);
    expect(context.createPanner).toHaveBeenCalledTimes(2);

    context.sources.at(-1)?.onended?.();
    expect(engine.debugSnapshot().activeSources).toBeGreaterThanOrEqual(2); // two loops remain
    await engine.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(engine.debugSnapshot().activeSources).toBe(0);
  });

  it("applies all bus gains, mute state, and per-cue concurrency limits", async () => {
    const context = new FakeContext();
    const engine = new AudioEngine({ contextFactory: () => context, maxVoicesPerCue: 2 });
    await engine.unlock();
    engine.setMix({
      ...DEFAULT_AUDIO_MIX,
      master: 0.4,
      music: 0.2,
      ambient: 0.3,
      voice: 0.5,
      sfx: 0.6,
      ui: 0.7,
    });
    expect(engine.debugSnapshot().mix).toMatchObject({ master: 0.4, music: 0.2, ui: 0.7 });

    expect(engine.play("cannon.impact")).toBe(true);
    expect(engine.play("cannon.impact")).toBe(true);
    expect(engine.play("cannon.impact")).toBe(false);
    engine.setMuted(true);
    expect(engine.state).toBe("muted");
    expect(engine.play("ui.select")).toBe(false);
  });

  it("limits optional platform speech voices and silently frees a completed line", async () => {
    const context = new FakeContext();
    const spoken: SpeechSynthesisUtterance[] = [];
    const speech = { cancel: vi.fn(), speak: vi.fn((utterance: SpeechSynthesisUtterance) => spoken.push(utterance)) };
    const utteranceFactory = (text: string) => ({ text }) as SpeechSynthesisUtterance;
    const engine = new AudioEngine({ contextFactory: () => context, speech, utteranceFactory });
    await engine.unlock();

    expect(engine.speak("向前！")).toBe(true);
    expect(engine.speak("破阵！")).toBe(true);
    expect(engine.speak("不会排队补播")).toBe(false);
    spoken[0]?.onend?.({} as SpeechSynthesisEvent);
    expect(engine.speak("再战！")).toBe(true);
    engine.setMuted(true);
    expect(speech.cancel).toHaveBeenCalled();
  });
});
