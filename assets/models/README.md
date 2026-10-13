# Research character models

The sculpted red Qin-terracotta Q roster (V3) in this directory is the
authoritative appearance source for all seven piece roles:

- `red-{marshal,advisor,elephant,chariot,horse,cannon,soldier}-terracotta-cartoon-v3.{blend,glb}`

V3 keeps the 2.25-head toy proportions, layouts and material names of the
earlier stacked-primitive roster and changes how the figures are made. Each
painted part is a clay mass sculpted as a signed-distance field (soft joins,
carved features, lamellar relief), meshed on its own so colour borders stay
crisp, and shaded from the same field. Heads, hands, cloth and armour are no
longer assembled from spheres and boxes.

The `.blend` files are the editable research masters. Their sibling `.glb`
files and the matching images under `assets/renders` are research exports and
reproducibility evidence. They are not loaded by the game.

The earlier `*-terracotta-cartoon-v1` / `red-marshal-terracotta-cartoon-v2`
files and the older marshal studies stay in the repository as history and for
the before/after review sheets; nothing in the build reads them.

## Building

```bash
python3 scripts/blender/build_red_xiangqi_terracotta_cartoon_set_v3.py
```

This sculpts, renders, exports and validates every role. It requires Blender
5.2 (or `BLENDER_BIN`) with its bundled numpy and OpenVDB, and a CJK-capable
font; set `TERRACOTTA_FONT_PATH` when the platform defaults do not cover the
Chinese piece glyphs. Useful switches:

- `XIANGQI_SOURCE_ROLES=soldier,horse` builds a subset.
- `XIANGQI_SCULPT_VOXEL=0.01` trades detail for speed while iterating.
- `XIANGQI_SCULPT_PREVIEW=/some/dir` writes board-lit review sheets (including
  a before/after against the previous source) instead of exporting.

The sculpting code lives in `scripts/blender/terracotta_sdf.py` (distance-field
toolkit), `terracotta_figures.py` (heads, hands, cloth and armour helpers) and
`terracotta_mesh.py` (meshing, baked shading, props and review renders).

## What a source GLB carries

- Ten named materials. Four of them are the faction masks the runtime remaps
  (`Deep brown lacquer armour`, `Polished jade green`, `Cinnabar red trim`,
  `Deep brown hair and details`); the rest keep their colour on both sides.
- `COLOR_0`: baked clay shading (occlusion and kiln mottling), multiplied into
  each material's base colour.
- `TEXCOORD_0.u`: the rig part of every island (`static`, `body`, `head`,
  `arm`, `weapon`, `mount`).
- Node extras: role, glyph, style family, plinth radius and `rig_hints`, the
  joints the runtime adapter builds its skeleton from.

## Provenance lock

`authoritative-piece-sources.lock.json` pins the SHA-256 of every source GLB,
BLEND master and raw LOD export. After a deliberate rebuild:

```bash
npm run assets:pieces:lock -- --sources   # re-pin the sources
npm run assets:pieces:build -- --skip-validation
npm run assets:pieces:lock                # re-pin the raw LOD exports
npm run assets:pieces:validate
```

Builds and runtime code must not depend on a maintainer workstation path.

## Runtime boundary

`assets/characters/**` and `public/models/pieces/**` are generated runtime
derivatives of this roster. They are not the visual authority: the adapter
scales the source uniformly onto the 0.89 m plinth, simplifies it per LOD and
adds the armature, skin weights, canonical animation clips, named sockets,
faction masks, validation metadata and Meshopt packaging. Do not copy these
research GLBs directly into `public/models`; run the piece asset pipeline so
the runtime contract is preserved.
