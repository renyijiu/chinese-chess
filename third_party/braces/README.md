# Temporary patched braces dependency

This private, development-only fork replaces the registry `braces@3.0.3` while
GHSA-vfj7-8cjw-p6xm has no fixed upstream release. It is not an official release.

## Provenance

- Original package: https://github.com/micromatch/braces/tree/3.0.3
- Proposed fix: https://github.com/micromatch/braces/pull/78 (unmerged when vendored)
- Source: https://github.com/thaibaole89/braces/tree/97308a01d091b211cf015314a2d0696da28a5392
- Source commit: `97308a01d091b211cf015314a2d0696da28a5392`
- Upstream base: `e53730e6f935498326c72d768889ac194eedc0e0`
- Source archive SHA-256: `bd4fe71b43aaea9bab6cf847d013ca3139f82974bfe0597a3a1b4e7a76a61f41`
- License: MIT; the original copyright and license are preserved in `LICENSE`.

`index.js`, `lib/*.js` and `LICENSE` are byte-for-byte copies from that source
commit. Compared with the npm 3.0.3 runtime, only the six `lib` files change:
they bound parser container nesting and recursive compile/expand/stringify
traversal at 100, including caller-supplied ASTs. Excessive depth throws a
controlled `SyntaxError` instead of exhausting the engine stack. The patch does
not claim to bound expansion cardinality or arbitrary malformed AST fields.

Only package metadata is local: the private name/version makes the fork explicit,
CommonJS mode preserves the original module format, and the unchanged
`fill-range` dependency remains in the normal npm lockfile and audit.
No upstream development dependencies or install scripts are included.

## Installation and security checks

The root development dependency uses `file:third_party/braces`; the `$braces`
override makes both `micromatch` callers (model tooling and the Vinext build
chain) resolve this copy. Keeping the direct dependency is necessary for npm
to resolve the local path and install its dependencies correctly.

`npm audit --audit-level=high` remains unchanged. npm does not vulnerability-scan
local linked source as a registry release, so a clean audit alone is not evidence
that this fork is safe. CI also runs `npm run test:dependencies`: reduced-stack
regressions exercise deep strings and direct ASTs, while compatibility assertions
cover the brace expansion and texture-slot patterns used by the build tools.
The installed dependency and the production build must both pass.

Do not replace this with unpatched 3.0.3 or relabel it as an official safe version.
When a reviewed upstream release fixes the advisory, remove the direct local
dependency, its override and this directory; update the lockfile and rerun the
dependency regressions, model tooling, static checks, build and browser smoke.
Keep the regression tests with the registry replacement.
