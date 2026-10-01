"use client";

import { addAfterEffect, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";

import { useHasScheduledFrames } from "./FrameScheduler";
import { PerformanceMetrics, type RuntimePerformanceSnapshot } from "./performance-metrics";

declare global {
  interface Window {
    __XIANGQI_PERFORMANCE__?: RuntimePerformanceSnapshot;
    __XIANGQI_RESET_PERFORMANCE__?: () => void;
    __XIANGQI_FLUSH_PERFORMANCE__?: () => RuntimePerformanceSnapshot;
  }
}

export function PerformanceSummary({
  drawCallsRef,
}: {
  drawCallsRef: RefObject<HTMLSpanElement | null>;
}) {
  const lastUpdate = useRef(-Infinity);
  const lastRendererTotals = useRef({ drawCalls: 0, triangles: 0 });
  const metrics = useRef(new PerformanceMetrics());
  const rendered = useRef(false);
  const previousFrame = useRef<number | null>(null);
  const continuous = useRef(false);
  const get = useThree((state) => state.get);
  const hasScheduledFrames = useHasScheduledFrames();

  useEffect(() => {
    const activeMetrics = metrics.current;
    const { gl } = get();
    const publish = () => {
      const snapshot = activeMetrics.snapshot();
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
      return snapshot;
    };
    const publishEmptySnapshot = () => {
      activeMetrics.reset();
      gl.info.reset();
      lastRendererTotals.current = { drawCalls: 0, triangles: 0 };
      continuous.current = false;
      rendered.current = false;
      previousFrame.current = null;
      lastUpdate.current = -Infinity;
      publish();
    };
    window.__XIANGQI_RESET_PERFORMANCE__ = publishEmptySnapshot;
    window.__XIANGQI_FLUSH_PERFORMANCE__ = publish;
    publishEmptySnapshot();
    const onVisibility = () => {
      continuous.current = false;
      previousFrame.current = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Measure after every pass has rendered, including the capture composer.
    const detach = addAfterEffect((timestamp) => {
      if (!rendered.current) return;
      const { internal, frameloop } = get();
      const totals = { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles };
      activeMetrics.record(
        {
          drawCalls: Math.max(0, totals.drawCalls - lastRendererTotals.current.drawCalls),
          frameIntervalMs: previousFrame.current === null ? 0 : timestamp - previousFrame.current,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          triangles: Math.max(0, totals.triangles - lastRendererTotals.current.triangles),
        },
        continuous.current && !document.hidden,
      );
      lastRendererTotals.current = totals;
      rendered.current = false;
      previousFrame.current = timestamp;
      // A pending frame proves the previous frame requested continuous work.
      // The next user input after demand-render sleep is not an animation stall.
      const wasContinuous = continuous.current;
      continuous.current =
        frameloop === "always" || internal.frames > 0 || Boolean(hasScheduledFrames?.());
      if (timestamp - lastUpdate.current >= 500 || (wasContinuous && !continuous.current)) {
        lastUpdate.current = timestamp;
        publish();
      }
    });
    return () => {
      detach();
      document.removeEventListener("visibilitychange", onVisibility);
      if (window.__XIANGQI_RESET_PERFORMANCE__ === publishEmptySnapshot) {
        delete window.__XIANGQI_RESET_PERFORMANCE__;
        delete window.__XIANGQI_PERFORMANCE__;
        delete window.__XIANGQI_FLUSH_PERFORMANCE__;
      }
    };
  }, [drawCallsRef, get, hasScheduledFrames]);

  useFrame(() => {
    rendered.current = true;
  });

  return null;
}
