import { describe, expect, it } from "vitest";

import type { Role } from "../../../lib/xiangqi/index";
import {
  PIECE_VFX_PROFILES,
  getPieceVfxProfile,
} from "../../../components/xiangqi/vfx/piece-vfx-profiles";

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
      expect(profile.impactRadius).toBeLessThanOrEqual(0.78);
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
});
