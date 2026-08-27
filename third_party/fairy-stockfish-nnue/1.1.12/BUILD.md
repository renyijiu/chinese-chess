# Fairy-Stockfish WebAssembly 1.1.12 build provenance

This directory contains the exact npm payload and exact corresponding source
used by the versioned browser runtime. No local source patch is applied.

## Inputs

- `fairy-stockfish-nnue.wasm-1.1.12.tgz` is the npm release payload.
- `fairy-stockfish-wasm-b2e693e-source.tar.gz` is the complete upstream source
  archive at commit `b2e693ef1e111233ce3fb40685921708b3276ed6`.
- The separately versioned NNUE remains in the public runtime because the
  browser must fetch it; its provenance is recorded in `provenance.json`.

## Rebuild

The upstream source pins `emscripten/emsdk:2.0.26` and Node 16.5 in
`src/emscripten/docker-compose.yml`. From a clean extraction, use the upstream
build path:

```sh
tar -xzf fairy-stockfish-wasm-b2e693e-source.tar.gz
cd fairy-stockfish-fairy-stockfish.wasm-b2e693e/src/emscripten
DOCKER_USER="$(id -u):$(id -g)" docker compose run --rm emscripten \
  make -C .. emscripten_build ARCH=wasm embedded_nnue=no wasm_simd=yes \
  EM_COMMIT=b2e693ef 'EM_UPSTREAM=' EM_EMSCRIPTEN=2.0.26
```

The explicit `EM_*` command-line values reproduce the release metadata
embedded in the shipped WASM (`[commit: b2e693ef, upstream: , emscripten:
2.0.26]`) even though a source archive has no `.git` directory. The unaltered
release payload is retained here for byte-level comparison.

After building, compare `src/emscripten/public/stockfish.js`,
`stockfish.wasm`, and `stockfish.worker.js` with the hashes in the public
manifest. Run `npm run assets:ai:canary` against the shipped artifacts before
release.
