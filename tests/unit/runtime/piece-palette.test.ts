import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { FACTION_COLORS, semanticColor } from "../../../components/xiangqi/pieces/piece-palette";
import manifest from "../../../public/models/pieces/v1/manifest.json";

function hex(value: string) {
  return Number.parseInt(value.slice(1), 16);
}

describe("piece faction palette", () => {
  it("keeps the authoritative red research materials as the red faction targets", () => {
    expect(FACTION_COLORS.red).toMatchObject({
      bronze: 0x5b4031,
      clothPrimary: 0x6a4937,
      clothSecondary: 0x6faf95,
      trim: 0xc44b2f,
    });
  });

  it("uses the same faction palette as the runtime asset manifest", () => {
    for (const side of ["red", "black"] as const) {
      const palette = manifest.factions[side].palette;
      expect(FACTION_COLORS[side]).toEqual({
        bronze: hex(palette.aged_bronze),
        clothPrimary: hex(palette.faction_cloth_primary),
        clothSecondary: hex(palette.faction_cloth_secondary),
        glow: hex(palette.energy),
        trim: hex(palette.faction_trim),
      });
    }
  });

  it("maps an authored cloth color to each faction without calling a missing THREE.Color method", () => {
    const authoredCloth = new THREE.Color(0.25, 0.018, 0.01);

    expect(semanticColor(authoredCloth, "red").getHex()).toBe(FACTION_COLORS.red.clothPrimary);
    expect(semanticColor(authoredCloth, "black").getHex()).toBe(FACTION_COLORS.black.clothPrimary);
  });

  it("preserves non-faction skin, hide, wood, ivory, iron, and stone colors", () => {
    const horseHide = new THREE.Color(0.082, 0.038, 0.018);

    expect(semanticColor(horseHide, "red")).toBe(horseHide);
    expect(semanticColor(horseHide, "black")).toBe(horseHide);
  });
});
