# Qin Diorama Audio QA

> Historical snapshot: this document records the audio QA state at the time it
> was captured. The root Worker HTTP 500 described below was fixed afterward;
> current release evidence and remaining blockers live in [`../validation.md`](../validation.md).

Status date: 2026-08-26 (Asia/Singapore)

This pack is Qin-inspired visual fantasy. It is not a historical reconstruction and makes no claim of acoustic authenticity. Automated browser playback proves delivery and lifecycle behavior only; it does not prove audible quality from the browser automation audio output.

## Automated evidence

| Gate                                                               | Result                                               | Evidence                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static media, hashes, codec metadata, sources, rights, and budgets | Pass                                                 | `npm run assets:audio:validate`; 6 media assets plus manifest; critical 1,161,024 bytes; complete delayed pack 1,921,564 bytes.                                                                                                                                                                            |
| Authored decoded memory                                            | Pass                                                 | 29,168,640 bytes (27.82 MiB), below 30 MiB. Browser engine snapshot also stayed below the 40 MiB engine-owned decoded limit.                                                                                                                                                                               |
| Unit presentation/audio behavior                                   | Pass                                                 | `npm run test:presentation`: 58 tests passed, including fallback, settlement, deduplication, visibility, disposal, and 100-cycle coverage.                                                                                                                                                                 |
| Type and lint checks                                               | Pass                                                 | `npm run typecheck` and targeted ESLint on U4 files.                                                                                                                                                                                                                                                       |
| Production build                                                   | Pass                                                 | `npm run build` with vinext 1.0.0-beta.2.                                                                                                                                                                                                                                                                  |
| Chromium real MP3/WAV decode and start                             | Pass                                                 | `npm run test:e2e -- tests/e2e/audio.spec.ts --project desktop-chromium`: 3/3 on Google Chrome for Testing 151.0.7922.34 through Playwright 1.62.1.                                                                                                                                                        |
| Desktop browser decode matrix                                      | Pass                                                 | `npm run test:audio:browsers`: 9/9 across Chromium, Firefox 153.0 (Playwright 1538), and WebKit 26.5 (Playwright 2336). The run also exposed and verified a cross-browser keyboard-focus race fix.                                                                                                         |
| Failure isolation                                                  | Pass                                                 | Focused `tests/e2e/resilience.spec.ts`: 5/5 for network abort, HTTP 503, corrupt real decode, authored source-start failure, and held-decode disposal; every case allowed legal red and black turns.                                                                                                       |
| Complete desktop Chromium regression                               | Pass with isolated rerun                             | One full run completed with 21 passed and 1 performance-only scenario skipped. A later five-minute rerun completed 20 tests but one WebGL-recovery case observed an AudioContext startup lock; the current audio/resilience suite was then rerun in isolation and passed 14/14, including that WebGL case. |
| Cold-cache request order and concurrency                           | Pass in development server                           | No request before Start; manifest plus six media URLs requested once in manifest order; peak fetch 1 and peak decode 1.                                                                                                                                                                                    |
| MIME and disk/response reconciliation                              | Pass in development and Cloudflare production assets | Both targets matched all seven disk byte counts and returned `application/json`, `audio/mpeg`, or `audio/wav`. The production performance suite is configured to use the generated Cloudflare Worker and static-asset configuration.                                                                       |
| Cloudflare production performance scenario                         | Blocked by root SSR status                           | The generated Worker serves `/` with HTTP 500 under local `wrangler dev`, even though browser hydration recovers and renders the game. Playwright therefore times out its production-server readiness gate before measurement. This is separate from audio delivery; see below.                            |
| First-playable transfer                                            | Pass                                                 | `npm run test:budget`: character/environment first playable is 2,115,460 bytes (2.02 MiB); authored audio starts only after the gesture and is accounted separately.                                                                                                                                       |

The successful cold-cache package is exactly:

| URL                                           |     Bytes | Expected MIME      |
| --------------------------------------------- | --------: | ------------------ |
| `/audio/qin-diorama/v1/manifest.json`         |     8,064 | `application/json` |
| `/audio/qin-diorama/v1/qin-procession-v1.mp3` | 1,152,960 | `audio/mpeg`       |
| `/audio/qin-diorama/v1/capture-clay-v1.wav`   |    40,364 | `audio/wav`        |
| `/audio/qin-diorama/v1/check-bronze-v1.wav`   |    74,924 | `audio/wav`        |
| `/audio/qin-diorama/v1/result-victory-v1.wav` |   215,084 | `audio/wav`        |
| `/audio/qin-diorama/v1/result-defeat-v1.wav`  |   215,084 | `audio/wav`        |
| `/audio/qin-diorama/v1/result-draw-v1.wav`    |   215,084 | `audio/wav`        |

Failure traffic is attached separately by `tests/e2e/resilience.spec.ts`; failed, aborted, or injected corrupt responses are not counted as successful package bytes. Tests assert no attempted URL is retried in the same engine session.

## Browser and device matrix

