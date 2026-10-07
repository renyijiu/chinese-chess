"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useState } from "react";
import { WebGLRenderTarget } from "three";

export function PauseSceneRendering() {
  useFrame(() => undefined, 1);
  return null;
}

/** Compile before the first draw, without holding render targets or an idle frame loop. */
export function SceneWarmup({
  postprocessing,
  onReadyChange,
}: {
  postprocessing: boolean;
  onReadyChange: (ready: boolean) => void;
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const [preparedGeneration, setPreparedGeneration] = useState(-1);
  useFrame(() => undefined, preparedGeneration === generation ? 0 : 1);

  useEffect(() => {
    const restored = () => setGeneration((value) => value + 1);
    gl.domElement.addEventListener("webglcontextrestored", restored);
    return () => gl.domElement.removeEventListener("webglcontextrestored", restored);
  }, [gl]);

  useLayoutEffect(() => {
    onReadyChange(false);
    // Let the Canvas commit finish before submitting shaders and allocating
    // the target variant; drawing stays paused until preparation completes.
    let timer = setTimeout(() => {
      try {
        const context = gl.getContext();
        if (context.isContextLost()) return;
        gl.compile(scene, camera);
        if (postprocessing) {
          // Three's cache key includes both renderer and target color spaces. Use
          // an actual target to match capture rendering, then release its one pixel.
          const previousTarget = gl.getRenderTarget();
          const target = new WebGLRenderTarget(1, 1, { depthBuffer: false });
          try {
            gl.setRenderTarget(target);
            gl.compile(scene, camera);
          } finally {
            gl.setRenderTarget(previousTarget);
            target.dispose();
          }
        }
        const extension = context.getExtension("KHR_parallel_shader_compile");
        const programs = [...(gl.info.programs ?? [])];
        const check = () => {
          if (context.isContextLost()) return;
          if (
            extension &&
            programs.some(
              ({ program }) =>
                program && !context.getProgramParameter(program, extension.COMPLETION_STATUS_KHR),
            )
          ) {
            timer = setTimeout(check, 10);
            return;
          }
          setPreparedGeneration(generation);
          onReadyChange(true);
          invalidate();
        };
        // Unlike compileAsync's internal poll, this wait can be cancelled when a
        // quality switch disposes the scene or its WebGL context.
        timer = setTimeout(check, 10);
      } catch (error) {
        setFailure({ error });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [camera, generation, gl, invalidate, onReadyChange, postprocessing, scene]);

  if (failure) throw failure.error;
  return null;
}
