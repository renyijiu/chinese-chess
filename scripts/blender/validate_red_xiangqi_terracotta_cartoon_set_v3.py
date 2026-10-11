"""Validate one sculpted V3 role: BLEND master, GLB export and studio renders agree."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
STYLE_FAMILY = "red-xiangqi-qin-terracotta-cartoon-v3"
PARTS = ("static", "body", "head", "arm", "weapon", "mount")
PART_SLOTS = 16
BASE_RADIUS = 1.08
# Uniform runtime scaling maps the 2.16-unit plinth to 0.89 m; nothing may reach 0.98 m.
MAX_HORIZONTAL_EXTENT = 2.36
ROLE_DATA = {
    "marshal": {"title": "Marshal", "glyph": "帅", "triangles": (40_000, 70_000), "zmax": (3.3, 3.5), "parts": {"static", "body", "head", "arm", "weapon"}},
    "advisor": {"title": "Advisor", "glyph": "仕", "triangles": (30_000, 56_000), "zmax": (2.7, 2.95), "parts": {"static", "body", "head", "arm", "weapon"}},
    "elephant": {"title": "Elephant", "glyph": "相", "triangles": (40_000, 82_000), "zmax": (2.0, 2.3), "parts": {"static", "mount"}},
    "chariot": {"title": "Chariot", "glyph": "车", "triangles": (40_000, 78_000), "zmax": (2.4, 2.65), "parts": {"static", "body", "head", "arm", "mount"}},
    "horse": {"title": "Horse", "glyph": "马", "triangles": (40_000, 74_000), "zmax": (2.95, 3.2), "parts": {"static", "body", "head", "arm", "mount"}},
    "cannon": {"title": "Cannon", "glyph": "炮", "triangles": (30_000, 64_000), "zmax": (2.05, 2.5), "parts": {"static", "body", "head", "arm", "mount"}},
    "soldier": {"title": "Soldier", "glyph": "兵", "triangles": (24_000, 44_000), "zmax": (3.35, 3.5), "parts": {"static", "body", "head", "arm", "weapon"}},
}
PALETTE = {
    "Warm terracotta vinyl": (0.55, 0.205, 0.085),
    "Soft portrait terracotta": (0.62, 0.285, 0.12),
    "Deep brown hair and details": (0.105, 0.052, 0.031),
    "Deep brown lacquer armour": (0.145, 0.067, 0.038),
    "Cinnabar red trim": (0.55, 0.07, 0.028),
    "Polished jade green": (0.16, 0.43, 0.30),
    "Warm ivory eye white": (0.88, 0.76, 0.56),
    "Chestnut brown iris": (0.29, 0.105, 0.025),
    "Thick fired-clay plinth": (0.44, 0.145, 0.055),
    "Ink black pupil and lash": (0.014, 0.009, 0.007),
}
FACTION_MATERIALS = ("Deep brown lacquer armour", "Cinnabar red trim", "Deep brown hair and details")


def fail(message: str):
    raise RuntimeError(message)


def requested_role() -> str:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(arguments) != 1 or arguments[0] not in ROLE_DATA:
        fail(f"Pass exactly one role after --; expected one of {sorted(ROLE_DATA)}")
    return arguments[0]


def mesh_summary(obj) -> dict:
    mesh = obj.data
    mesh.calc_loop_triangles()
    coords = np.zeros(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)
    world = np.array(obj.matrix_world, dtype=np.float64)
    coords = coords @ world[:3, :3].T + world[:3, 3]
    return {"triangles": len(mesh.loop_triangles), "min": coords.min(axis=0), "max": coords.max(axis=0)}


def base_color(material):
    """Colour factor of a material whose Base Color may be multiplied by a colour attribute."""
    name = material.name.split(".")[0]
    bsdf = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes else None
    if bsdf is None:
        fail(f"Material lacks Principled BSDF: {name}")
    socket = bsdf.inputs["Base Color"]
    if not socket.is_linked:
        return tuple(socket.default_value[:3])
    node = socket.links[0].from_node
    for candidate in node.inputs:
        if candidate.type == "RGBA" and not candidate.is_linked and candidate.name != "Factor":
            return tuple(candidate.default_value[:3])
    fail(f"Cannot read the colour factor of {name}")


def sample_image_content(image):
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)[::16, ::16]
    luminance = 0.2126 * pixels[..., 0] + 0.7152 * pixels[..., 1] + 0.0722 * pixels[..., 2]
    chroma = pixels[..., :3].max(axis=2) - pixels[..., :3].min(axis=2)
    return float(luminance.max() - luminance.min()), float((chroma > 0.06).mean())


role = requested_role()
spec = ROLE_DATA[role]
name = f"red-{role}-terracotta-cartoon-v3"
blend_path = ROOT / "assets" / "models" / f"{name}.blend"
glb_path = ROOT / "assets" / "models" / f"{name}.glb"
if Path(bpy.data.filepath).resolve() != blend_path.resolve():
    fail(f"Validator for {role} must open {blend_path}, got {bpy.data.filepath}")

masters = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.get("source_style_family") == STYLE_FAMILY]
if len(masters) != 1:
    fail(f"{role}: expected one sculpted master mesh, found {len(masters)}")
master = masters[0]
expected_properties = {
    "source_role": role,
    "source_glyph": spec["glyph"],
    "source_glyph_kind": "cjk_font_outline",
    "source_glyph_codepoint": ord(spec["glyph"]),
    "source_construction": "sculpted_distance_field_islands",
    "source_character_proportion": "2.25-head",
}
for key, expected in expected_properties.items():
    if master.get(key) != expected:
        fail(f"{role}: BLEND property {key} is {master.get(key)!r}, expected {expected!r}")
if not isinstance(master.get("source_glyph_font_glyph_id"), int) or master["source_glyph_font_glyph_id"] <= 0:
    fail(f"{role}: master lacks a valid font glyph ID")
master_summary = mesh_summary(master)
if master_summary["triangles"] != master["source_triangle_count"]:
    fail(f"{role}: BLEND triangles {master_summary['triangles']} differ from the recorded {master['source_triangle_count']}")
# The scene is cleared before the GLB import, so keep plain copies of the master's records.
master_properties = {key: master.get(key) for key in (*expected_properties, "source_style_family", "source_triangle_count", "source_glyph_font_glyph_id")}

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(glb_path))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    fail(f"{role}: expected one GLB mesh, found {len(meshes)}")
mesh_object = meshes[0]
summary = mesh_summary(mesh_object)
if summary["triangles"] != master_summary["triangles"]:
    fail(f"{role}: GLB triangles {summary['triangles']} differ from the BLEND master {master_summary['triangles']}")
if not np.allclose(summary["min"], master_summary["min"], atol=2e-3) or not np.allclose(summary["max"], master_summary["max"], atol=2e-3):
    fail(f"{role}: GLB bounds differ from the BLEND master")
for key, recorded in master_properties.items():
    if mesh_object.get(key) != recorded:
        fail(f"{role}: GLB property {key} is {mesh_object.get(key)!r}, BLEND has {recorded!r}")

low, high = spec["triangles"]
if not low <= summary["triangles"] <= high:
    fail(f"{role}: triangle count {summary['triangles']} outside {spec['triangles']}")
minimum, maximum = summary["min"], summary["max"]
if abs(minimum[2]) > 0.03:
    fail(f"{role}: plinth must rest on z=0, got {minimum[2]:.4f}")
if not spec["zmax"][0] <= maximum[2] <= spec["zmax"][1]:
    fail(f"{role}: height {maximum[2]:.3f} outside {spec['zmax']}")
if minimum[0] > -BASE_RADIUS + 0.01 or maximum[0] < BASE_RADIUS - 0.01:
    fail(f"{role}: the 1.08-unit plinth is missing from the X bounds ({minimum[0]:.3f}, {maximum[0]:.3f})")
extent = max(maximum[0] - minimum[0], maximum[1] - minimum[1])
if extent > MAX_HORIZONTAL_EXTENT:
    fail(f"{role}: horizontal extent {extent:.3f} exceeds {MAX_HORIZONTAL_EXTENT}; it would overhang the 0.98 m footprint")

material_names = set()
for material in mesh_object.data.materials:
    material_name = material.name.split(".")[0]
    if material_name not in PALETTE:
        fail(f"{role}: unexpected material {material.name!r}")
    color = base_color(material)
    if max(abs(color[index] - PALETTE[material_name][index]) for index in range(3)) > 2e-3:
        fail(f"{role}: {material_name} colour {color} drifted from the roster palette")
    material_names.add(material_name)
missing = [material_name for material_name in FACTION_MATERIALS if material_name not in material_names]
if missing:
    fail(f"{role}: missing faction materials {missing}")

mesh = mesh_object.data
if not mesh.color_attributes:
    fail(f"{role}: GLB carries no baked shade (COLOR_0)")
shade = np.zeros(len(mesh.color_attributes[0].data) * 4, dtype=np.float32)
mesh.color_attributes[0].data.foreach_get("color", shade)
shade = shade.reshape(-1, 4)[:, 0]
if shade.min() < 0.15 or shade.max() > 1.001 or shade.std() < 0.03:
    fail(f"{role}: baked shade looks wrong (min={shade.min():.3f}, max={shade.max():.3f}, std={shade.std():.3f})")
if len(mesh.uv_layers) != 1:
    fail(f"{role}: expected exactly one rig-hint UV layer, found {len(mesh.uv_layers)}")
uv = np.zeros(len(mesh.uv_layers[0].data) * 2, dtype=np.float32)
mesh.uv_layers[0].data.foreach_get("uv", uv)
slots = np.floor(uv.reshape(-1, 2)[:, 0] * PART_SLOTS).astype(int)
if slots.min() < 0 or slots.max() >= len(PARTS):
    fail(f"{role}: rig hints contain an unknown part slot")
found_parts = {PARTS[index] for index in np.unique(slots)}
if found_parts != spec["parts"]:
    fail(f"{role}: rig parts {sorted(found_parts)} differ from the expected {sorted(spec['parts'])}")
rig = json.loads(mesh_object.get("rig_hints", "{}"))
for key in ("spine", "head", "arm", "weapon"):
    if key not in rig:
        fail(f"{role}: rig hints lack {key!r}")
if "mount" in spec["parts"] and "mount" not in rig:
    fail(f"{role}: rig hints lack the mount pivot")

for suffix in ("", "-front"):
    image_path = ROOT / "assets" / "renders" / f"{name}{suffix}.png"
    try:
        image = bpy.data.images.load(str(image_path), check_existing=False)
    except RuntimeError as error:
        raise RuntimeError(f"Missing render artifact: {image_path}") from error
    size = tuple(image.size)
    contrast, chroma = sample_image_content(image)
    bpy.data.images.remove(image)
    if size != (1200, 1400):
        fail(f"Unexpected image size for {image_path}: {size}")
    if contrast <= 0.04 or chroma < 0.02:
        fail(f"Image is blank or lacks chroma: {image_path}")

print(f"VALIDATED_ROLE={role}")
print(f"VALIDATED_GLB={glb_path}")
print(f"TRIANGLES={summary['triangles']}")
print(f"MATERIALS={len(material_names)}")
print(f"PARTS={','.join(sorted(found_parts))}")
print(f"BOUNDS_MIN={tuple(round(float(value), 4) for value in minimum)}")
print(f"BOUNDS_MAX={tuple(round(float(value), 4) for value in maximum)}")
print(f"SHADE_RANGE=({shade.min():.3f}, {shade.max():.3f})")
