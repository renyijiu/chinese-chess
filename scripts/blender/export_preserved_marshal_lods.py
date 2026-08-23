"""Re-export authoring GLBs from the accepted marshal source.

The roster generator intentionally does not replace the accepted hero runtime
asset. This helper only rebuilds inspectable, uncompressed authoring LODs from
the editable ``marshal.blend`` when those files need refreshing.
"""

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / "assets/characters/marshal/source/marshal.blend"
EXPORTS = ROOT / "assets/characters/marshal/exports"
TARGET_RATIOS = {"lod0": 1.0, "lod1": 9260 / 17614, "lod2": 4612 / 17614}


def export(lod, ratio):
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    character = bpy.data.objects["character_mesh"]
    if ratio < 1:
        bpy.context.view_layer.objects.active = character
        character.select_set(True)
        modifier = character.modifiers.new(f"{lod}_preserved_decimation", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    EXPORTS.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORTS / f"marshal-{lod}-raw.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_materials="EXPORT",
        export_texcoords=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_reset_pose_bones=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    character.data.calc_loop_triangles()
    print(f"PRESERVED_MARSHAL role=marshal lod={lod} triangles={len(character.data.loop_triangles)}")


for current_lod, current_ratio in TARGET_RATIOS.items():
    export(current_lod, current_ratio)
