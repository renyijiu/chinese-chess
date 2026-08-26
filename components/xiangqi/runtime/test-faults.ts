import type { AudioEngine } from "../audio/AudioEngine";
import type { AudioTransientCueId } from "../audio/audio-types";

export type XiangqiTestFault = "ambientTask" | "riverRender";

type AudioDebugSnapshot = ReturnType<AudioEngine["debugSnapshot"]>;
type AudioTestControls = Readonly<{
  dispose(): Promise<void>;
  playTransient(cue: AudioTransientCueId): boolean;
  snapshot(): AudioDebugSnapshot;
}>;

declare global {
  interface Window {
    __XIANGQI_AUDIO_DEBUG__?: () => AudioDebugSnapshot;
    __XIANGQI_AUDIO_TEST__?: AudioTestControls;
    __XIANGQI_TEST_FAULTS__?: Partial<Record<XiangqiTestFault, boolean>>;
  }
}

/** Development-only fault injection used by browser resilience coverage. */
export function isTestFaultEnabled(fault: XiangqiTestFault) {
  return process.env.NODE_ENV !== "production"
    && typeof window !== "undefined"
    && window.__XIANGQI_TEST_FAULTS__?.[fault] === true;
}

/**
 * Publishes a read-only audio snapshot for browser lifecycle checks. Mutating
 * controls are development-only so production exposes no fault or playback API.
 */
export function attachAudioDiagnostics(audio: AudioEngine) {
  if (typeof window === "undefined") return () => undefined;
  const snapshot = () => audio.debugSnapshot();
  window.__XIANGQI_AUDIO_DEBUG__ = snapshot;

  const controls: AudioTestControls | undefined = process.env.NODE_ENV !== "production"
    ? {
        dispose: () => audio.dispose(),
        playTransient: (cue) => audio.playTransient(cue),
        snapshot,
      }
    : undefined;
  if (controls) window.__XIANGQI_AUDIO_TEST__ = controls;

  return () => {
    if (window.__XIANGQI_AUDIO_DEBUG__ === snapshot) delete window.__XIANGQI_AUDIO_DEBUG__;
    if (controls && window.__XIANGQI_AUDIO_TEST__ === controls) delete window.__XIANGQI_AUDIO_TEST__;
  };
}
