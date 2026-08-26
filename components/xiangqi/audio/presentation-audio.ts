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

function cueMove(cue: PresentationCue): MoveRecord | null {
  const event = cue.transition.events.find((candidate) =>
    candidate.type === "MoveCommitted" || candidate.type === "MoveUndone",
  );
  return event?.type === "MoveCommitted" || event?.type === "MoveUndone" ? event.move : null;
}

export function handlePresentationAudioCue(engine: AudioEngine, cue: PresentationCue) {
  const move = cueMove(cue);
  const capture = cue.transition.events.some((event) => event.type === "PieceCaptured");
  if (move) {
    const role = ASSET_ROLE_BY_GAME_ROLE[move.role];
    const world = squareToWorld(cue.marker === "telegraph" || cue.marker === "release" ? move.from : move.to);
    const suffix = CUE_SUFFIX_BY_MARKER[cue.marker];
    if (suffix) engine.play(`${role}.${suffix}` as AudioCueId, { position: world });

    if (cue.marker === "release" && (capture || cue.transition.after.revision % 3 === 0)) {
      const lines = ROLE_VOICE_LINES[role][move.side];
      const line = lines[cue.transition.after.revision % lines.length];
      if (line) engine.speak(line);
    }
  }
}
