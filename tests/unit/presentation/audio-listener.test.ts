import { expect, it, vi } from "vitest";
import * as THREE from "three";
import type { AudioEngine } from "../../../components/xiangqi/audio/AudioEngine";
import { AudioListenerBridge } from "../../../components/xiangqi/audio/AudioListenerBridge";

const frame = vi.hoisted(() => ({
  callback: (_state: { camera: THREE.Camera; clock: THREE.Clock }) => {},
}));
vi.mock("@react-three/fiber", () => ({
  useFrame: (callback: typeof frame.callback) => {
    frame.callback = callback;
  },
}));
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }) }));

it("reads the renderer clock without advancing the next animation frame's time origin", () => {
  const clock = new THREE.Clock();
  clock.running = true;
  clock.oldTime = 1000;
  clock.elapsedTime = 1;
  const now = vi.spyOn(performance, "now").mockReturnValue(1005);
  try {
    AudioListenerBridge({
      audio: { state: "running", setListenerPose: vi.fn() } as unknown as AudioEngine,
    });
    frame.callback({ clock, camera: new THREE.PerspectiveCamera() });
    expect(clock.oldTime).toBe(1000);
    expect(clock.elapsedTime).toBe(1);
  } finally {
    now.mockRestore();
  }
});
