"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";

import { PerformanceMetrics, type RuntimePerformanceSnapshot } from "./performance-metrics";

declare global {
  interface Window {
    __XIANGQI_PERFORMANCE__?: RuntimePerformanceSnapshot;
    __XIANGQI_RESET_PERFORMANCE__?: () => void;
  }
}

export function PerformanceSummary({
  drawCallsRef,
}: {
  drawCallsRef: RefObject<HTMLSpanElement | null>;
}) {
  const lastUpdate = useRef(0);
  const lastRendererTotals = useRef({ drawCalls: 0, triangles: 0 });
  const metrics = useRef(new PerformanceMetrics());
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const activeMetrics = metrics.current;
    const publishEmptySnapshot = () => {
      activeMetrics.reset();
      gl.info.reset();
      lastRendererTotals.current = { drawCalls: 0, triangles: 0 };
      window.__XIANGQI_PERFORMANCE__ = activeMetrics.snapshot();
    };
    window.__XIANGQI_RESET_PERFORMANCE__ = publishEmptySnapshot;
    publishEmptySnapshot();
    return () => {
      if (window.__XIANGQI_RESET_PERFORMANCE__ === publishEmptySnapshot) {
        delete window.__XIANGQI_RESET_PERFORMANCE__;
        delete window.__XIANGQI_PERFORMANCE__;
      }
    };
  }, [gl]);

  useFrame(({ clock, gl: frameGl }, deltaSeconds) => {
    const drawCalls = Math.max(0, frameGl.info.render.calls - lastRendererTotals.current.drawCalls);
    const triangles = Math.max(0, frameGl.info.render.triangles - lastRendererTotals.current.triangles);
    lastRendererTotals.current = {
      drawCalls: frameGl.info.render.calls,
      triangles: frameGl.info.render.triangles,
    };
    metrics.current.record({
      drawCalls,
      frameIntervalMs: deltaSeconds * 1_000,
      geometries: frameGl.info.memory.geometries,
      textures: frameGl.info.memory.textures,
      triangles,
    });
    if (clock.elapsedTime - lastUpdate.current < 0.5) return;
    lastUpdate.current = clock.elapsedTime;
    const snapshot = metrics.current.snapshot();
    window.__XIANGQI_PERFORMANCE__ = snapshot;
    const output = drawCallsRef.current;
    if (output) {
      output.dataset.drawCalls = String(snapshot.currentDrawCalls);
      output.dataset.geometries = String(snapshot.geometries);
      output.dataset.p95FrameIntervalMs = snapshot.p95FrameIntervalMs.toFixed(2);
      output.dataset.peakDrawCalls = String(snapshot.peakDrawCalls);
      output.dataset.textures = String(snapshot.textures);
      output.dataset.triangles = String(snapshot.currentTriangles);
      output.textContent = `${snapshot.currentDrawCalls.toLocaleString("zh-CN")} 绘制调用 · p95 ${snapshot.p95FrameIntervalMs.toFixed(1)}ms`;
    }
  });

  return null;
}
