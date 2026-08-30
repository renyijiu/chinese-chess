import type { Side } from "../../../lib/xiangqi/index";

export type FactionMarkerStyle = Readonly<{
  innerRadius: number;
  outerRadius: number;
  rotationZ: number;
  segments: number;
}>;

/**
 * Persistent, top-down-readable faction shapes.
 *
 * Red keeps the traditional round seal; black uses four exposed diamond
 * corners. The distinction therefore survives warm lighting and color-vision
 * differences instead of relying on pigment alone.
 */
export const FACTION_MARKER_STYLES: Readonly<Record<Side, FactionMarkerStyle>> = Object.freeze({
  red: Object.freeze({
    innerRadius: 0.458,
    outerRadius: 0.548,
    rotationZ: 0,
    segments: 48,
  }),
  black: Object.freeze({
    innerRadius: 0.43,
    outerRadius: 0.558,
    rotationZ: Math.PI / 4,
    segments: 4,
  }),
});

export const FACTION_MARKER_CLEARANCE = 0.031;
