import { spawnSync } from "node:child_process";

const result = spawnSync(
  "npx",
  [
    "playwright",
    "test",
    "tests/e2e/performance.spec.ts",
    "--config",
    "playwright.performance.config.ts",
    "--project",
    "desktop-chromium",
    "--headed",
    "--grep",
    "captures first-playable transfer size",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PLAYWRIGHT_MEASUREMENT_MODE:
        "Visible Chromium rendered-frame interval; not CPU time or GPU render duration",
      RUN_RENDER_PERFORMANCE: "1",
    },
    maxBuffer: 32 * 1024 * 1024,
  },
);

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const evidenceLines = combined
  .split(/\r?\n/u)
  .filter((line) => line.includes("PERFORMANCE_EVIDENCE "));
const evidenceLine = evidenceLines.at(-1);

if (!evidenceLine) {
  process.stderr.write(combined);
  throw new Error(`Performance evidence was not produced (exit ${result.status ?? "unknown"}).`);
}

const evidence = JSON.parse(evidenceLine.slice(evidenceLine.indexOf("PERFORMANCE_EVIDENCE ") + 21));
const metrics = {
  canvas_dpr: evidence.canvasDpr,
  current_draw_calls: evidence.currentDrawCalls,
  first_playable_bytes: evidence.firstPlayableBytes,
  frame_gate_executed: evidence.authoritativeFrameGate ? 1 : 0,
  geometries: evidence.geometries,
  max_frame_interval_ms: evidence.maximumFrameIntervalMs,
  p90_frame_interval_ms: evidence.p90FrameIntervalMs,
  p95_frame_interval_ms: evidence.p95FrameIntervalMs,
  peak_draw_calls: evidence.peakDrawCalls,
  raf_p95_ms: evidence.rafCadence?.p95 ?? null,
  sample_count: evidence.sampleCount,
  textures: evidence.textures,
  triangles: evidence.currentTriangles,
};

for (const [name, value] of Object.entries(metrics)) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Performance metric ${name} is missing or non-numeric.`);
  }
}

process.stdout.write(`${JSON.stringify(metrics)}\n`);
