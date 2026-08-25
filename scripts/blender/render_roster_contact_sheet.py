"""Render the deterministic Qin-terracotta red/black roster review sheet."""

import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
ROLES = ("marshal", "advisor", "elephant", "chariot", "horse", "cannon", "soldier")
OUTPUT = ROOT / "assets/characters/reviews/roster-contact-sheet-qin-terracotta.png"
SEMANTIC_REFERENCES = {
    "primary": (0.25, 0.018, 0.01),
    "secondary": (0.065, 0.008, 0.006),
    "trim": (0.38, 0.18, 0.035),
    "bronze": (0.16, 0.078, 0.025),
}
MANIFEST = json.loads((ROOT / "public/models/pieces/v1/manifest.json").read_text())
PALETTE_KEYS = {
    "primary": "faction_cloth_primary",
    "secondary": "faction_cloth_secondary",
    "trim": "faction_trim",
    "bronze": "aged_bronze",
}
PALETTE_HEX = {
    side: {
        region: int(MANIFEST["factions"][side]["palette"][manifest_key].removeprefix("#"), 16)
        for region, manifest_key in PALETTE_KEYS.items()
    }
    for side in ("red", "black")
}


def srgb_channel_to_linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def linear_rgb(value):
    return tuple(srgb_channel_to_linear(((value >> shift) & 0xFF) / 255) for shift in (16, 8, 0))


PALETTES = {
    side: {region: linear_rgb(value) for region, value in palette.items()}
    for side, palette in PALETTE_HEX.items()
}


def look_at(object_, target):
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()


def review_material(side):
    material = bpy.data.materials.new(f"review_{side}")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = "Color"
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 42
    noise.inputs["Detail"].default_value = 5
    noise.inputs["Roughness"].default_value = 0.78
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.035
    shader.inputs["Roughness"].default_value = 0.94
    shader.inputs["Metallic"].default_value = 0.04
    links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs[0], output.inputs[0])
    return material


def recolor_faction(mesh, side):
    """Mirror the runtime nearest-RGB semantic remap, preserving all natural materials."""
    color_attribute = mesh.color_attributes.active_color
    if color_attribute is None:
        raise RuntimeError(f"{mesh.name} has no active COLOR_0 import")
    for entry in color_attribute.data:
        original = tuple(entry.color[:3])
        nearest_name = min(
            SEMANTIC_REFERENCES,
            key=lambda name: sum((original[index] - SEMANTIC_REFERENCES[name][index]) ** 2 for index in range(3)),
        )
        nearest = SEMANTIC_REFERENCES[nearest_name]
        distance = sum((original[index] - nearest[index]) ** 2 for index in range(3))
        if distance <= 0.00018:
            replacement = PALETTES[side][nearest_name]
            entry.color = (*replacement, 1.0)


def label(text, location, color):
    curve = bpy.data.curves.new(f"label_{text}", "FONT")
    curve.body = text
    curve.align_x = "CENTER"
    curve.size = 0.12
    curve.extrude = 0.002
    object_ = bpy.data.objects.new(f"label_{text}", curve)
    bpy.context.scene.collection.objects.link(object_)
    object_.location = location
    object_.rotation_euler = (1.5708, 0, 0)
    material = bpy.data.materials.new(f"label_material_{text}")
    material.diffuse_color = color
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    material.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = color
    material.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.35
    curve.materials.append(material)


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
red_material = review_material("red")
black_material = review_material("black")

for column, role in enumerate(ROLES):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f"assets/characters/{role}/exports/{role}-lod1-raw.glb"))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    source = next(obj for obj in imported if obj.name.startswith("character_mesh"))
    for side, row_z, material in (("red", 2.35, red_material), ("black", 0.25, black_material)):
        piece = source.copy()
        piece.data = source.data.copy()
        piece.animation_data_clear()
        piece.modifiers.clear()
        piece.name = f"review_{side}_{role}"
        piece.location = ((column - 3) * 1.12, 0, row_z)
        piece.rotation_euler[2] = -0.32
        recolor_faction(piece.data, side)
        piece.data.materials.clear()
        piece.data.materials.append(material)
        bpy.context.scene.collection.objects.link(piece)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    label(role.upper(), ((column - 3) * 1.12, -0.02, -0.03), (0.73, 0.68, 0.59, 1))

label("RED FACTION", (0, -0.02, 4.05), (0.8, 0.2, 0.08, 1))
label("BLACK FACTION", (0, -0.02, 1.96), (0.15, 0.55, 0.4, 1))

backdrop_material = bpy.data.materials.new("warm_neutral_backdrop")
backdrop_material.diffuse_color = (0.035, 0.028, 0.024, 1)
backdrop_material.use_nodes = True
backdrop_material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.035, 0.028, 0.024, 1)
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0.45, 2.0), rotation=(1.5708, 0, 0))
bpy.context.object.data.materials.append(backdrop_material)

bpy.ops.object.light_add(type="AREA", location=(-3.5, -4, 6))
bpy.context.object.data.energy = 1150
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 5
look_at(bpy.context.object, (0, 0, 1.7))
bpy.ops.object.light_add(type="AREA", location=(4, -2, 3))
bpy.context.object.data.energy = 420
bpy.context.object.data.size = 4
look_at(bpy.context.object, (0, 0, 1.6))
bpy.ops.object.light_add(type="AREA", location=(0, 2, 5))
bpy.context.object.data.energy = 550
bpy.context.object.data.size = 3
look_at(bpy.context.object, (0, 0, 2))

bpy.ops.object.camera_add(location=(0, -14, 2.1))
camera = bpy.context.object
look_at(camera, (0, 0, 2.05))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 9.8
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 2800
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = False
scene.render.filepath = str(OUTPUT)
scene.render.image_settings.color_mode = "RGBA"
scene.world.color = (0.018, 0.014, 0.012)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"XIANGQI_REVIEW output={OUTPUT} roles={len(ROLES)} variants={len(ROLES) * 2}")