| Platform                                | Cache / output                                              | Automated decode and source start                                                         | Audible review                 | Status                                                                                  |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| macOS, Chrome for Testing 151.0.7922.34 | Cold development-server cache, Playwright headless          | Pass: MP3 and all five WAVs decoded; authored music plus five authored transients started | Not evaluated (`--mute-audio`) | Automated pass only                                                                     |
| macOS, Firefox 153.0 / Playwright 1538  | Cold development-server cache, Playwright headless          | Pass: 3/3, including MP3 and all five WAVs, lifecycle, and two-match capture delivery     | Not evaluated                  | Automated pass only                                                                     |
| macOS, WebKit 26.5 / Playwright 2336    | Cold development-server cache, Playwright headless          | Pass: 3/3, including MP3 and all five WAVs, lifecycle, and two-match capture delivery     | Not evaluated                  | Automated pass only; Playwright WebKit is not a substitute for desktop Safari listening |
| Desktop Safari                          | Cold and warm cache required                                | Not run                                                                                   | Not run                        | Release gate pending                                                                    |
| Real modern iOS Safari                  | Cold and warm cache; speaker and background return required | Not run                                                                                   | Not run                        | Release gate pending                                                                    |

Run the installed desktop matrix with `npm run test:audio:browsers`. On this host the command passed all three projects, 9/9 total. The optional browser runtimes were installed with `npx playwright install firefox webkit`.

## Production-target MIME evidence

The deployed application target is the generated Cloudflare Worker and static asset configuration at `dist/server/wrangler.json`. A cold local `wrangler dev` run returned the manifest as `application/json`, the MP3 as `audio/mpeg`, and every WAV as `audio/wav`, with response lengths equal to the static files. `playwright.performance.config.ts` launches this same generated target for `npm run test:performance`.

That same generated Worker currently returns HTTP 500 for `/` in local `wrangler dev`. Debug-level Wrangler and its attached Worker inspector emitted no console exception or `Runtime.exceptionThrown` event; the response is Vinext's `__next_error__` shell with no error digest. Chromium subsequently hydrates and renders the full game without a page exception, but an error status is not an acceptable production readiness signal. The strict performance command therefore remains red at Playwright's 120-second web-server readiness gate. Closing this independent Vinext/Cloudflare SSR issue and rerunning `npm run test:performance` remains required; the test is intentionally not pointed at a static health asset to conceal the 500.

The generic `vinext start` Node adapter in vinext 1.0.0-beta.2 is not the deployment target and currently serves `.mp3` and `.wav` public files as `application/octet-stream`; its internal static MIME table does not contain either extension. The runtime correctly rejects that optional authored pack and keeps gameplay running with synthesized fallback. This remains a local-adapter limitation, not a Cloudflare release blocker.

The official `vinext@1.0.0-beta.7` tarball was inspected in `/tmp` without installing it. Beta.7 adds `.mp3` as `audio/mpeg` but still has no `.wav` mapping, so upgrading from beta.2 to beta.7 would not close the atomic-pack gate and was not applied.

Do not use `vinext start` as evidence for Cloudflare delivery and do not loosen runtime MIME validation. Any future deployment target must independently return the manifest-declared types, return a successful root status, and pass the same production performance suite.

## Human listening checklist

No row below has been performed in this automated session. Record reviewer, browser/device, cold or warm cache, output path, timestamp, and notes before changing a row to Pass.

| Check                                                                                                                         | Headphones | Phone speaker | Required duration / fixture                                      | Status  |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | ---------------------------------------------------------------- | ------- |
| Clay, bronze, breath, or miniature-procession identity is recognizable without sounding like a generic cinematic battle theme | Required   | Required      | 15-minute continuous match                                       | Pending |
| No audible loop click, discontinuity, or eight-second-style mechanical repetition                                             | Required   | Required      | 15-minute continuous match, including the authored loop boundary | Pending |
| Move, role impact, and speech remain legible under music                                                                      | Required   | Required      | Capture-heavy fixture                                            | Pending |
| Capture accent is distinct but does not mask role impact                                                                      | Required   | Required      | At least 20 varied captures                                      | Pending |
| Capture plus check yields two intelligible, ordered cues                                                                      | Required   | Required      | Capture-check fixture                                            | Pending |
| Victory, defeat, and draw are distinguishable at default levels                                                               | Required   | Required      | All three terminal outcomes                                      | Pending |
| Mute/unmute produces no catch-up; background/foreground produces no duplicate loop                                            | Required   | Required      | Desktop Safari and real iOS Safari                               | Pending |
| Fifteen-minute fatigue and balance review accepted                                                                            | Required   | Required      | Separate signed session                                          | Pending |

## Cleanup boundary

The automated lifecycle checks assert only engine-owned facts: pending fetch/decode counts return to zero, listeners detach, stale generations cannot start sources, source/buffer maps clear on disposal, and counts remain stable across two match epochs. They do not claim browser garbage collection, native decoder-memory release, or audible quality.
