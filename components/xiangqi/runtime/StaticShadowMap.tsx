"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type * as THREE from "three";

function configureShadowMap(renderer: THREE.WebGLRenderer, autoUpdate: boolean) {
  renderer.shadowMap.autoUpdate = autoUpdate;
  renderer.shadowMap.needsUpdate = true;
}

/**
 * The board slabs are the only shadow casters in the production scene. Pieces,
 * flags and braziers deliberately use contact light/no castShadow, so rebuilding
 * the 2K directional shadow map every ambient frame cannot change the image.
 */
export function StaticShadowMap({ enabled }: { enabled: boolean }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (!enabled) return;
    const requestUpdate = () => {
      gl.shadowMap.needsUpdate = true;
    };
    configureShadowMap(gl, false);
    gl.domElement.addEventListener("webglcontextrestored", requestUpdate);
    return () => {
      gl.domElement.removeEventListener("webglcontextrestored", requestUpdate);
      configureShadowMap(gl, true);
    };
  }, [enabled, gl]);

  return null;
}
