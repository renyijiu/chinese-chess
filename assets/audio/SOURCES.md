# Audio source and rights record

The application ships no third-party recordings or sampled music.

- Music, fortress wind/fire ambience, UI cues, movement, attacks, impacts,
  fractures, check and result cues are synthesized at runtime by
  `components/xiangqi/audio/AudioEngine.ts` from original oscillator, envelope,
  seeded-noise and pentatonic-sequence parameters written for this project.
- No downloaded AudioBuffer, loop, impulse response, sound font or voice model is
  embedded in the repository.
- Optional short Mandarin character lines use the browser/operating system's
  `SpeechSynthesis` service. Availability and installed voice rights remain with
  the user's platform; if unavailable, voice playback silently degrades without
  affecting the game.

This makes the project's authored audio layer free of external sample-license
obligations. The parameter source remains editable TypeScript under the same
license as this repository.
