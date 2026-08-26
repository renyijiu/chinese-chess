# Audio source and rights record

The application ships no third-party recordings or sampled music.

- The optional Qin-diorama v1 authored pack is original project work. Its
  executable score, lossless masters/stems, optimized runtime files, rights
  record, and Qin-inspired claim boundary are reviewed in
  `assets/audio/qin-diorama/v1/SOURCES.md`.
- Synthesized fallback music, fortress wind/fire ambience, UI cues, movement,
  attacks, impacts, fractures, check, and result cues are generated at runtime
  by `components/xiangqi/audio/AudioEngine.ts` from original oscillator,
  envelope, seeded-noise, and pentatonic-sequence parameters written for this
  project.
- No downloaded AudioBuffer, loop, impulse response, sound font, third-party
  sample, or voice model is embedded in the repository.
- Optional short Mandarin character lines use the browser/operating system's
  `SpeechSynthesis` service. Availability and installed voice rights remain with
  the user's platform; if unavailable, voice playback silently degrades without
  affecting the game.

This keeps the project's audio layer free of external sample-license
obligations. Runtime synthesis remains editable TypeScript; the authored pack
retains its editable score and lossless sources in the repository.
