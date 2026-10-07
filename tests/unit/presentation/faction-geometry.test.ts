import { expect, it } from "vitest";
import * as THREE from "three";

import { factionGeometry } from "../../../components/xiangqi/pieces/faction-geometry";
import { FACTION_COLORS } from "../../../components/xiangqi/pieces/piece-palette";

it("shares immutable mesh buffers while caching independent faction colors and draw metadata", () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  source.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  source.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
  source.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  source.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      [0.25, 0.018, 0.01, 0.5, 0.082, 0.038, 0.018, 1, 0.38, 0.18, 0.035, 1],
      4,
    ),
  );
  source.setIndex([0, 1, 2]);
  source.addGroup(0, 3, 2);
  source.setDrawRange(1, 2);
  source.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(9), 3)];
  source.morphTargetsRelative = true;
  source.computeBoundingBox();
  source.computeBoundingSphere();
  const authoredColors = source.getAttribute("color").array.slice();
  const red = factionGeometry(source, "red");
  const black = factionGeometry(source, "black");

  expect(red).not.toBe(black);
  for (const [side, geometry] of [
    ["red", red],
    ["black", black],
  ] as const) {
    expect(factionGeometry(source, side)).toBe(geometry);
    expect(geometry).not.toBe(source);
    for (const name of ["position", "normal", "skinIndex", "skinWeight"]) {
      expect(geometry.getAttribute(name)).toBe(source.getAttribute(name));
    }
    expect(geometry.index).toBe(source.index);
    expect(geometry.morphAttributes.position?.[0]).toBe(source.morphAttributes.position[0]);
    expect(geometry.morphTargetsRelative).toBe(true);
    expect(geometry.groups).toEqual(source.groups);
    expect(geometry.groups[0]).not.toBe(source.groups[0]);
    expect(geometry.drawRange).toEqual(source.drawRange);
    expect(geometry.drawRange).not.toBe(source.drawRange);
    expect(geometry.boundingBox).toEqual(source.boundingBox);
    expect(geometry.boundingBox).not.toBe(source.boundingBox);
    expect(geometry.boundingSphere).toEqual(source.boundingSphere);
    expect(geometry.boundingSphere).not.toBe(source.boundingSphere);

    const colors = geometry.getAttribute("color");
    expect(colors).not.toBe(source.getAttribute("color"));
    expect(colors.itemSize).toBe(4);
    expect(colors.count).toBe(3);
    const cloth = new THREE.Color(FACTION_COLORS[side].clothPrimary);
    const trim = new THREE.Color(FACTION_COLORS[side].trim);
    expect(Array.from(colors.array)).toEqual(
      Array.from(
        new Float32Array([
          cloth.r,
          cloth.g,
          cloth.b,
          1,
          authoredColors[4]!,
          authoredColors[5]!,
          authoredColors[6]!,
          1,
          trim.r,
          trim.g,
          trim.b,
          1,
        ]),
      ),
    );
  }

  const blackColors = black.getAttribute("color").array.slice();
  red.getAttribute("color").setX(0, 0.9);
  expect(black.getAttribute("color").array).toEqual(blackColors);
  expect(source.getAttribute("color").array).toEqual(authoredColors);
  expect(factionGeometry(source.clone(), "red")).not.toBe(red);
});

it("keeps geometry without authored colors uncolored", () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const geometry = factionGeometry(source, "red");
  expect(geometry.getAttribute("color")).toBeUndefined();
  expect(geometry.getAttribute("position")).toBe(source.getAttribute("position"));
  expect(geometry.index).toBeNull();
  expect(geometry.boundingBox).toBeNull();
  expect(geometry.boundingSphere).toBeNull();
});
