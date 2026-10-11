# Xiangqi character asset contract

> **Status:** This directory is the runtime derivative layer generated from the
> authoritative sculpted Qin-terracotta Q roster documented in
> [`../models/README.md`](../models/README.md). The research GLBs provide the
> geometry, palette and baked shading; this layer adds LODs, rigging, actions,
> sockets, faction masks and runtime packaging.

Character sources are organized as `assets/characters/{role}/source`, with raw
exports in the sibling `exports` directory. Runtime GLBs are generated into
`public/models/pieces/v1` and described by its versioned manifest.

All pieces use meters, Y-up and +Z-forward after glTF export. The bottom center
of the circular base is the origin. Every role is scaled by one factor so its
plinth is 0.89 m across; height follows from the sculpt, so a piece keeps the
proportions it was modelled with. Source `.blend` files retain the armature,
skin weights, canonical clips, and named sockets required by the runtime.

Large source files and future texture sources are Git LFS assets. Runtime GLBs
stay in normal Git so a deployment does not require an LFS client.

Animation, recovery, and event timing are defined in
[`PRESENTATION_CONTRACT.md`](./PRESENTATION_CONTRACT.md).

## Colour and shading

The v1 roster contains seven shared-geometry families and fourteen faction
variants. `COLOR_0` is a VEC3 semantic palette: the authoritative lacquer,
jade, cinnabar and dark-detail materials become exact primary, secondary, trim
and aged-bronze masks. The red runtime targets reproduce those four research
material colors; the black targets provide the faction variant. Portrait
terracotta, fired clay, ivory, iris and ink colors remain unchanged for both
sides and arrive with their clay shading already multiplied in. Alpha is
deliberately not used because the glTF exporter writes `COLOR_0` as VEC3.

Faction masks must stay exact, so their shading travels separately in the
scalar `_SHADE` attribute and the runtime multiplies it in after the remap. A
second color set cannot do this job: Blender's glTF exporter blanks all but the
last color set mapped to a material.

## Rigging

The source marks every sculpted island with the part that carries it. Plinth,
head, weapon and mount islands follow one bone each, so faces and props never
shear; torso islands blend along the spine and sleeves blend across the elbow.
Bone positions come from the joints recorded with each source.

The checked-in `.asset.json` for every role records its exact authoritative GLB
and style family. The generated `.blend` files remain editable runtime
adapters; character design changes belong in `assets/models`, while skin-weight
and action refinements belong here.
