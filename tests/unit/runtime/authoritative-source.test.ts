import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { assertLockedBytes } from "../../../scripts/assets/authoritative-source-lock.mjs";

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("authoritative asset source verification", () => {
  it("accepts bytes that match the locked digest", () => {
    const glb = Buffer.from("glTF-authoritative");
    const entry = { path: "fixture.glb", sha256: digest(glb) };

    expect(assertLockedBytes(glb, entry, "fixture GLB")).toBe(digest(glb));
  });

  it("rejects a same-path source whose bytes changed", () => {
    const original = Buffer.from("glTF-authoritative");
    const changed = Buffer.from("glTF-authoritativf");

    expect(() => assertLockedBytes(
      changed,
      { path: "fixture.glb", sha256: digest(original) },
      "fixture GLB",
    )).toThrow("digest drift");
  });

  it("rejects an unhydrated Git LFS pointer", () => {
    const pointer = Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n");

    expect(() => assertLockedBytes(
      pointer,
      { path: "fixture.blend", sha256: digest(pointer) },
      "fixture BLEND",
    ))
      .toThrow("unhydrated Git LFS pointer");
  });
});
