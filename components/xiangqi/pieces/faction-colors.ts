import type { Side } from "../../../lib/xiangqi/index";

export type FactionPalette = Readonly<{
  bronze: number;
  clothPrimary: number;
  clothSecondary: number;
  glow: number;
  trim: number;
}>;

function factionPalette(value: FactionPalette): FactionPalette {
  return Object.freeze(value);
}

/** Pure numeric faction tokens shared by Three.js and server-rendered UI. */
export const FACTION_COLORS: Readonly<Record<Side, FactionPalette>> = Object.freeze({
  red: factionPalette({
    // sRGB encodings of the authoritative research materials' linear glTF colors.
    bronze: 0x5b4031,
    clothPrimary: 0x6a4937,
    clothSecondary: 0x6faf95,
    glow: 0xd7a35d,
    trim: 0xc44b2f,
  }),
  black: factionPalette({
    bronze: 0x3f5d50,
    clothPrimary: 0x284e43,
    clothSecondary: 0x122621,
    glow: 0x9dc8ae,
    trim: 0x688a72,
  }),
});
