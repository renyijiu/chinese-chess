import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AudioEngine,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
} from "../../../components/xiangqi/audio/AudioEngine";
import { DEFAULT_AUDIO_MIX } from "../../../components/xiangqi/audio/audio-types";
import {
  QIN_AUDIO_ASSET_IDS,
  type QinAudioPackManifestV1,
} from "../../../components/xiangqi/audio/qin-audio-pack-contract";

class FakeParam implements AudioParamLike {
  value = 1;
  readonly setCalls: Array<{ value: number; time: number }> = [];
  readonly rampCalls: Array<{ value: number; time: number }> = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.setCalls.push({ value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.rampCalls.push({ value, time });
  }
}

class FakeNode implements AudioNodeLike {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class FakeGain extends FakeNode { gain = new FakeParam(); }

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopEnd = 0;
  loopStart = 0;
  onended: (() => void) | null = null;
  failStart = false;
  start = vi.fn((when?: number, offset?: number) => {
    void when;
    void offset;
    if (this.failStart) throw new Error("source start failed");
  });
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
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  constructor(channels: number, length: number, sampleRate = 8_000, allocate = true) {
    this.channels = Array.from({ length: channels }, () => new Float32Array(allocate ? length : 0));
    this.duration = length / sampleRate;
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
  decodeImpl: ((data: ArrayBuffer) => Promise<AudioBuffer>) | null = null;
  failNextStart = false;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  close = vi.fn(async () => { this.state = "closed"; });
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => new FakeBuffer(channels, length, sampleRate) as unknown as AudioBuffer);
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    source.failStart = this.failNextStart;
    this.failNextStart = false;
    this.sources.push(source);
    return source;
  });
  createGain = vi.fn(() => {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  });
  createPanner = vi.fn(() => new FakePanner());
  decodeAudioData = vi.fn((data: ArrayBuffer) => {
    if (!this.decodeImpl) throw new Error("Unexpected decode");
    return this.decodeImpl(data);
  });
  resume = vi.fn(async () => { this.state = "running"; });
  suspend = vi.fn(async () => { this.state = "suspended"; });
}

const PACK_DEFINITIONS = [
  ["music.qin-procession", "qin-procession-v1.mp3", "background", "critical", "music", "audio/mpeg", "mp3", 72, 2, "music.fortress"],
  ["accent.capture-clay", "capture-clay-v1.wav", "transient", "deferred", "sfx", "audio/wav", "pcm_s16le", 0.42, 1, "system.capture"],
  ["system.check", "check-bronze-v1.wav", "transient", "deferred", "sfx", "audio/wav", "pcm_s16le", 0.78, 1, "system.check"],
  ["system.victory", "result-victory-v1.wav", "transient", "deferred", "sfx", "audio/wav", "pcm_s16le", 2.24, 1, "system.victory"],
  ["system.defeat", "result-defeat-v1.wav", "transient", "deferred", "sfx", "audio/wav", "pcm_s16le", 2.24, 1, "system.defeat"],
  ["system.draw", "result-draw-v1.wav", "transient", "deferred", "sfx", "audio/wav", "pcm_s16le", 2.24, 1, "system.draw"],
] as const;

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeRuntimePack() {
  const bodies = new Map<string, Uint8Array>();
  const assets = PACK_DEFINITIONS.map((definition, order) => {
    const [id, filename, kind, group, bus, mimeType, codec, durationSeconds, channels, synthFallbackId] = definition;
    const body = new Uint8Array([order + 1, 21, 34, 55]);
    const url = `/audio/qin-diorama/v1/${filename}`;
    bodies.set(url, body);
    return {
      id,
      order,
      kind,
      group,
      url,
      mimeType,
      codec,
      bytes: body.byteLength,
      sha256: digest(body),
      durationSeconds,
      channels,
      sampleRate: 48_000,
      sampleFrames: Math.round(durationSeconds * 48_000),
      ...(kind === "background" ? { loop: { startSeconds: 4, endSeconds: 68 } } : {}),
      bus,
      synthFallbackId,
      sourceRecordId: `source.${id}`,
    };
  });
  const manifest: QinAudioPackManifestV1 = {
    schema: "xiangqi-audio-pack/v1",
    version: 1,
    packId: "qin-diorama",
    claimBoundary: "Qin-inspired visual fantasy; not a historical reconstruction or claim of acoustic authenticity.",
    loadOrder: [...QIN_AUDIO_ASSET_IDS],
    assets,
    sourceRecords: assets.map((asset) => ({
      id: asset.sourceRecordId,
      author: "test",
      authorization: "test",
      sourcePaths: ["test.flac"],
      claimBoundary: "Qin-inspired visual fantasy; not a historical reconstruction or claim of acoustic authenticity.",
    })),
  };
  return { bodies, manifest };
}

