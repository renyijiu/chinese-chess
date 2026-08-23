export type AudioBus = "music" | "ambient" | "voice" | "sfx" | "ui";

export type AudioMix = Readonly<{
  ambient: number;
  master: number;
  music: number;
  sfx: number;
  ui: number;
  voice: number;
}>;

export const DEFAULT_AUDIO_MIX: AudioMix = Object.freeze({
  ambient: 0.55,
  master: 0.8,
  music: 0.42,
  sfx: 0.8,
  ui: 0.72,
  voice: 0.75,
});

export type AudioRole = "marshal" | "advisor" | "elephant" | "chariot" | "horse" | "cannon" | "soldier";
export type AudioCueId =
  | "music.fortress"
  | "ambient.fortress"
  | "ui.select"
  | "ui.invalid"
  | "ui.confirm"
  | "system.check"
  | "system.victory"
  | "system.defeat"
  | `${AudioRole}.${"move" | "release" | "impact" | "fracture"}`;
