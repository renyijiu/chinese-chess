import { describe, expect, it } from "vitest";

import type { Role } from "../../../lib/xiangqi/index";
import {
  PIECE_VFX_PROFILES,
  getPieceVfxProfile,
} from "../../../components/xiangqi/vfx/piece-vfx-profiles";
import { QIN_DIORAMA_THEME } from "../../../components/xiangqi/scene/scene-theme";

const ROLES: readonly Role[] = [
  "general",
  "advisor",
  "elephant",
  "chariot",
  "horse",
  "cannon",
  "soldier",
];

describe("piece combat VFX profiles", () => {
  it("gives every role a distinct, bounded combat language", () => {
    expect(Object.keys(PIECE_VFX_PROFILES)).toHaveLength(7);
    expect(new Set(ROLES.map((role) => getPieceVfxProfile(role, "red").motif)).size).toBe(7);

    for (const role of ROLES) {
      const profile = getPieceVfxProfile(role, "red");
      expect(profile.impactRadius).toBeLessThanOrEqual(0.62);
    }
  });

  it("uses faction-specific color and pattern identities without changing geometry", () => {
    for (const role of ROLES) {
      const red = getPieceVfxProfile(role, "red");
      const black = getPieceVfxProfile(role, "black");
      expect(red.motif).toBe(black.motif);
      expect(red.pattern).not.toBe(black.pattern);
      expect(red.colors.core).not.toBe(black.colors.core);
    }
  });

  it("derives faction effects from the Qin diorama theme", () => {
    const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
    const red = getPieceVfxProfile("general", "red");
    const black = getPieceVfxProfile("general", "black");

    expect(red.colors).toEqual({
      bright: hex(QIN_DIORAMA_THEME.factions.red.glow),
      core: hex(QIN_DIORAMA_THEME.accents.cinnabar),
      smoke: hex(QIN_DIORAMA_THEME.materials.firedClayShadow),
    });
    expect(black.colors).toEqual({
      bright: hex(QIN_DIORAMA_THEME.factions.black.glow),
      core: hex(QIN_DIORAMA_THEME.accents.verdigris),
      smoke: hex(QIN_DIORAMA_THEME.materials.blackLacquer),
    });
  });
});
