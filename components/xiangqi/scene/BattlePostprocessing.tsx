"use client";

/* oxlint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

// EffectComposer mounts its children after creating its renderer resources.
function BattleBloom({ light }: { light: THREE.Light }) {
  const scene = useThree((state) => state.scene);
  const selection = useMemo(
    () =>
      scene.getObjectByName("battle-bloom-selection")?.getObjectsByProperty("type", "Mesh") ?? [],
    [scene],
  );
  return (
    <SelectiveBloom
      selection={selection}
      intensity={0.62}
      lights={[light]}
      luminanceSmoothing={0.18}
      luminanceThreshold={0.28}
      mipmapBlur={false}
      resolutionScale={0.5}
    />
  );
}

/** High-tier-only glow, loaded independently of the board and its VFX graph. */
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
      <EffectComposer depthBuffer enableNormalPass={false} multisampling={0}>
        <BattleBloom light={bloomLight} />
      </EffectComposer>
    </>
  );
}
