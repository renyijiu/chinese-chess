import { describe, expect, it } from "vitest";

import {
  FACTION_MARKER_CLEARANCE,
  FACTION_MARKER_STYLES,
} from "../../../components/xiangqi/pieces/faction-marker";
import { BOARD_SPACING } from "../../../components/xiangqi/runtime/board-coordinates";

describe("faction base markers", () => {
  it("uses shape as well as color to distinguish the factions", () => {
    expect(FACTION_MARKER_STYLES.red.segments).toBeGreaterThanOrEqual(32);
    expect(FACTION_MARKER_STYLES.black.segments).toBe(4);
    expect(FACTION_MARKER_STYLES.red.rotationZ).not.toBe(FACTION_MARKER_STYLES.black.rotationZ);
  });

  it("stays inside a board intersection without hiding the model base", () => {
    for (const style of Object.values(FACTION_MARKER_STYLES)) {
      expect(style.innerRadius).toBeLessThan(style.outerRadius);
      expect(style.outerRadius).toBeGreaterThan(0.445);
      expect(style.outerRadius).toBeLessThan(BOARD_SPACING / 2);
    }
    expect(FACTION_MARKER_CLEARANCE).toBeGreaterThan(0);
  });
});
