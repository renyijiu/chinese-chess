import type { MoveRecord } from "../../../lib/xiangqi/index";
import { ASSET_ROLE_BY_GAME_ROLE } from "../pieces/piece-catalog";
import { squareToWorld } from "../runtime/board-coordinates";
import type { PresentationCue } from "../presentation/PresentationStore";
import type { AudioEngine } from "./AudioEngine";
import type { AudioCueId } from "./audio-types";
import { ROLE_VOICE_LINES } from "./voice-lines";

const CUE_SUFFIX_BY_MARKER: Readonly<Partial<Record<PresentationCue["marker"], "move" | "release" | "impact" | "fracture">>> = Object.freeze({
  telegraph: "move",
  release: "release",
  impact: "impact",
  fracture: "fracture",
});

function cueMoveEvent(cue: PresentationCue) {
  const event = cue.transition.events.find((candidate) =>
    candidate.type === "MoveCommitted" || candidate.type === "MoveUndone",
  );
  return event?.type === "MoveCommitted" || event?.type === "MoveUndone" ? event : null;
}

export function handlePresentationAudioCue(engine: AudioEngine, cue: PresentationCue) {
  const moveEvent = cueMoveEvent(cue);
  const capture = cue.transition.events.some((event) => event.type === "PieceCaptured");
  if (moveEvent) {
    const move: MoveRecord = moveEvent.move;
    const role = ASSET_ROLE_BY_GAME_ROLE[move.role];
    const visualFrom = moveEvent.type === "MoveUndone" ? move.to : move.from;
    const visualTo = moveEvent.type === "MoveUndone" ? move.from : move.to;
    const world = squareToWorld(cue.marker === "telegraph" || cue.marker === "release" ? visualFrom : visualTo);
    const suffix = CUE_SUFFIX_BY_MARKER[cue.marker];
    if (suffix) engine.play(`${role}.${suffix}` as AudioCueId, { position: world });

    if (cue.marker === "release" && (capture || cue.transition.after.revision % 3 === 0)) {
      const lines = ROLE_VOICE_LINES[role][move.side];
      const line = lines[cue.transition.after.revision % lines.length];
      if (line) engine.speak(line);
    }
  }
}
