# Research character models

The red Qin-terracotta cartoon roster in this directory is the authoritative
appearance source for future character work:

- `red-marshal-terracotta-cartoon-v2.{blend,glb}`
- `red-{advisor,elephant,chariot,horse,cannon,soldier}-terracotta-cartoon-v1.{blend,glb}`

The `.blend` files are the editable research masters. Their sibling `.glb`
files, the matching images under `assets/renders`, and the scripts under
`scripts/blender` are research exports and reproducibility evidence. They are
not loaded by the game.

## Provenance

- Source commit: `96cadeb`
- Imported from: `/Users/renyijiu/.codex/worktrees/44eb/chinese-chess`

The absolute path is retained only as an import record. Builds and runtime code
must not depend on that worktree.

## Runtime boundary

`assets/characters/**` and `public/models/pieces/**` are generated runtime
derivatives of this roster. They are not the visual authority: the adapter adds
topology/LOD treatment, armature and skin weights, canonical animation clips,
named sockets, faction masks, validation metadata, and Meshopt packaging. Do
not copy these research GLBs directly into `public/models`; run the piece asset
pipeline so the runtime contract is preserved.

The research pipelines are:

```bash
python3 scripts/blender/build_red_marshal_terracotta_cartoon_v2.py
python3 scripts/blender/build_red_xiangqi_terracotta_cartoon_set_v1.py
```

They require Blender (or `BLENDER_BIN`), Pillow, and a CJK-capable font. Set
`TERRACOTTA_FONT_PATH` when the platform defaults do not cover the required
Chinese piece glyphs.
