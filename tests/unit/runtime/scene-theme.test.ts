import { describe, expect, it } from "vitest";

import { FACTION_COLORS } from "../../../components/xiangqi/pieces/piece-palette";
import {
  QIN_DIORAMA_CSS_VARIABLES,
  QIN_DIORAMA_THEME,
} from "../../../components/xiangqi/scene/scene-theme";

function cssHex(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function relativeLuminance(color: number) {
  const channel = (shift: number) => {
    const value = ((color >> shift) & 0xff) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

describe("Qin diorama scene theme", () => {
  it("derives faction scene and CSS tokens from the authoritative piece palette", () => {
    for (const side of ["red", "black"] as const) {
      expect(QIN_DIORAMA_THEME.factions[side]).toBe(FACTION_COLORS[side]);
      expect(QIN_DIORAMA_CSS_VARIABLES[`--qin-faction-${side}-primary`]).toBe(
        cssHex(FACTION_COLORS[side].clothPrimary),
      );
      expect(QIN_DIORAMA_CSS_VARIABLES[`--qin-faction-${side}-secondary`]).toBe(
        cssHex(FACTION_COLORS[side].clothSecondary),
      );
      expect(QIN_DIORAMA_CSS_VARIABLES[`--qin-faction-${side}-trim`]).toBe(
        cssHex(FACTION_COLORS[side].trim),
      );
      expect(QIN_DIORAMA_CSS_VARIABLES[`--qin-faction-${side}-glow`]).toBe(
        cssHex(FACTION_COLORS[side].glow),
      );
    }
  });

  it("keeps legal, capture and keyboard focus recognizable without color alone", () => {
    const { legal, capture, keyboardFocus } = QIN_DIORAMA_THEME.states;

    expect(new Set([legal.indicator, capture.indicator, keyboardFocus.indicator]).size).toBe(3);
    expect(Math.abs(relativeLuminance(legal.color) - relativeLuminance(capture.color))).toBeGreaterThan(0.25);
    expect(QIN_DIORAMA_CSS_VARIABLES["--qin-state-keyboard-focus"]).toBe(cssHex(keyboardFocus.color));
  });

  it("exports an immutable JSON-serializable CSS variable map from canonical values", () => {
    expect(Object.isFrozen(QIN_DIORAMA_THEME)).toBe(true);
    expect(Object.isFrozen(QIN_DIORAMA_THEME.materials)).toBe(true);
    expect(Object.isFrozen(QIN_DIORAMA_THEME.states.legal)).toBe(true);
    expect(Object.isFrozen(QIN_DIORAMA_CSS_VARIABLES)).toBe(true);
    expect(Object.values(QIN_DIORAMA_CSS_VARIABLES).every((value) => typeof value === "string")).toBe(true);
    expect(JSON.parse(JSON.stringify(QIN_DIORAMA_CSS_VARIABLES))).toEqual(QIN_DIORAMA_CSS_VARIABLES);
    expect(QIN_DIORAMA_CSS_VARIABLES).toMatchObject({
      "--qin-aged-bronze": cssHex(QIN_DIORAMA_THEME.materials.agedBronze),
      "--qin-black-lacquer": cssHex(QIN_DIORAMA_THEME.materials.blackLacquer),
      "--qin-chalk": cssHex(QIN_DIORAMA_THEME.materials.chalk),
      "--qin-fired-clay": cssHex(QIN_DIORAMA_THEME.materials.firedClay),
      "--qin-mineral-blue": cssHex(QIN_DIORAMA_THEME.accents.mineralBlue),
    });
  });
});
