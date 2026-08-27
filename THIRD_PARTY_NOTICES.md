# Third-party notices

This project is distributed under `GPL-3.0-only`; see `LICENSE`.

## Fairy-Stockfish WebAssembly 1.1.12

- Component: `fairy-stockfish-nnue.wasm@1.1.12`
- Authors: Fabian Fichter and the Fairy-Stockfish contributors listed in
  `public/engines/fairy-stockfish-nnue/1.1.12/AUTHORS`
- Upstream: https://github.com/fairy-stockfish/fairy-stockfish.wasm
- Source commit: `b2e693ef1e111233ce3fb40685921708b3276ed6`
- License: GNU General Public License v3.0 (`GPL-3.0-only`)
- Runtime files: `stockfish.js`, `stockfish.wasm`, and
  `stockfish.worker.js`
- Runtime notices: `AUTHORS` and `Copying.txt`
- Exact npm package SHA-256:
  `4945517be0f7a9d4520b08acadfd736e82b15758935395eb828f8f949b485f41`
- Exact corresponding-source archive SHA-256:
  `1fc961fb5a6e6cc61bc4a489b12d58a03e503e9fb27352477562994b07041594`

The exact package, corresponding source, build recipe, and absence of local
patches are recorded under `third_party/fairy-stockfish-nnue/1.1.12/`.

## Xiangqi NNUE c07e94a5c7cb

- Runtime file: `xiangqi-c07e94a5c7cb.nnue`
- Network author: Pikafish developers (as recorded by the upstream network
  catalog)
- Upstream: https://github.com/fairy-stockfish/xiangqi-nnue
- Source/catalog commit: `5fbbb9e15fd882cec18a2a5c3d4bfa25dc07169b`
- License/redistribution terms: GNU General Public License v3.0
  (`GPL-3.0-only`), as declared by the upstream repository
- SHA-256:
  `c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11`

The weight file is data consumed through Fairy-Stockfish's `EvalFile` option;
it is not executable JavaScript. It remains independently identified so a
release audit can distinguish engine code from network data.

## Runtime inventory

The authoritative byte counts, content hashes, MIME types, local URLs, and
capability requirements for every distributed engine runtime file are in
`public/engines/fairy-stockfish-nnue/1.1.12/manifest.json`. The command
`npm run assets:ai:validate` verifies this notice against that inventory.
