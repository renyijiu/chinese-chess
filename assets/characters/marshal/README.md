# Marshal runtime asset

`source/marshal.blend` is the editable Blender 5.2 runtime adapter. The three
files under `exports` are uncompressed authoring exports; the web application
must load the Meshopt-compressed files referenced by
`public/models/pieces/v1/manifest.json`.

All three are generated from the sculpted Q-version commander in
`assets/models/red-marshal-terracotta-cartoon-v3.glb`: twin-tailed crown with a
jade seal, lamellar cuirass and tassets, banded sleeves, and both hands resting
on a jade-hilted sword. Change the character there, not here.

The runtime mesh uses one opaque `marshal_terracotta_vertex_palette` material.
`COLOR_0` holds the palette, with exact reference colors on the regions the
runtime remaps per faction, and `_SHADE` holds the baked clay shading for those
regions. See [`../README.md`](../README.md) for the shared contract.
