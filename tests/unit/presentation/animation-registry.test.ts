import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { AnimationRegistry } from "../../../components/xiangqi/animation/AnimationRegistry";

describe("AnimationRegistry", () => {
  it("updates independently cloned actor mixers from one registry tick", () => {
    const registry = new AnimationRegistry();
    const firstRoot = new THREE.Object3D();
    const secondRoot = new THREE.Object3D();
    const attack = new THREE.AnimationClip("attack_primary", 1, [
      new THREE.NumberKeyframeTrack(".position[x]", [0, 1], [0, 2]),
    ]);

    const unregisterFirst = registry.register(
      "red:general:0",
      new THREE.AnimationMixer(firstRoot),
      [attack],
    );
    const unregisterSecond = registry.register(
      "black:general:0",
      new THREE.AnimationMixer(secondRoot),
      [attack],
    );
    registry.play("red:general:0", "attack_primary");

    registry.update(0.5);

    expect(firstRoot.position.x).toBeGreaterThan(0);
    expect(secondRoot.position.x).toBe(0);
    unregisterFirst();
    unregisterSecond();
  });

  it("releases mixer actions across repeated actor mount and unmount cycles", () => {
    const registry = new AnimationRegistry();
    const idle = new THREE.AnimationClip("idle_loop", 1, []);

    for (let index = 0; index < 100; index += 1) {
      const unregister = registry.register(
        `actor:${index}`,
        new THREE.AnimationMixer(new THREE.Object3D()),
        [idle],
      );
      unregister();
    }

    expect(registry.resourceCounts).toEqual({ actions: 0, actors: 0 });
  });
});
