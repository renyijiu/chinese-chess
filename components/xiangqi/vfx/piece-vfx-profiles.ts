import type { Role, Side } from "../../../lib/xiangqi/index";
import { cssHex, QIN_DIORAMA_THEME } from "../scene/scene-theme";

export type VfxMotif = "qin-command-seal" | "tiger-tally" | "clay-earthshock" | "bronze-wheel" | "qin-lance" | "siege-bolt" | "spear-rank";
export type VfxPayload = "command-blade" | "tally" | "earthshock" | "wheel" | "lance" | "bolt" | "spear";

export type PieceVfxProfile = Readonly<{
  colors: Readonly<{ bright: string; core: string; smoke: string }>;
  impactRadius: number;
  motif: VfxMotif;
  particleCount: number;
  pattern: "cinnabar-seal" | "verdigris-angle";
  payload: VfxPayload;
}>;

type NeutralProfile = Omit<PieceVfxProfile, "colors" | "pattern">;

export const PIECE_VFX_PROFILES: Readonly<Record<Role, NeutralProfile>> = Object.freeze({
  general: {
    impactRadius: 0.58,
    motif: "qin-command-seal",
    particleCount: 12,
    payload: "command-blade",
  },
  advisor: {
    impactRadius: 0.54,
    motif: "tiger-tally",
    particleCount: 10,
    payload: "tally",
  },
  elephant: {
    impactRadius: 0.62,
    motif: "clay-earthshock",
    particleCount: 14,
    payload: "earthshock",
  },
  chariot: {
    impactRadius: 0.56,
    motif: "bronze-wheel",
    particleCount: 12,
    payload: "wheel",
  },
  horse: {
    impactRadius: 0.56,
    motif: "qin-lance",
    particleCount: 11,
    payload: "lance",
  },
  cannon: {
    impactRadius: 0.6,
    motif: "siege-bolt",
    particleCount: 16,
    payload: "bolt",
  },
  soldier: {
    impactRadius: 0.5,
    motif: "spear-rank",
    particleCount: 8,
    payload: "spear",
  },
});

const FACTION = {
  red: {
    colors: {
      bright: cssHex(QIN_DIORAMA_THEME.factions.red.glow),
      core: cssHex(QIN_DIORAMA_THEME.accents.cinnabar),
      smoke: cssHex(QIN_DIORAMA_THEME.materials.firedClayShadow),
    },
    pattern: "cinnabar-seal" as const,
  },
  black: {
    colors: {
      bright: cssHex(QIN_DIORAMA_THEME.factions.black.glow),
      core: cssHex(QIN_DIORAMA_THEME.accents.verdigris),
      smoke: cssHex(QIN_DIORAMA_THEME.materials.blackLacquer),
    },
    pattern: "verdigris-angle" as const,
  },
};

export function getPieceVfxProfile(role: Role, side: Side): PieceVfxProfile {
  return { ...PIECE_VFX_PROFILES[role], ...FACTION[side] };
}
