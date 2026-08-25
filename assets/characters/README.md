# Xiangqi character asset contract

> **Status:** This directory is the runtime derivative layer generated from the
> authoritative red Qin-terracotta cartoon research roster documented in
> [`../models/README.md`](../models/README.md). The research GLBs provide the
> geometry and appearance; this layer adds LODs, rigging, actions, sockets,
> faction masks and runtime packaging.

Character sources are organized as `assets/characters/{role}/source`, with raw
exports in the sibling `exports` directory. Runtime GLBs are generated into
`public/models/pieces/v1` and described by its versioned manifest.

All pieces use meters, Y-up and +Z-forward after glTF export. The bottom center
of the circular base is the origin. Source `.blend` files retain the armature,
skin weights, canonical clips, and named sockets required by the runtime.

Large source files and future texture sources are Git LFS assets. Runtime GLBs
stay in normal Git so a deployment does not require an LFS client.

Animation, recovery, and event timing are defined in
[`PRESENTATION_CONTRACT.md`](./PRESENTATION_CONTRACT.md).

The v1 roster contains seven shared-geometry families and fourteen faction
variants. `COLOR_0` is a VEC3 semantic palette: the authoritative lacquer,
jade, cinnabar and dark-detail materials become exact primary, secondary, trim
and aged-bronze masks. The red runtime targets reproduce those four research
material colors; the black targets provide the faction variant. Portrait
terracotta, fired clay, ivory and iris colors remain unchanged for both sides.
Alpha is deliberately not used because the glTF exporter writes `COLOR_0` as
VEC3.

The checked-in `.asset.json` for every role records its exact authoritative GLB
and source commit. The generated `.blend` files remain editable runtime
adapters; character design changes belong in `assets/models`, while skin-weight
and action refinements belong here.
