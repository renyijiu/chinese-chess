import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { FACTION_COLORS, semanticColor } from "../../../components/xiangqi/pieces/piece-palette";

describe("piece faction palette", () => {
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
