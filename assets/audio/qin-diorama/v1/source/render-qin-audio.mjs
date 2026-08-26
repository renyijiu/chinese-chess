#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = resolve(SOURCE_DIR, "..");
const ROOT = resolve(PACK_DIR, "../../../..");
const EXPORT_DIR = resolve(SOURCE_DIR, "exports");
const RUNTIME_DIR = resolve(ROOT, "public/audio/qin-diorama/v1");
const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 72;
const LOOP_START_SECONDS = 4;
const LOOP_SECONDS = 64;
const LOOP_FRAMES = SAMPLE_RATE * LOOP_SECONDS;
const TOTAL_FRAMES = SAMPLE_RATE * DURATION_SECONDS;
const TAU = Math.PI * 2;

mkdirSync(EXPORT_DIR, { recursive: true });
mkdirSync(RUNTIME_DIR, { recursive: true });

function runFfmpeg(args, input) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr?.toString("utf8") || `exit ${result.status}`}`);
  }
}

function interleave(channels) {
  const frames = channels[0].length;
  const output = Buffer.allocUnsafe(frames * channels.length * 4);
  let offset = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of channels) {
      output.writeFloatLE(channel[frame], offset);
      offset += 4;
    }
  }
  return output;
}

function encodeFlac(channels, outputPath) {
  runFfmpeg([
    "-f", "f32le",
    "-ar", String(SAMPLE_RATE),
    "-ac", String(channels.length),
    "-i", "pipe:0",
    "-map_metadata", "-1",
    "-c:a", "flac",
    "-compression_level", "8",
    outputPath,
  ], interleave(channels));
}

function writePcm16Wav(samples, outputPath) {
  const dataBytes = samples.length * 2;
  const output = Buffer.allocUnsafe(44 + dataBytes);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVEfmt ", 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    output.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + index * 2);
  }
  writeFileSync(outputPath, output);
}

function loopIndex(frame) {
  return ((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES;
}

function addLoopEvent(target, startSeconds, durationSeconds, render) {
  const frames = Math.round(durationSeconds * SAMPLE_RATE);
  const startFrame = Math.round(startSeconds * SAMPLE_RATE);
  for (let frame = 0; frame < frames; frame += 1) {
    target[loopIndex(startFrame + frame)] += render(frame / SAMPLE_RATE, frame, frames);
  }
}

function deterministicNoise(index, seed) {
  let value = (index + 1 + seed * 1013) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function strikeEnvelope(time, attack, decay) {
  return (1 - Math.exp(-time / attack)) * Math.exp(-time / decay);
}

function fadeOut(time, duration, tail = 0.05) {
  return Math.min(1, Math.max(0, (duration - time) / tail));
}

function addClay(target, start, frequency, amplitude = 0.16, decay = 1.45) {
  const duration = Math.min(3.2, decay * 4.4);
  const modes = [[1, 1], [2.18, 0.42], [3.07, 0.22], [4.73, 0.1]];
  addLoopEvent(target, start, duration, (time) => {
    const envelope = strikeEnvelope(time, 0.0035, decay) * fadeOut(time, duration);
    const body = modes.reduce((sum, [ratio, weight], index) => (
      sum + Math.sin(TAU * frequency * ratio * time + index * 0.37) * weight
    ), 0);
    return amplitude * envelope * body;
  });
}

function addBronze(target, start, frequency, amplitude = 0.08, decay = 1.8) {
  const duration = Math.min(4, decay * 4.5);
  const modes = [[1, 0.8], [2.67, 0.42], [4.13, 0.21], [5.71, 0.09]];
  addLoopEvent(target, start, duration, (time) => {
    const envelope = strikeEnvelope(time, 0.002, decay) * fadeOut(time, duration);
    const body = modes.reduce((sum, [ratio, weight], index) => (
      sum + Math.sin(TAU * frequency * ratio * time + index * 0.81) * weight
    ), 0);
    return amplitude * envelope * body;
  });
}

function addBreathTone(target, start, duration, frequency, amplitude = 0.055, seed = 1) {
  let smoothedNoise = 0;
  addLoopEvent(target, start, duration, (time, frame) => {
    smoothedNoise += (deterministicNoise(frame, seed) - smoothedNoise) * 0.06;
    const entrance = Math.min(1, time / 0.28);
    const exit = Math.min(1, (duration - time) / 0.4);
    const envelope = Math.max(0, Math.min(entrance, exit));
    const vibrato = 0.018 * Math.sin(TAU * 4.4 * time);
    const tone = Math.sin(TAU * frequency * time + vibrato)
      + 0.22 * Math.sin(TAU * frequency * 2.01 * time + 0.4);
    return amplitude * envelope * (tone + smoothedNoise * 0.38);
  });
}

function addDrum(target, start, amplitude = 0.15, pitch = 58) {
  const duration = 0.72;
  addLoopEvent(target, start, duration, (time, frame) => {
    const frequency = pitch * (1 + 0.34 * Math.exp(-time * 18));
    const body = Math.sin(TAU * frequency * time) * Math.exp(-time * 7.2);
    const skin = deterministicNoise(frame, 31 + Math.round(start * 7)) * Math.exp(-time * 28);
    return amplitude * (body + skin * 0.28) * fadeOut(time, duration, 0.03);
  });
}

function addWood(target, start, amplitude = 0.065) {
  addLoopEvent(target, start, 0.16, (time, frame) => (
    amplitude * Math.exp(-time * 34)
      * (Math.sin(TAU * 710 * time) + deterministicNoise(frame, 73) * 0.24)
      * fadeOut(time, 0.16, 0.02)
  ));
}

function renderMusicLoops() {
  const stems = {
    clay: new Float32Array(LOOP_FRAMES),
    bronze: new Float32Array(LOOP_FRAMES),
    breath: new Float32Array(LOOP_FRAMES),
    ritual: new Float32Array(LOOP_FRAMES),
  };
  const scale = [73.42, 87.31, 98, 110, 130.81];
  const phrases = [
    { clay: [0, 2, 1, 3, 2, 4, 1], bronze: [[6, 2], [14, 3]], breath: [[10, 3.6, 2]], notes: [0, 1, 2, 0, 3, 2, 1] },
    { clay: [2, 4, 3, 1, 4, 2, 0], bronze: [[1, 4], [7, 3], [13, 2]], breath: [[4, 4.2, 3]], notes: [2, 3, 4, 2, 1, 3, 0] },
    { clay: [1, 3, 0, 2, 4, 1, 2], bronze: [[12, 1]], breath: [[1, 5.5, 4], [9, 4.8, 2]], notes: [1, 2, 0, 1, 3, 4, 2] },
    { clay: [0, 2, 4, 3, 1, 2, 0], bronze: [[4, 0], [10, 2], [15, 0]], breath: [[6, 3.8, 1]], notes: [0, 1, 3, 2, 0, 1, 0] },
  ];
  const beatPositions = [0, 2, 4, 7, 9, 12, 14];

  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
    const phraseStart = phraseIndex * 16;
    const phrase = phrases[phraseIndex];
    for (let index = 0; index < beatPositions.length; index += 1) {
      const start = phraseStart + beatPositions[index];
      const frequency = scale[phrase.notes[index]];
      addClay(stems.clay, start, frequency, phraseIndex === 2 ? 0.11 : 0.145, 1.2 + (index % 3) * 0.16);
    }
    for (const [beat, note] of phrase.bronze) {
      addBronze(stems.bronze, phraseStart + beat, scale[note] * 2, phraseIndex === 1 ? 0.078 : 0.055, 1.5);
    }
    for (const [beat, duration, note] of phrase.breath) {
      addBreathTone(stems.breath, phraseStart + beat, duration, scale[note] * 2, 0.047, phraseIndex * 17 + note);
    }
    addDrum(stems.ritual, phraseStart, phraseIndex === 3 ? 0.17 : 0.135, phraseIndex === 3 ? 52 : 58);
    addDrum(stems.ritual, phraseStart + 8, 0.095, 62);
    addWood(stems.ritual, phraseStart + 4);
    addWood(stems.ritual, phraseStart + 12, 0.05);
  }

  return stems;
}

function expandLoop(loop) {
  const output = new Float32Array(TOTAL_FRAMES);
  const loopStartFrame = LOOP_START_SECONDS * SAMPLE_RATE;
  for (let frame = 0; frame < output.length; frame += 1) {
    output[frame] = loop[loopIndex(frame - loopStartFrame)];
  }
  return output;
}

function delayed(loop, frame, delayFrames) {
  return loop[loopIndex(frame - delayFrames)];
}

function renderStereoMaster(stems) {
  const left = new Float32Array(TOTAL_FRAMES);
  const right = new Float32Array(TOTAL_FRAMES);
  const loopStartFrame = LOOP_START_SECONDS * SAMPLE_RATE;
  for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
    const phase = loopIndex(frame - loopStartFrame);
    const clay = stems.clay[phase];
    const bronze = stems.bronze[phase];
    const breath = stems.breath[phase];
    const ritual = stems.ritual[phase];
    left[frame] = Math.tanh((clay * 0.88 + delayed(stems.clay, phase, 19) * 0.12
      + bronze * 0.78 + delayed(stems.bronze, phase, 43) * 0.2
      + breath * 0.7 + delayed(stems.breath, phase, 97) * 0.28
      + ritual * 0.92) * 0.84);
    right[frame] = Math.tanh((clay * 0.76 + delayed(stems.clay, phase, 31) * 0.22
      + bronze * 0.9 + delayed(stems.bronze, phase, 17) * 0.1
      + breath * 0.82 + delayed(stems.breath, phase, 137) * 0.2
      + ritual * 0.92) * 0.84);
  }
  return [left, right];
}

function normalizePeak(samples, targetPeak) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? targetPeak / peak : 1;
  for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
  return samples;
}

function addCueResonator(target, start, duration, frequency, amplitude, ratios, decay) {
  const startFrame = Math.round(start * SAMPLE_RATE);
  const frames = Math.min(target.length - startFrame, Math.round(duration * SAMPLE_RATE));
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const envelope = strikeEnvelope(time, 0.0025, decay) * fadeOut(time, duration, 0.04);
    const value = ratios.reduce((sum, ratio, index) => (
      sum + Math.sin(TAU * frequency * ratio * time + index * 0.52) / (1 + index * 0.8)
    ), 0);
    target[startFrame + frame] += amplitude * envelope * value;
  }
}

function renderCue(id) {
  const duration = id === "capture" ? 0.42 : id === "check" ? 0.78 : 2.24;
  const output = new Float32Array(Math.round(duration * SAMPLE_RATE));
  if (id === "capture") {
    addCueResonator(output, 0, 0.4, 92, 0.48, [1, 2.21, 3.14], 0.095);
    for (let frame = 0; frame < Math.round(0.12 * SAMPLE_RATE); frame += 1) {
      const time = frame / SAMPLE_RATE;
      output[frame] += deterministicNoise(frame, 211) * 0.18 * Math.exp(-time * 38);
    }
  } else if (id === "check") {
    addCueResonator(output, 0, 0.72, 392, 0.25, [1, 2.67, 4.11], 0.2);
    addCueResonator(output, 0.18, 0.55, 523.25, 0.19, [1, 2.72, 4.03], 0.18);
  } else {
    const notes = id === "victory"
      ? [146.83, 174.61, 220, 261.63]
      : id === "defeat"
        ? [220, 196, 146.83, 110]
        : [146.83, 196, 174.61, 146.83];
    const starts = [0, 0.42, 0.86, 1.34];
    for (let index = 0; index < notes.length; index += 1) {
      addCueResonator(output, starts[index], 0.82, notes[index], 0.15, [1, 2.18, 3.08], 0.3);
    }
    if (id === "victory") addCueResonator(output, 1.2, 0.98, 392, 0.095, [1, 2.67, 4.12], 0.42);
    if (id === "defeat") addCueResonator(output, 1.28, 0.9, 73.42, 0.13, [1, 2.06, 3.17], 0.38);
    if (id === "draw") addCueResonator(output, 1.24, 0.92, 164.81, 0.1, [1, 2.31, 3.01], 0.36);
  }
  const fadeFrames = Math.round(0.035 * SAMPLE_RATE);
  for (let index = 0; index < fadeFrames; index += 1) {
    output[output.length - 1 - index] *= index / fadeFrames;
  }
  return normalizePeak(output, id === "capture" ? 0.58 : 0.5);
}

function measureLoudness(path) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", path,
    "-filter_complex", "ebur128=peak=true",
    "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const integratedMatches = [...output.matchAll(/I:\s*(-?\d+(?:\.\d+)?) LUFS/g)];
  const peakMatches = [...output.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?) dBFS/g)];
  if (integratedMatches.length === 0 || peakMatches.length === 0) {
    throw new Error(`Could not measure EBU R128 loudness for ${path}`);
  }
  return {
    integratedLufs: Number(integratedMatches.at(-1)[1]),
    truePeakDb: Number(peakMatches.at(-1)[1]),
  };
}

function render() {
  const temporaryDir = mkdtempSync(resolve(tmpdir(), "qin-audio-render-"));
  try {
    const stems = renderMusicLoops();
    const expandedStems = Object.fromEntries(Object.entries(stems).map(([name, loop]) => [name, expandLoop(loop)]));
    for (const [name, samples] of Object.entries(expandedStems)) {
      encodeFlac([samples], resolve(EXPORT_DIR, `qin-procession-v1-${name}.flac`));
    }

    const premasterPath = resolve(temporaryDir, "qin-procession-v1-premaster.flac");
    encodeFlac(renderStereoMaster(stems), premasterPath);
    const initial = measureLoudness(premasterPath);
    const gainDb = Math.min(-18 - initial.integratedLufs, -1 - initial.truePeakDb);
    const masterPath = resolve(EXPORT_DIR, "qin-procession-v1-master.flac");
    runFfmpeg([
      "-i", premasterPath,
      "-map_metadata", "-1",
      "-af", `volume=${gainDb.toFixed(3)}dB`,
      "-ar", String(SAMPLE_RATE),
      "-ac", "2",
      "-c:a", "flac",
      "-compression_level", "8",
      masterPath,
    ]);

    runFfmpeg([
      "-i", masterPath,
      "-map_metadata", "-1",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-ar", String(SAMPLE_RATE),
      "-ac", "2",
      "-id3v2_version", "3",
      "-metadata", "title=Terracotta Procession",
      "-metadata", "artist=Chinese Chess 3D project",
      "-metadata", "comment=Qin-inspired visual fantasy; not historical reconstruction",
      resolve(RUNTIME_DIR, "qin-procession-v1.mp3"),
    ]);

    const cueFiles = {
      capture: "capture-clay-v1",
      check: "check-bronze-v1",
      victory: "result-victory-v1",
      defeat: "result-defeat-v1",
      draw: "result-draw-v1",
    };
    for (const [cue, filename] of Object.entries(cueFiles)) {
      const samples = renderCue(cue);
      encodeFlac([samples], resolve(EXPORT_DIR, `${filename}-master.flac`));
      writePcm16Wav(samples, resolve(RUNTIME_DIR, `${filename}.wav`));
    }

    const finalMeasurement = measureLoudness(masterPath);
    const report = {
      schema: "xiangqi-audio-render-report/v1",
      renderer: "render-qin-audio.mjs",
      sessionSha256: createHash("sha256").update(readFileSync(resolve(SOURCE_DIR, "session.json"))).digest("hex"),
      sampleRate: SAMPLE_RATE,
      durationSeconds: DURATION_SECONDS,
      loop: { startSeconds: LOOP_START_SECONDS, endSeconds: LOOP_START_SECONDS + LOOP_SECONDS },
      measuredMaster: finalMeasurement,
      appliedStaticGainDb: Number(gainDb.toFixed(3)),
      note: "Automated meter evidence only; human listening approval remains required.",
    };
    writeFileSync(resolve(SOURCE_DIR, "render-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    rmSync(temporaryDir, { force: true, recursive: true });
  }
}

render();
