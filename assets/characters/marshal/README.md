# Marshal vertical slice

`source/marshal.blend` is the editable Blender 5.2 source. The three files under
`exports` are uncompressed authoring exports; the web application must load the
Meshopt-compressed files referenced by `public/models/pieces/v1/manifest.json`.

This deterministic procedural model establishes the runtime contract and the
realistic bronze/vermilion military-figurine direction. It follows the supplied
six-view silhouette — adult proportions, broad ceremonial robe, lamellar armour,
narrow crown, beard, command sword, and heavy round plinth — but does not claim
the facial anatomy, embroidery, cloth folds, or surface weathering of a manually
sculpted film-quality hero asset.

The runtime mesh uses one opaque `marshal_vertex_palette` material. Authored
solid colors are baked into `COLOR_0.rgb`; `COLOR_0.a` carries stable semantic
region codes used by the runtime faction shader to map the same geometry to the
red or black palette without adding material primitives or draw calls.
