import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPerformanceProbeOutcome,
  findNonTargetGateFailures,
  RENDER_PERFORMANCE_GATES,
} from "../../../scripts/render-performance-contract.mjs";

function validEvidence() {
  return {
    authoritativeFrameGate: true,
    canvasDpr: RENDER_PERFORMANCE_GATES.canvasDpr,
    currentDrawCalls: RENDER_PERFORMANCE_GATES.currentDrawCalls,
    firstPlayableBytes: RENDER_PERFORMANCE_GATES.firstPlayableBytes,
    p95FrameIntervalMs: RENDER_PERFORMANCE_GATES.p95FrameIntervalMs,
    peakDrawCalls: RENDER_PERFORMANCE_GATES.peakDrawCalls,
    sampleCount: RENDER_PERFORMANCE_GATES.minimumSampleCount,
  };
}

describe("render performance probe contract", () => {
  it("runs the headed performance lifecycle without suppressing its prebuild", () => {
    const source = readFileSync(resolve("scripts/measure-render-performance.mjs"), "utf8");

    expect(source).toContain('"test:performance:headed"');
    expect(source).toContain('RENDER_P95_EVIDENCE_ONLY: "1"');
    expect(source).not.toContain("--ignore-scripts");
  });

  it("accepts a successful probe when every gate passes", () => {
    expect(() => assertPerformanceProbeOutcome(validEvidence(), 0)).not.toThrow();
  });

  it("records a failed p95 target when the evidence-only probe exits cleanly", () => {
    const evidence = {
      ...validEvidence(),
      p95FrameIntervalMs: RENDER_PERFORMANCE_GATES.p95FrameIntervalMs + 0.1,
    };

    expect(() => assertPerformanceProbeOutcome(evidence, 0)).not.toThrow();
  });

  it.each([
    ["authoritativeFrameGate", false],
    ["sampleCount", RENDER_PERFORMANCE_GATES.minimumSampleCount - 1],
    ["peakDrawCalls", RENDER_PERFORMANCE_GATES.peakDrawCalls + 1],
    ["currentDrawCalls", RENDER_PERFORMANCE_GATES.currentDrawCalls + 1],
    ["canvasDpr", RENDER_PERFORMANCE_GATES.canvasDpr + 0.1],
    ["firstPlayableBytes", RENDER_PERFORMANCE_GATES.firstPlayableBytes + 1],
  ] as const)("rejects a %s gate failure even when p95 also fails", (field, value) => {
    const evidence = {
      ...validEvidence(),
      [field]: value,
      p95FrameIntervalMs: RENDER_PERFORMANCE_GATES.p95FrameIntervalMs + 0.1,
    };

    expect(findNonTargetGateFailures(evidence)).not.toEqual([]);
    expect(() => assertPerformanceProbeOutcome(evidence, 0)).toThrow("failed non-target gates");
  });

  it.each([1, 2, 127, null])("rejects every nonzero or unknown command result (%s)", (status) => {
    expect(() => assertPerformanceProbeOutcome(validEvidence(), status))
      .toThrow("Performance command failed");
    expect(() => assertPerformanceProbeOutcome({
      ...validEvidence(),
      p95FrameIntervalMs: RENDER_PERFORMANCE_GATES.p95FrameIntervalMs + 0.1,
    }, status)).toThrow("Performance command failed");
  });
});
