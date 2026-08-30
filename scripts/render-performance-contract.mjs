export const RENDER_PERFORMANCE_GATES = Object.freeze({
  currentDrawCalls: 100,
  firstPlayableBytes: 12 * 1024 * 1024,
  minimumSampleCount: 180,
  p95FrameIntervalMs: 16.7,
  peakDrawCalls: 160,
  canvasDpr: 1.5,
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function findNonTargetGateFailures(evidence) {
  const failures = [];
  const checks = [
    ["sampleCount", evidence.sampleCount, ">=", RENDER_PERFORMANCE_GATES.minimumSampleCount],
    ["peakDrawCalls", evidence.peakDrawCalls, "<=", RENDER_PERFORMANCE_GATES.peakDrawCalls],
    ["currentDrawCalls", evidence.currentDrawCalls, "<=", RENDER_PERFORMANCE_GATES.currentDrawCalls],
    ["canvasDpr", evidence.canvasDpr, "<=", RENDER_PERFORMANCE_GATES.canvasDpr],
    ["firstPlayableBytes", evidence.firstPlayableBytes, "<=", RENDER_PERFORMANCE_GATES.firstPlayableBytes],
  ];

  if (evidence.authoritativeFrameGate !== true) {
    failures.push("authoritativeFrameGate must be true");
  }

  for (const [name, value, comparison, limit] of checks) {
    if (!isFiniteNumber(value)) {
      failures.push(`${name} must be a finite number`);
      continue;
    }
    if (comparison === ">=" ? value < limit : value > limit) {
      failures.push(`${name} must be ${comparison} ${limit} (received ${value})`);
    }
  }

  return failures;
}

export function assertPerformanceProbeOutcome(evidence, exitStatus) {
  const nonTargetFailures = findNonTargetGateFailures(evidence);
  if (nonTargetFailures.length > 0) {
    throw new Error(`Performance evidence failed non-target gates: ${nonTargetFailures.join("; ")}.`);
  }

  if (!isFiniteNumber(evidence.p95FrameIntervalMs)) {
    throw new Error("Performance evidence p95FrameIntervalMs must be a finite number.");
  }

  if (exitStatus !== 0) {
    throw new Error(`Performance command failed (exit ${exitStatus ?? "unknown"}).`);
  }
}