function installPackDecoder(context: FakeContext, manifest: QinAudioPackManifestV1) {
  context.decodeImpl = async (data) => {
    const order = new Uint8Array(data)[0]! - 1;
    const asset = manifest.assets[order]!;
    return new FakeBuffer(
      asset.channels,
      Math.round(asset.durationSeconds * context.sampleRate),
      context.sampleRate,
      false,
    ) as unknown as AudioBuffer;
  };
}

function responseForPackUrl(pack: ReturnType<typeof makeRuntimePack>, input: RequestInfo | URL) {
  const path = new URL(String(input), "https://example.test").pathname.replace(/^\/chess/, "");
  if (path.endsWith("/manifest.json")) {
    return new Response(JSON.stringify(pack.manifest), { headers: { "content-type": "application/json" } });
  }
  const body = pack.bodies.get(path);
  if (!body) return new Response("missing", { status: 404 });
  const asset = pack.manifest.assets.find((candidate) => candidate.url === path)!;
  return new Response(body.slice().buffer as ArrayBuffer, { headers: { "content-type": asset.mimeType } });
}

async function settlePack(engine: AudioEngine) {
  for (let turn = 0; turn < 100 && engine.debugSnapshot().packState === "loading"; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("AudioEngine", () => {
  it("characterizes one context, persistent buses, visibility, and disposal", async () => {
    const context = new FakeContext();
    const factory = vi.fn(() => context);
    const engine = new AudioEngine({ contextFactory: factory });
    let visibilityListener: (() => void) | null = null;
    let hidden = false;
    const documentLike = {
      addEventListener: vi.fn((_name: string, listener: () => void) => { visibilityListener = listener; }),
      get hidden() { return hidden; },
      removeEventListener: vi.fn(),
    };

    const detach = engine.attachVisibility(documentLike);
    await engine.unlock();
    await engine.unlock();

    expect(factory).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(2);
    expect(context.sources.every((source) => source.loop)).toBe(true);
    expect(context.gains).toHaveLength(8); // master + five buses + two private source gains
    expect(context.gains[0]?.gain.value).toBe(DEFAULT_AUDIO_MIX.master);
    expect(context.gains[1]?.gain.value).toBe(DEFAULT_AUDIO_MIX.music);
    expect(context.gains[2]?.gain.value).toBe(DEFAULT_AUDIO_MIX.ambient);

    hidden = true;
    (visibilityListener as (() => void) | null)?.();
    await Promise.resolve();
    expect(context.suspend).toHaveBeenCalledOnce();

    detach();
    await engine.dispose();
    expect(documentLike.removeEventListener).toHaveBeenCalledOnce();
    expect(context.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
    expect(engine.debugSnapshot()).toMatchObject({ activeSources: 0, cachedBuffers: 0, state: "locked" });
  });

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

  it("prefers a 48 kHz context and falls back to default construction", async () => {
    const context = new FakeContext();
    const factory = vi.fn((options?: AudioContextOptions) => {
      if (options?.sampleRate) throw new Error("sample-rate option unsupported");
      return context;
    });
    const engine = new AudioEngine({ contextFactory: factory });

    await engine.unlock();

    expect(factory.mock.calls).toEqual([[{ sampleRate: 48_000 }], []]);
    expect(context.sources).toHaveLength(2);
  });

  it("starts synth immediately, loads serially, and takes over at the next loop boundary", async () => {
    const context = new FakeContext();
    context.currentTime = 10;
    const pack = makeRuntimePack();
    installPackDecoder(context, pack.manifest);
    let releaseManifest: (response: Response) => void = () => undefined;
    const manifestResponse = new Promise<Response>((resolve) => { releaseManifest = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("manifest.json")) return manifestResponse;
      return Promise.resolve(responseForPackUrl(pack, input));
    });
    const engine = new AudioEngine({ baseUrl: "/chess/", contextFactory: () => context, fetcher });

    await engine.unlock();

    expect(context.sources).toHaveLength(2);
    expect(engine.debugSnapshot()).toMatchObject({ musicMode: "synth", packState: "loading" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    releaseManifest(responseForPackUrl(pack, "/audio/qin-diorama/v1/manifest.json"));
    await settlePack(engine);

    const authored = context.sources[2]!;
    expect(engine.debugSnapshot()).toMatchObject({
      maxInFlightDecodes: 1,
      maxInFlightFetches: 1,
      musicMode: "authored",
      packState: "ready",
      pendingDecodes: 0,
      pendingFetches: 0,
    });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/chess/audio/qin-diorama/v1/manifest.json",
      ...pack.manifest.loadOrder.map((id) => `/chess${pack.manifest.assets.find((asset) => asset.id === id)!.url}`),
    ]);
    expect(authored.loop).toBe(true);
    expect(authored.loopStart).toBe(4);
    expect(authored.loopEnd).toBe(68);
    expect(authored.start).toHaveBeenCalledWith(18, 4);
    expect(context.gains[1]?.gain.rampCalls).toEqual([]); // the user music bus never crossfades
    expect(context.gains[6]?.gain.rampCalls).toContainEqual({ value: 0, time: 19 });
    expect(context.gains[8]?.gain.rampCalls).toContainEqual({ value: 1, time: 19 });

    await engine.unlock();
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(context.sources).toHaveLength(3);
  });

  it.each([
    ["manifest rejection", () => vi.fn(async () => { throw new Error("offline"); })],
    ["non-success response", () => vi.fn(async () => new Response("no", { status: 503 }))],
    ["body failure", (pack: ReturnType<typeof makeRuntimePack>) => vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("manifest.json")) return responseForPackUrl(pack, input);
      return {
        arrayBuffer: async () => { throw new Error("body interrupted"); },
        headers: new Headers({ "content-type": "audio/mpeg" }),
        ok: true,
        status: 200,
      } as unknown as Response;
    })],
    ["MIME mismatch", (pack: ReturnType<typeof makeRuntimePack>) => vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("manifest.json")) return responseForPackUrl(pack, input);
      return new Response(pack.bodies.get(pack.manifest.assets[0]!.url)!.slice().buffer as ArrayBuffer, {
        headers: { "content-type": "audio/wav" },
      });
    })],
    ["hash failure", (pack: ReturnType<typeof makeRuntimePack>) => vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("manifest.json")) return responseForPackUrl(pack, input);
      return new Response(new Uint8Array([99, 21, 34, 55]).buffer, { headers: { "content-type": "audio/mpeg" } });
    })],
  ])("contains %s without stopping synth", async (_label, makeFetcher) => {
    const context = new FakeContext();
    const pack = makeRuntimePack();
    installPackDecoder(context, pack.manifest);
    const engine = new AudioEngine({ contextFactory: () => context, fetcher: makeFetcher(pack) });

    await expect(engine.unlock()).resolves.toBeUndefined();
    await settlePack(engine);

    expect(engine.debugSnapshot()).toMatchObject({
      authoredDecodedBytes: 0,
      musicMode: "synth",
      packState: "unavailable",
    });
    expect(context.sources.slice(0, 2).every((source) => source.stop.mock.calls.length === 0)).toBe(true);
    await engine.unlock();
    expect(engine.debugSnapshot().packState).toBe("unavailable");
  });

  it("makes a high-sample-rate decoded pack unavailable by actual working bytes", async () => {
    const context = new FakeContext();
    context.sampleRate = 96_000;
    const pack = makeRuntimePack();
    installPackDecoder(context, pack.manifest);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => responseForPackUrl(pack, input));
    const engine = new AudioEngine({ contextFactory: () => context, fetcher });

    await engine.unlock();
    await settlePack(engine);

    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(engine.debugSnapshot()).toMatchObject({ authoredDecodedBytes: 0, packState: "unavailable" });
    expect(engine.debugSnapshot().totalDecodedBytes).toBeLessThanOrEqual(40 * 1024 * 1024);
  });

  it("keeps ready music hidden until resume succeeds and exposes transient eligibility", async () => {
    const context = new FakeContext();
    const pack = makeRuntimePack();
    installPackDecoder(context, pack.manifest);
    let hidden = false;
    let visibilityListener: (() => void) | null = null;
    const documentLike = {
      addEventListener: (_name: string, listener: () => void) => { visibilityListener = listener; },
      get hidden() { return hidden; },
      removeEventListener: vi.fn(),
    };
    let releaseManifest: (response: Response) => void = () => undefined;
    const manifestResponse = new Promise<Response>((resolve) => { releaseManifest = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).endsWith("manifest.json")
      ? manifestResponse
      : Promise.resolve(responseForPackUrl(pack, input)));
    const engine = new AudioEngine({ contextFactory: () => context, fetcher });
    engine.attachVisibility(documentLike);
    await engine.unlock();

    hidden = true;
    (visibilityListener as (() => void) | null)?.();
    expect(engine.isTransientEligible()).toBe(false);
    releaseManifest(responseForPackUrl(pack, "/audio/qin-diorama/v1/manifest.json"));
    await settlePack(engine);
    expect(engine.debugSnapshot()).toMatchObject({ foregroundEligible: false, musicMode: "synth", packState: "ready" });
    expect(context.sources).toHaveLength(2);

    hidden = false;
    (visibilityListener as (() => void) | null)?.();
    await vi.waitFor(() => expect(engine.isTransientEligible()).toBe(true));
    expect(engine.isTransientEligible()).toBe(true);
    expect(engine.debugSnapshot().musicMode).toBe("authored");
    expect(context.sources).toHaveLength(3);
  });

  it("aborts a deadline and ignores a decode that resolves after disposal", async () => {
    const deadlineContext = new FakeContext();
    const deadlinePack = makeRuntimePack();
    installPackDecoder(deadlineContext, deadlinePack.manifest);
    let deadline: () => void = () => undefined;
    const deadlineEngine = new AudioEngine({
      contextFactory: () => deadlineContext,
      fetcher: vi.fn(() => new Promise<Response>(() => undefined)),
      scheduleDeadline: (callback) => { deadline = callback; return 1; },
      clearDeadline: vi.fn(),
    });
    await deadlineEngine.unlock();
    deadline();
    await settlePack(deadlineEngine);
    expect(deadlineEngine.debugSnapshot()).toMatchObject({ abortCount: 1, packState: "unavailable" });

    const context = new FakeContext();
    const pack = makeRuntimePack();
    let resolveDecode: (buffer: AudioBuffer) => void = () => undefined;
    context.decodeImpl = () => new Promise<AudioBuffer>((resolve) => { resolveDecode = resolve; });
    const engine = new AudioEngine({
      contextFactory: () => context,
      fetcher: vi.fn(async (input: RequestInfo | URL) => responseForPackUrl(pack, input)),
    });
    await engine.unlock();
    for (let turn = 0; turn < 20 && context.decodeAudioData.mock.calls.length === 0; turn += 1) await Promise.resolve();
    const generation = engine.debugSnapshot().generation;
    const disposal = engine.dispose();
    resolveDecode(new FakeBuffer(2, 72 * context.sampleRate, context.sampleRate, false) as unknown as AudioBuffer);
    await disposal;
    await Promise.resolve();

    expect(engine.debugSnapshot()).toMatchObject({
      activeSources: 0,
      authoredDecodedBytes: 0,
      foregroundEligible: false,
      listenerAttachments: 0,
      pendingDecodes: 0,
      pendingFetches: 0,
    });
    expect(engine.debugSnapshot().generation).toBeGreaterThan(generation);
    expect(context.sources).toHaveLength(2);
  });

  it("falls back once when an authored transient cannot start and returns music to synth", async () => {
    const context = new FakeContext();
    const pack = makeRuntimePack();
    installPackDecoder(context, pack.manifest);
    const engine = new AudioEngine({
      contextFactory: () => context,
      fetcher: vi.fn(async (input: RequestInfo | URL) => responseForPackUrl(pack, input)),
    });
    await engine.unlock();
    await settlePack(engine);
    expect(engine.debugSnapshot().packState).toBe("ready");

    context.failNextStart = true;
    expect(engine.playTransient("system.check")).toBe(true);

    expect(engine.debugSnapshot()).toMatchObject({ musicMode: "synth", packState: "unavailable" });
    expect(context.sources.slice(-2)).toHaveLength(2); // failed authored event + one synth event
    expect(context.sources.at(-1)?.start).toHaveBeenCalledOnce();
  });

  it("keeps loading through mute without duplicating the loader or music source", async () => {
    const context = new FakeContext();
    const pack = makeRuntimePack();
    installPackDecoder(context, pack.manifest);
    let releaseManifest: (response: Response) => void = () => undefined;
    const manifestResponse = new Promise<Response>((resolve) => { releaseManifest = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).endsWith("manifest.json")
      ? manifestResponse
      : Promise.resolve(responseForPackUrl(pack, input)));
    const engine = new AudioEngine({ contextFactory: () => context, fetcher });

    await engine.unlock();
    engine.setMuted(true);
    expect(context.gains[0]?.gain.value).toBe(0);
    releaseManifest(responseForPackUrl(pack, "/audio/qin-diorama/v1/manifest.json"));
    await settlePack(engine);
    expect(engine.debugSnapshot()).toMatchObject({ packState: "ready", state: "muted" });

    engine.setMuted(false);
    await engine.unlock();
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(context.sources).toHaveLength(3);
  });

  it("provides distinct synthesized capture and draw transients when the pack is unavailable", async () => {
    const context = new FakeContext();
    const engine = new AudioEngine({ contextFactory: () => context, fetcher: null });
    await engine.unlock();

    expect(engine.playTransient("system.capture")).toBe(true);
    const capture = context.sources.at(-1)?.buffer as unknown as FakeBuffer;
    context.sources.at(-1)?.onended?.();
    expect(engine.playTransient("system.draw")).toBe(true);
    const draw = context.sources.at(-1)?.buffer as unknown as FakeBuffer;

    expect(capture.length).toBe(Math.ceil(0.42 * context.sampleRate));
    expect(draw.length).toBe(Math.ceil(1.1 * context.sampleRate));
    expect(capture.channels[0]?.slice(20, 80)).not.toEqual(draw.channels[0]?.slice(20, 80));
    expect(context.gains.at(-1)?.connect).toHaveBeenCalledWith(context.gains[4]); // semantic SFX bus
  });

  it("keeps synth music when authored background decode or startup fails", async () => {
    const decodeContext = new FakeContext();
    const decodePack = makeRuntimePack();
    decodeContext.decodeImpl = async () => { throw new Error("unsupported codec"); };
    const decodeEngine = new AudioEngine({
      contextFactory: () => decodeContext,
      fetcher: vi.fn(async (input: RequestInfo | URL) => responseForPackUrl(decodePack, input)),
    });
    await decodeEngine.unlock();
    await settlePack(decodeEngine);
    expect(decodeEngine.debugSnapshot()).toMatchObject({ authoredDecodedBytes: 0, packState: "unavailable" });
    expect(decodeContext.sources.slice(0, 2).every((source) => source.stop.mock.calls.length === 0)).toBe(true);

    const startContext = new FakeContext();
    const startPack = makeRuntimePack();
    installPackDecoder(startContext, startPack.manifest);
    let releaseManifest: (response: Response) => void = () => undefined;
    const manifestResponse = new Promise<Response>((resolve) => { releaseManifest = resolve; });
    const startEngine = new AudioEngine({
      contextFactory: () => startContext,
      fetcher: vi.fn((input: RequestInfo | URL) => String(input).endsWith("manifest.json")
        ? manifestResponse
        : Promise.resolve(responseForPackUrl(startPack, input))),
    });
    await startEngine.unlock();
    startContext.failNextStart = true;
    releaseManifest(responseForPackUrl(startPack, "/audio/qin-diorama/v1/manifest.json"));
    await settlePack(startEngine);
    expect(startEngine.debugSnapshot()).toMatchObject({ musicMode: "synth", packState: "unavailable" });
    expect(startContext.sources[0]?.stop).not.toHaveBeenCalled();
  });

  it("settles one hundred unlock and transient cycles without growing owned resources", async () => {
    const context = new FakeContext();
    const factory = vi.fn(() => context);
    const engine = new AudioEngine({ contextFactory: factory, fetcher: null });
    let visibilityListener: (() => void) | null = null;
    let hidden = false;
    const documentLike = {
      addEventListener: (_name: string, listener: () => void) => { visibilityListener = listener; },
      get hidden() { return hidden; },
      removeEventListener: vi.fn(),
    };
    engine.attachVisibility(documentLike);

    for (let cycle = 0; cycle < 100; cycle += 1) {
      await engine.unlock();
      expect(engine.play("ui.select")).toBe(true);
      context.sources.at(-1)?.onended?.();
      if (cycle % 10 === 0) {
        hidden = true;
        (visibilityListener as (() => void) | null)?.();
        expect(engine.isTransientEligible()).toBe(false);
        hidden = false;
        (visibilityListener as (() => void) | null)?.();
        await vi.waitFor(() => expect(engine.isTransientEligible()).toBe(true));
      }
    }

    expect(factory).toHaveBeenCalledOnce();
    expect(engine.debugSnapshot()).toMatchObject({
      activeSources: 2,
      listenerAttachments: 1,
      packState: "unavailable",
      pendingDecodes: 0,
      pendingFetches: 0,
      sourceEnds: 100,
      sourceStops: 0,
    });
    const startsBeforeDispose = engine.debugSnapshot().sourceStarts;
    await engine.dispose();
    await Promise.resolve();
    expect(engine.debugSnapshot()).toMatchObject({
      activeSources: 0,
      authoredDecodedBytes: 0,
      listenerAttachments: 0,
      pendingDecodes: 0,
      pendingFetches: 0,
      sourceStops: 2,
      totalDecodedBytes: 0,
    });
    expect(engine.debugSnapshot().sourceStarts).toBe(startsBeforeDispose);
    expect(documentLike.removeEventListener).toHaveBeenCalledOnce();
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
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(2));
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
