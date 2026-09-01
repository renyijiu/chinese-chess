import * as THREE from "three";

type AnimationEntry = {
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  mixer: THREE.AnimationMixer;
  urgentSeconds: number;
};

function isLoopingClip(name: string) {
  return name === "idle_loop" || name === "move_loop";
}

/** Owns independent mixers while allowing one scene-level director to tick them. */
export class AnimationRegistry {
  private readonly entries = new Map<string, AnimationEntry>();

  get resourceCounts() {
    let actions = 0;
    this.entries.forEach((entry) => {
      actions += entry.actions.size;
    });
    return { actions, actors: this.entries.size } as const;
  }

  register(actorId: string, mixer: THREE.AnimationMixer, clips: readonly THREE.AnimationClip[]) {
    this.unregister(actorId);
    const actions = new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
    this.entries.set(actorId, { actions, current: null, mixer, urgentSeconds: 0 });
    this.play(actorId, "idle_loop");
    return () => this.unregister(actorId, mixer);
  }

  play(actorId: string, clipName: string) {
    const entry = this.entries.get(actorId);
    const next = entry?.actions.get(clipName);
    if (!entry || !next || entry.current === next) return false;

    const previous = entry.current;
    next.enabled = true;
    next.clampWhenFinished = !isLoopingClip(clipName);
    const looping = isLoopingClip(clipName);
    next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous) previous.fadeOut(0.08);
    next.fadeIn(0.08);
    entry.current = next;
    entry.urgentSeconds = looping
      ? clipName === "move_loop"
        ? Math.max(entry.urgentSeconds, 0.8)
        : entry.urgentSeconds
      : Math.max(entry.urgentSeconds, next.getClip().duration + 0.12);
    return true;
  }

  update(deltaSeconds: number) {
    const delta = Math.min(0.1, Math.max(0, deltaSeconds));
    for (const entry of this.entries.values()) {
      entry.mixer.update(delta);
      entry.urgentSeconds = Math.max(0, entry.urgentSeconds - delta);
    }
  }

  get hasUrgentAnimation() {
    return [...this.entries.values()].some((entry) => entry.urgentSeconds > 0);
  }

  clearUrgentAnimations() {
    for (const entry of this.entries.values()) entry.urgentSeconds = 0;
  }

  dispose() {
    for (const actorId of [...this.entries.keys()]) this.unregister(actorId);
  }

  private unregister(actorId: string, expectedMixer?: THREE.AnimationMixer) {
    const entry = this.entries.get(actorId);
    if (!entry || (expectedMixer && entry.mixer !== expectedMixer)) return;
    entry.mixer.stopAllAction();
    entry.actions.forEach((action) => entry.mixer.uncacheAction(action.getClip()));
    this.entries.delete(actorId);
  }
}
