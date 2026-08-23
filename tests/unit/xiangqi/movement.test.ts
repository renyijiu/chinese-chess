import { describe, expect, it } from "vitest";

import { getLegalMoves } from "../../../lib/xiangqi/index";
import { guardedGenerals, makeState, piece, squareKeys } from "./fixtures";

describe("popular-v1 piece movement", () => {
  it("stops a chariot at friendly pieces and after the first enemy", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:chariot:0", "red", "chariot", 2, 4),
      piece("red:soldier:block", "red", "soldier", 2, 6),
      piece("black:soldier:target", "black", "soldier", 2, 2),
    ]);

    const moves = squareKeys(getLegalMoves(state, "red:chariot:0"));
    expect(moves).toContain("2,2");
    expect(moves).toContain("2,5");
    expect(moves).not.toContain("2,1");
    expect(moves).not.toContain("2,6");
  });

  it("requires exactly one cannon screen to capture", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:cannon:0", "red", "cannon", 2, 3),
      piece("red:soldier:screen", "red", "soldier", 2, 4),
      piece("black:soldier:target", "black", "soldier", 2, 6),
      piece("black:soldier:beyond", "black", "soldier", 2, 8),
    ]);

    const moves = squareKeys(getLegalMoves(state, "red:cannon:0"));
    expect(moves).toContain("2,6");
    expect(moves).not.toContain("2,5");
    expect(moves).not.toContain("2,8");
  });

  it("blocks both horse destinations that share a horse-leg", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:horse:0", "red", "horse", 2, 4),
      piece("red:soldier:leg", "red", "soldier", 2, 5),
    ]);

    const moves = squareKeys(getLegalMoves(state, "red:horse:0"));
    expect(moves).not.toContain("1,6");
    expect(moves).not.toContain("3,6");
    expect(moves).toContain("4,3");
  });

  it("honors the elephant eye and river boundary", () => {
    const state = makeState([
      ...guardedGenerals(),
      piece("red:elephant:0", "red", "elephant", 2, 2),
      piece("red:soldier:eye", "red", "soldier", 3, 3),
    ]);

    expect(squareKeys(getLegalMoves(state, "red:elephant:0"))).toEqual([
      "0,0",
      "0,4",
    ]);

    const riverState = makeState([
      ...guardedGenerals(),
      piece("red:elephant:1", "red", "elephant", 4, 4),
    ]);
    expect(squareKeys(getLegalMoves(riverState, "red:elephant:1"))).not.toContain("6,6");
  });

  it("keeps advisors and generals in their own palace", () => {
    const advisorState = makeState([
      ...guardedGenerals(),
      piece("red:advisor:0", "red", "advisor", 4, 1),
    ]);
    expect(squareKeys(getLegalMoves(advisorState, "red:advisor:0"))).toEqual([
      "3,0",
      "3,2",
      "5,0",
      "5,2",
    ]);

    const generalState = makeState(guardedGenerals());
    expect(squareKeys(getLegalMoves(generalState, "red:general:0"))).toEqual([
      "3,0",
      "4,1",
      "5,0",
    ]);
  });

  it("adds sideways soldier moves only after crossing the river", () => {
    const before = makeState([
      ...guardedGenerals(),
      piece("red:soldier:0", "red", "soldier", 2, 4),
    ]);
    expect(squareKeys(getLegalMoves(before, "red:soldier:0"))).toEqual(["2,5"]);

    const after = makeState([
      ...guardedGenerals(),
      piece("red:soldier:0", "red", "soldier", 2, 5),
    ]);
    expect(squareKeys(getLegalMoves(after, "red:soldier:0"))).toEqual([
      "1,5",
      "2,6",
      "3,5",
    ]);
  });
});
