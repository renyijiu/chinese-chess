import type { Role, Side } from "../../../lib/xiangqi/index";

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
    impactRadius: 0.72,
    motif: "qin-command-seal",
    particleCount: 12,
    payload: "command-blade",
  },
  advisor: {
    impactRadius: 0.68,
    motif: "tiger-tally",
    particleCount: 10,
    payload: "tally",
  },
  elephant: {
    impactRadius: 0.78,
    motif: "clay-earthshock",
    particleCount: 14,
    payload: "earthshock",
  },
  chariot: {
    impactRadius: 0.7,
    motif: "bronze-wheel",
    particleCount: 12,
    payload: "wheel",
  },
  horse: {
    impactRadius: 0.7,
    motif: "qin-lance",
    particleCount: 11,
    payload: "lance",
  },
  cannon: {
    impactRadius: 0.76,
    motif: "siege-bolt",
    particleCount: 16,
    payload: "bolt",
  },
  soldier: {
    impactRadius: 0.64,
    motif: "spear-rank",
    particleCount: 8,
    payload: "spear",
  },
});

const FACTION = {
  red: {
    colors: { bright: "#d7aa72", core: "#8a4334", smoke: "#6a5142" },
    pattern: "cinnabar-seal" as const,
  },
  black: {
    colors: { bright: "#a9bdae", core: "#477267", smoke: "#4d5c55" },
    pattern: "verdigris-angle" as const,
  },
};

export function getPieceVfxProfile(role: Role, side: Side): PieceVfxProfile {
  return { ...PIECE_VFX_PROFILES[role], ...FACTION[side] };
}
