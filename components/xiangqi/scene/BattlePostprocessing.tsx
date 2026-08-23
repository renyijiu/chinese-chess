"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { useMemo } from "react";
import * as THREE from "three";

/** High-tier-only selective glow. Only objects wrapped in <Select> enter this pass. */
export function BattlePostprocessing() {
  const bloomLight = useMemo(() => {
    const light = new THREE.AmbientLight(0xffffff, 0.72);
    light.layers.set(10);
    light.name = "selective-bloom-light";
    return light;
  }, []);
  return (
    <>
      <primitive object={bloomLight} />
      <EffectComposer depthBuffer={false} enableNormalPass={false} multisampling={0} resolutionScale={0.65}>
        <SelectiveBloom
          intensity={0.82}
          lights={[bloomLight]}
          luminanceSmoothing={0.18}
          luminanceThreshold={0.2}
          radius={0.55}
        />
      </EffectComposer>
    </>
  );
}
