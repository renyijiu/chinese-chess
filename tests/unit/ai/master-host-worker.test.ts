import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("project-authored classic Master host Worker", () => {
  it("boots only transferred verified bytes and writes the NNUE into Emscripten FS", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../../../public/workers/xiangqi-master-v1.worker.js"),
      "utf8",
    );
    expect(source).toContain("Project-authored GPL-3.0-only host");
    expect(source).toContain("importScripts(glueUrl)");
    expect(source).toContain("mainScriptUrlOrBlob: glueUrl");
    expect(source).toContain("engine.FS.writeFile(message.networkPath");
    expect(source).toContain("new Blob([bytes]");
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toContain("/engines/fairy-stockfish-nnue/");
  });
});
