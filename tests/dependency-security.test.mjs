import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const bracesPath = require.resolve("braces");
const micromatchRequire = createRequire(require.resolve("micromatch"));
const consumerBracesPath = micromatchRequire.resolve("braces");

test("braces rejects deep strings and ASTs before exhausting the stack", () => {
  assert.equal(consumerBracesPath, bracesPath);
  execFileSync(
    process.execPath,
    [
      "--stack_size=512",
      "-e",
      `
        const assert = require('node:assert/strict');
        const braces = require(${JSON.stringify(consumerBracesPath)});
        const pattern = '{'.repeat(4000) + 'x' + '}'.repeat(4000);
        const boundedError = error => error instanceof SyntaxError && /depth/.test(error.message);
        for (const operation of ['compile', 'expand', 'stringify', 'parse']) {
          assert.throws(() => braces[operation](pattern), boundedError, operation);
        }
        assert.throws(() => braces(pattern), boundedError);
        assert.throws(() => braces.compile('('.repeat(4000) + 'x' + ')'.repeat(4000)), boundedError);
        for (const operation of ['compile', 'expand', 'stringify']) {
          let ast = { type: 'root', nodes: [] };
          for (let i = 0; i < 4000; i++) ast = { type: 'root', nodes: [ast] };
          assert.throws(() => braces[operation](ast), boundedError, operation + ' AST');
        }
      `,
    ],
    { timeout: 5_000, stdio: "pipe" },
  );
});

test("patched braces preserves build globs and model texture slot patterns", () => {
  const micromatch = require("micromatch");
  assert.deepEqual(micromatch.braceExpand("{app,components}/**/*.{ts,tsx}"), [
    "app/**/*.ts",
    "app/**/*.tsx",
    "components/**/*.ts",
    "components/**/*.tsx",
  ]);
  assert.deepEqual(micromatch.braceExpand("model-{1..3}.glb"), [
    "model-1.glb",
    "model-2.glb",
    "model-3.glb",
  ]);
  const slots = micromatch.makeRe("{normalTexture,occlusionTexture,metallicRoughnessTexture}");
  assert.equal(slots.test("normalTexture"), true);
  assert.equal(slots.test("baseColorTexture"), false);
});
