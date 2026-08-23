# Xiangqi character asset contract

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
variants. `COLOR_0` is a VEC3 semantic palette: nearest authored faction cloth,
trim, and bronze colors are remapped at runtime, while skin, elephant hide,
horse hide, leather, wood, ivory, hair, iron, and stone remain unchanged. Alpha
is deliberately not used because the glTF exporter writes `COLOR_0` as VEC3.

`reviews/roster-contact-sheet-red-black.png` is the fixed-camera U6 review for
the six post-marshal families. These deterministic procedural assets are a
realistic tabletop-figurine baseline, not a substitute for a later manual hero
sculpt, baked normal detail, embroidery, cloth microfolds, or authored wear.
