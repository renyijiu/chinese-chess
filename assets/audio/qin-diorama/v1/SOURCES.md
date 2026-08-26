# Qin-diorama audio pack v1 — source and rights record

Claim boundary: this is a **Qin-inspired visual fantasy; not a historical
reconstruction or claim of acoustic authenticity**. The clay, bronze, breath,
and restrained ceremonial-percussion vocabulary is an original artistic match
for the game's terracotta diorama, not a statement about surviving Qin music.

## Authorship and authorization

All six runtime works were composed and synthesized for the Chinese Chess 3D
project. They contain no downloaded recordings, third-party samples, sound
fonts, impulse responses, speech, or generated voice models. The author grants
this repository permission to store, modify, build, and redistribute the source
and optimized outputs.

The executable score is `source/render-qin-audio.mjs`; the editable session and
four-phrase structure are recorded in `source/session.json`. Rendering is
deterministic and uses additive/resonant synthesis plus seeded noise. The
lossless master and stems live in `source/exports/`; runtime MP3/WAV files live
under `public/audio/qin-diorama/v1/`.

| Source record ID | Runtime work | Lossless/editable source |
| --- | --- | --- |
| `source.music.qin-procession` | `qin-procession-v1.mp3` | master FLAC, clay/bronze/breath/ritual FLAC stems, session JSON, renderer |
| `source.accent.capture-clay` | `capture-clay-v1.wav` | cue master FLAC, session JSON, renderer |
| `source.system.check` | `check-bronze-v1.wav` | cue master FLAC, session JSON, renderer |
| `source.system.victory` | `result-victory-v1.wav` | cue master FLAC, session JSON, renderer |
| `source.system.defeat` | `result-defeat-v1.wav` | cue master FLAC, session JSON, renderer |
| `source.system.draw` | `result-draw-v1.wav` | cue master FLAC, session JSON, renderer |

## Reproduction and review

Run `node assets/audio/qin-diorama/v1/source/render-qin-audio.mjs` with FFmpeg
available, then run `npm run assets:audio:validate`. The renderer records meter
results in `source/render-report.json`; those measurements do not replace the
separate human loop, mix, identity, and phone-speaker listening review.
