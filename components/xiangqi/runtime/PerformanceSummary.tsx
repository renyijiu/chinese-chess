"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";

import { PerformanceMetrics, type RuntimePerformanceSnapshot } from "./performance-metrics";

declare global {
  interface Window {
    __XIANGQI_PERFORMANCE__?: RuntimePerformanceSnapshot;
    __XIANGQI_SETTLE_RENDERER__?: () => Promise<RuntimePerformanceSnapshot>;
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
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const activeMetrics = metrics.current;
    let active = true;
    const pendingFrames = new Set<() => void>();
    const publishEmptySnapshot = () => {
      if (!active) return;
      activeMetrics.reset();
      gl.info.reset();
      lastRendererTotals.current = { drawCalls: 0, triangles: 0 };
      window.__XIANGQI_PERFORMANCE__ = activeMetrics.snapshot();
    };
    const waitForRenderedFrame = () => new Promise<void>((resolve, reject) => {
      if (!active) {
        reject(new Error("Renderer diagnostic was disposed."));
        return;
      }
      let firstFrame = 0;
      let secondFrame = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        pendingFrames.delete(cancel);
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
        finish(new Error("Renderer diagnostic was disposed."));
      };
      pendingFrames.add(cancel);
      invalidate();
      firstFrame = window.requestAnimationFrame(() => {
        if (!active) {
          cancel();
          return;
        }
        secondFrame = window.requestAnimationFrame(() => {
          if (!active) cancel();
          else finish();
        });
      });
    });
    const settleRenderer = async () => {
      // PerformanceSummary samples gl.info before each draw. Two forced frames
      // ensure the second sample observes resources uploaded by the first.
      await waitForRenderedFrame();
      await waitForRenderedFrame();
      if (!active || window.__XIANGQI_SETTLE_RENDERER__ !== settleRenderer) {
        throw new Error("Renderer diagnostic was superseded.");
      }
      const snapshot = activeMetrics.snapshot();
      window.__XIANGQI_PERFORMANCE__ = snapshot;
      return snapshot;
    };
    window.__XIANGQI_RESET_PERFORMANCE__ = publishEmptySnapshot;
    window.__XIANGQI_SETTLE_RENDERER__ = settleRenderer;
    publishEmptySnapshot();
    return () => {
      active = false;
      for (const cancel of [...pendingFrames]) cancel();
      if (window.__XIANGQI_RESET_PERFORMANCE__ === publishEmptySnapshot) {
        delete window.__XIANGQI_RESET_PERFORMANCE__;
        delete window.__XIANGQI_PERFORMANCE__;
      }
      if (window.__XIANGQI_SETTLE_RENDERER__ === settleRenderer) delete window.__XIANGQI_SETTLE_RENDERER__;
    };
  }, [gl, invalidate]);

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
