"use client";

import { useThree } from "@react-three/fiber";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type ScheduledFrame = (elapsedSeconds: number, deltaSeconds: number) => void;
type ScheduledFrameErrorHandler = (error: unknown) => void;
export type ScheduledFrameRegistration = Readonly<{
  onError?: ScheduledFrameErrorHandler;
  task: ScheduledFrame;
}>;
type RegisterFrame = (
  task: ScheduledFrame,
  onError?: ScheduledFrameErrorHandler,
) => () => void;

const FrameSchedulerContext = createContext<RegisterFrame | null>(null);
const FRAME_INTERVAL_TOLERANCE_MS = 0.75;

export function isScheduledFrameDue(elapsedMs: number, ambientFps: number) {
  const minimumInterval = 1000 / Math.max(1, ambientFps);
  return elapsedMs + FRAME_INTERVAL_TOLERANCE_MS >= minimumInterval;
}

export function runScheduledFrameTasks(
  tasks: Set<ScheduledFrameRegistration>,
  elapsedSeconds: number,
  deltaSeconds: number,
) {
  for (const registration of tasks) {
    try {
      registration.task(elapsedSeconds, deltaSeconds);
    } catch (error) {
      tasks.delete(registration);
      try {
        registration.onError?.(error);
      } catch (reportingError) {
        console.warn("Unable to report an optional scheduled-frame failure", reportingError);
      }
    }
  }
}

export function FrameScheduler({
  ambientFps,
  children,
}: {
  ambientFps: number;
  children: ReactNode;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const tasks = useRef(new Set<ScheduledFrameRegistration>());
  const frameRequest = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const contextLost = useRef(false);
  const requestNextFrame = useRef<() => void>(() => undefined);

  const register = useCallback<RegisterFrame>(
    (task, onError) => {
      const registration: ScheduledFrameRegistration = onError
        ? { onError, task }
        : { task };
      tasks.current.add(registration);
      invalidate();
      requestNextFrame.current();
      return () => {
        tasks.current.delete(registration);
        if (tasks.current.size === 0 && frameRequest.current !== null) {
          window.cancelAnimationFrame(frameRequest.current);
          frameRequest.current = null;
        }
      };
    },
    [invalidate],
  );

  useEffect(() => {
    let stopped = false;

    const schedule = () => {
      if (stopped || contextLost.current || document.hidden || tasks.current.size === 0 || frameRequest.current !== null) return;
      frameRequest.current = window.requestAnimationFrame(tick);
    };

    const tick = (timestamp: number) => {
      frameRequest.current = null;
      if (stopped || contextLost.current) return;

      if (!document.hidden && isScheduledFrameDue(timestamp - lastFrame.current, ambientFps)) {
        const previous = lastFrame.current || timestamp;
        lastFrame.current = timestamp;
        const elapsedSeconds = timestamp / 1000;
        const deltaSeconds = Math.min((timestamp - previous) / 1000, 0.1);
        runScheduledFrameTasks(tasks.current, elapsedSeconds, deltaSeconds);
        invalidate();
      }
      schedule();
    };

    const restartAfterVisibilityChange = () => {
      lastFrame.current = 0;
      if (document.hidden && frameRequest.current !== null) {
        window.cancelAnimationFrame(frameRequest.current);
        frameRequest.current = null;
        return;
      }
      if (!document.hidden) {
        invalidate();
        schedule();
      }
    };

    const handleContextLost = () => {
      contextLost.current = true;
      if (frameRequest.current !== null) {
        window.cancelAnimationFrame(frameRequest.current);
        frameRequest.current = null;
      }
    };

    const handleContextRestored = () => {
      contextLost.current = false;
      lastFrame.current = 0;
      invalidate();
      schedule();
    };

    document.addEventListener("visibilitychange", restartAfterVisibilityChange);
    gl.domElement.addEventListener("webglcontextlost", handleContextLost);
    gl.domElement.addEventListener("webglcontextrestored", handleContextRestored);
    requestNextFrame.current = schedule;
    schedule();

    return () => {
      stopped = true;
      requestNextFrame.current = () => undefined;
      document.removeEventListener("visibilitychange", restartAfterVisibilityChange);
      gl.domElement.removeEventListener("webglcontextlost", handleContextLost);
      gl.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
      if (frameRequest.current !== null) window.cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
    };
  }, [ambientFps, gl, invalidate]);

  const value = useMemo(() => register, [register]);
  return <FrameSchedulerContext.Provider value={value}>{children}</FrameSchedulerContext.Provider>;
}

export function useScheduledFrame(
  task: ScheduledFrame,
  enabled = true,
  onError?: ScheduledFrameErrorHandler,
) {
  const register = useContext(FrameSchedulerContext);

  useEffect(() => {
    if (!enabled) return;
    if (!register) throw new Error("useScheduledFrame must be used within FrameScheduler");
    return register(task, onError);
  }, [enabled, onError, register, task]);
}
