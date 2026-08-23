export const LODS = ["lod0", "lod1", "lod2"];

export const ROLE_SPECS = {
  marshal: { displayNames: { red: "帅", black: "将" }, budgets: [60000, 18000, 5000] },
  advisor: { displayNames: { red: "仕", black: "士" }, budgets: [48000, 14000, 4000] },
  elephant: { displayNames: { red: "相", black: "象" }, budgets: [72000, 22000, 6000] },
  chariot: { displayNames: { red: "俥", black: "車" }, budgets: [68000, 20000, 5000] },
  horse: { displayNames: { red: "傌", black: "馬" }, budgets: [65000, 20000, 5000] },
  cannon: { displayNames: { red: "炮", black: "砲" }, budgets: [55000, 16000, 4000] },
  soldier: { displayNames: { red: "兵", black: "卒" }, budgets: [38000, 10000, 3000] },
};

export const ROLE_NAMES = Object.keys(ROLE_SPECS);

export const CLIP_CONTRACT = {
  idle_loop: { clip: "idle_loop", loop: true, markers: [] },
  move_start: { clip: "move_start", loop: false, markers: [{ name: "prepare", at: 0.2 }] },
  move_loop: {
    clip: "move_loop",
    loop: true,
    markers: [{ name: "contact_left", at: 0.25 }, { name: "contact_right", at: 0.75 }],
  },
  move_end: { clip: "move_end", loop: false, markers: [{ name: "settle", at: 0.82 }] },
  attack_primary: {
    clip: "attack_primary",
    loop: false,
    markers: [{ name: "telegraph", at: 0.25 }, { name: "release", at: 0.58 }, { name: "recover", at: 0.88 }],
  },
  hit_react: {
    clip: "hit_react",
    loop: false,
    markers: [{ name: "impact", at: 0.25 }, { name: "recover", at: 0.86 }],
  },
  destroy: {
    clip: "destroy",
    loop: false,
    markers: [{ name: "fracture", at: 0.38 }, { name: "vanish", at: 0.78 }, { name: "complete", at: 1 }],
  },
};

function roleManifest(role, spec, metrics) {
  const lods = Object.fromEntries(LODS.map((lod) => [lod, `/models/pieces/v1/${role}/${role}-${lod}.glb`]));
  return {
    displayNames: spec.displayNames,
    source: {
      blend: `assets/characters/${role}/source/${role}.blend`,
      metadata: `assets/characters/${role}/${role}.asset.json`,
      rawLods: Object.fromEntries(LODS.map((lod) => [lod, `assets/characters/${role}/exports/${role}-${lod}-raw.glb`])),
    },
    dimensions: {
      baseDiameter: 0.89,
      maxFootprint: metrics?.maxFootprint ?? 0,
      approximateHeight: metrics?.height ?? 0,
    },
    lodBudgets: Object.fromEntries(LODS.map((lod, index) => [lod, {
      triangles: spec.budgets[index],
      textureMax: [2048, 1024, 512][index],
    }])),
    requiredNodes: [
      "piece_root", "rig_root", "character_mesh", "socket_attack_origin",
      "socket_hit_center", "socket_ground", "socket_trail_start", "socket_trail_end",
    ],
    clips: CLIP_CONTRACT,
    variants: {
      red: { palette: "red", emblem: "qin-cinnabar-command-seal", lods },
      black: { palette: "black", emblem: "qin-verdigris-command-seal", lods },
    },
  };
}

export function createManifest(metrics = {}) {
  return {
    schema: "xiangqi-piece-assets/v1",
    version: 1,
    coordinateSystem: { units: "meter", up: "+Y", forward: "+Z", origin: "base-bottom-center" },
    textureCompression: {
      status: "not-applicable-no-bitmap-textures",
      bitmapTextureCount: 0,
      policy: "When bitmap textures are introduced, BaseColor uses ETC1S and normal/ORM use UASTC with mipmaps.",
    },
    geometryCompression: "EXT_meshopt_compression",
    vertexColorEncoding: {
      attribute: "COLOR_0",
      accessorType: "VEC3",
      classifier: "nearest authored RGB reference within squared distance 0.00018",
      referenceColors: {
        faction_cloth_primary: ["#400503", "#300402"],
        faction_cloth_secondary: ["#110202", "#0e0202"],
        faction_trim: ["#612e09", "#472409"],
        aged_bronze: ["#291406", "#1d1107"],
      },
      nonFactionPolicy: "RGB values outside the semantic tolerance remain unchanged",
      materialPattern: "{role}_terracotta_vertex_palette",
    },
    factions: {
      red: {
        displayName: "红方",
        emblem: "qin-cinnabar-command-seal",
        palette: {
          faction_cloth_primary: "#803024", faction_cloth_secondary: "#351713",
          faction_trim: "#a8763b", aged_bronze: "#6b4027", energy: "#d7a35d",
        },
      },
      black: {
        displayName: "黑方",
        emblem: "qin-verdigris-command-seal",
        palette: {
          faction_cloth_primary: "#284e43", faction_cloth_secondary: "#122621",
          faction_trim: "#688a72", aged_bronze: "#3f5d50", energy: "#9dc8ae",
        },
      },
    },
    roles: Object.fromEntries(
      ROLE_NAMES.map((role) => [role, roleManifest(role, ROLE_SPECS[role], metrics[role])]),
    ),
  };
}
