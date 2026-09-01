import { describe, expect, it } from "vitest";

import { getLegalMoves, isInCheck } from "../../../lib/xiangqi/index";
import { makeState, piece, squareKeys } from "./fixtures";

describe("check and self-check filtering", () => {
  it("treats unobstructed facing generals as check", () => {
    const state = makeState([
      piece("red:general:0", "red", "general", 4, 0),
      piece("black:general:0", "black", "general", 4, 9),
    ]);

    expect(isInCheck(state, "red")).toBe(true);
    expect(isInCheck(state, "black")).toBe(true);
  });

  it("does not allow a pinned screen to expose facing generals", () => {
    const state = makeState([
      piece("red:general:0", "red", "general", 4, 0),
      piece("black:general:0", "black", "general", 4, 9),
      piece("red:chariot:0", "red", "chariot", 4, 5),
    ]);

    const moves = getLegalMoves(state, "red:chariot:0");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((square) => square.file === 4)).toBe(true);
  });

  it("detects cannon, horse, and crossed-river soldier checks with blocking rules", () => {
    const cannonCheck = makeState(
      [
        piece("red:general:0", "red", "general", 4, 0),
        piece("black:general:0", "black", "general", 4, 9),
        piece("red:cannon:0", "red", "cannon", 4, 6),
        piece("black:soldier:screen", "black", "soldier", 4, 8),
      ],
      "black",
    );
    expect(isInCheck(cannonCheck, "black")).toBe(true);

    const horseCheck = makeState(
      [
        piece("red:general:0", "red", "general", 4, 0),
        piece("black:general:0", "black", "general", 4, 9),
        piece("red:horse:0", "red", "horse", 3, 7),
        piece("red:soldier:guard", "red", "soldier", 4, 5),
      ],
      "black",
    );
    expect(isInCheck(horseCheck, "black")).toBe(true);

    const blockedHorse = makeState(
      [
        ...horseCheck.board.filter((candidate) => candidate !== null),
        piece("black:soldier:leg", "black", "soldier", 3, 8),
      ],
      "black",
    );
    expect(isInCheck(blockedHorse, "black")).toBe(false);

    const soldierCheck = makeState(
      [
        piece("red:general:0", "red", "general", 4, 0),
        piece("black:general:0", "black", "general", 4, 9),
        piece("red:soldier:0", "red", "soldier", 3, 9),
        piece("red:soldier:guard", "red", "soldier", 4, 5),
      ],
      "black",
    );
    expect(isInCheck(soldierCheck, "black")).toBe(true);
  });

  it("never returns the opposing general as a capturable destination", () => {
    const state = makeState([
      piece("red:general:0", "red", "general", 4, 0),
      piece("black:general:0", "black", "general", 4, 9),
      piece("red:chariot:0", "red", "chariot", 4, 8),
    ]);

    expect(squareKeys(getLegalMoves(state, "red:chariot:0"))).not.toContain("4,9");
  });
});
