# Deployment Guide

## Release status

The project is experimental and pre-release. Do not describe a deployment as a stable release until the open gates in [`validation.md`](validation.md) are closed or explicitly accepted by a maintainer.

## Build contract

Required tools are Git LFS, Node.js `>=22.13.0`, and npm:

```bash
git lfs pull
npm ci
npm run build
npm test
```

`prebuild` validates the vendored Master engine and scans tracked files for workstation-specific metadata. A build must fail when Git LFS objects are not hydrated.

For a local production smoke:

```bash
npm run build
npm run start:production -- --port 3000
```

Then run browser checks in a second shell with `PLAYWRIGHT_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEB_SERVER=1 npm run test:e2e:release`.

## Cloudflare Worker contract

Vinext builds the application and `worker/index.ts` is the Worker entry point. It must remain in front of the Master engine manifest, WASM, NNUE, host Worker, and hashed lightweight Worker paths so it can enforce:

- `Cross-Origin-Opener-Policy: same-origin`;
- `Cross-Origin-Embedder-Policy: require-corp`;
- `Cross-Origin-Resource-Policy: same-origin`;
- exact MIME types and `X-Content-Type-Options: nosniff`;
- immutable caching for versioned runtime bytes and revalidation for the manifest;
- non-HTML errors for missing engine assets.

The current game is client-only and needs no application database. `.openai/hosting.json` may opt into D1 or R2 bindings for the hosting environment; keep both disabled unless a feature actually uses them. No repository secret is required for local gameplay.

## Pre-deploy checklist

- Confirm `git lfs status` reports hydrated objects and `npm run assets:ai:validate` passes.
- Run the CI-equivalent type, lint, unit, runtime, budget, production-render and browser smoke checks.
- Confirm the deployed root returns 200 and Master assets return their manifest MIME types, not HTML fallback.
- Confirm `crossOriginIsolated === true` in deployed Chromium before testing Master.
- Review [`validation.md`](validation.md) for the current performance and mobile evidence.
- Keep the previous stable deployment available for rollback.

If Master fails after deployment, preserve the explicit Hard fallback. Do not hide failures by loosening hashes, MIME checks, COOP/COEP, or HTTP status codes.
