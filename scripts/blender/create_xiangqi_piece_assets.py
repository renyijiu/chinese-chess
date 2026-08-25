"""Adapt the authoritative Qin-terracotta roster to the runtime contract.

The repository-owned research GLBs under ``assets/models`` are the geometry
and appearance authority. This script normalizes, simplifies, vertex-colors,
rigs and animates those meshes for the game without replacing their designs
with the older procedural runtime placeholders.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = Path(os.environ.get("XIANGQI_ASSET_OUTPUT_ROOT", ROOT)).resolve()
ROLES = ("marshal", "advisor", "elephant", "chariot", "horse", "cannon", "soldier")
GENERATED_ROLES = ROLES
DISPLAY_NAMES = {
    "marshal": {"red": "帅", "black": "将"},
    "advisor": {"red": "仕", "black": "士"},
    "elephant": {"red": "相", "black": "象"},
    "chariot": {"red": "俥", "black": "車"},
    "horse": {"red": "傌", "black": "馬"},
    "cannon": {"red": "炮", "black": "砲"},
    "soldier": {"red": "兵", "black": "卒"},
}
SOURCE_COMMIT = "96cadeb"
AUTHORITATIVE_MODEL_FILES = {
    role: (
        f"assets/models/red-{role}-terracotta-cartoon-v2.glb"
        if role == "marshal"
        else f"assets/models/red-{role}-terracotta-cartoon-v1.glb"
    )
    for role in ROLES
}
CONTRACT_DIMENSIONS = {
    "marshal": {"footprint": 0.8900, "height": 1.6830},
    "advisor": {"footprint": 0.8900, "height": 1.4802},
    "elephant": {"footprint": 0.9431, "height": 1.2320},
    "chariot": {"footprint": 0.8900, "height": 1.1900},
    "horse": {"footprint": 0.9054, "height": 1.7394},
    "cannon": {"footprint": 0.9400, "height": 0.9000},
    "soldier": {"footprint": 0.8900, "height": 1.5701},
}
LOD_TRIANGLE_BUDGETS = {
    "marshal": {"lod0": 60000, "lod1": 18000, "lod2": 5000},
    "advisor": {"lod0": 48000, "lod1": 14000, "lod2": 4000},
    "elephant": {"lod0": 72000, "lod1": 22000, "lod2": 6000},
    "chariot": {"lod0": 68000, "lod1": 20000, "lod2": 5000},
    "horse": {"lod0": 65000, "lod1": 20000, "lod2": 5000},
    "cannon": {"lod0": 55000, "lod1": 16000, "lod2": 4000},
    "soldier": {"lod0": 38000, "lod1": 10000, "lod2": 3000},
}
LOD_TARGET_FRACTIONS = {"lod0": 0.94, "lod1": 0.90, "lod2": 0.88}
SEMANTIC_REFERENCE_COLORS = {
    "faction_cloth_primary": (0.25, 0.018, 0.01),
    "faction_cloth_secondary": (0.065, 0.008, 0.006),
    "faction_trim": (0.38, 0.18, 0.035),
    "aged_bronze": (0.16, 0.078, 0.025),
}
# Imported material names are stable parts of the authoritative research
# contract. Faces and fired clay remain untouched; armour and accents carry
# the four exact runtime faction masks.
SEMANTIC_MATERIAL_TOKENS = (
    ("deep brown lacquer armour", "faction_cloth_primary"),
    ("polished jade green", "faction_cloth_secondary"),
    ("cinnabar red trim", "faction_trim"),
    ("deep brown hair and details", "aged_bronze"),
)
VISUAL_INTENT = {
    "marshal": ["Qin terracotta general", "double-tail officer headdress", "command sword and broad lamellar mantle"],
    "advisor": ["Qin command officer", "bamboo slips and bronze tiger tally", "layered robe beneath lamellar collar"],
    "elephant": ["terracotta ceremonial elephant", "Qin patterned barding and command tower", "clay tusks and lowered trunk"],
    "chariot": ["Qin terracotta war chariot", "large clay-and-bronze wheels", "armoured driver and high rear guard"],
    "horse": ["terracotta Qin cavalry", "armoured horse and mounted lancer", "compact topknot silhouette"],
    "cannon": ["Qin heavy siege crossbow", "bronze bolt and torsion stock", "two kneeling terracotta operators; no gunpowder"],
    "soldier": ["Qin terracotta infantry", "long spear and rectangular lamellar armour", "right-side topknot and grounded stance"],
}
LOD_SETTINGS = {
    "lod0": {"segments": 36, "sphere_segments": 30, "detail": 3},
    "lod1": {"segments": 22, "sphere_segments": 18, "detail": 2},
    "lod2": {"segments": 12, "sphere_segments": 10, "detail": 1},
}
CLIP_NAMES = (
    "idle_loop", "move_start", "move_loop", "move_end", "attack_primary", "hit_react", "destroy",
)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(block):
            block.remove(item)


def pbr_material(name: str, color, roughness: float, metallic: float = 0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.use_backface_culling = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material


def make_materials():
    return {
        "stone": pbr_material("compacted_qin_tomb_soil", (0.055, 0.043, 0.032, 1.0), 0.99),
        # These four exact RGB values are semantic faction masks. Runtime maps
        # them to weathered cinnabar or verdigris; they are not glossy cloth.
        "bronze": pbr_material("faction_armor_mask", (0.16, 0.078, 0.025, 1.0), 0.91, 0.04),
        "iron": pbr_material("charred_fired_clay", (0.105, 0.071, 0.048, 1.0), 0.985),
        "cloth": pbr_material("faction_pigment_primary", (0.25, 0.018, 0.01, 1.0), 0.94),
        "cloth_dark": pbr_material("faction_pigment_secondary", (0.065, 0.008, 0.006, 1.0), 0.97),
        "trim": pbr_material("faction_seal_mask", (0.38, 0.18, 0.035, 1.0), 0.9, 0.05),
        "skin": pbr_material("warm_fired_clay", (0.345, 0.225, 0.145, 1.0), 0.97),
        "elephant": pbr_material("umber_fired_clay", (0.255, 0.19, 0.135, 1.0), 0.985),
        "horse": pbr_material("ochre_fired_clay", (0.305, 0.205, 0.125, 1.0), 0.98),
        "leather": pbr_material("burnished_clay", (0.205, 0.13, 0.08, 1.0), 0.96),
        "hair": pbr_material("clay_recess_wash", (0.065, 0.045, 0.032, 1.0), 0.99),
        "ivory": pbr_material("pale_clay", (0.43, 0.315, 0.205, 1.0), 0.98),
        "wood": pbr_material("dark_fired_clay", (0.135, 0.085, 0.052, 1.0), 0.98),
    }


def smooth(object_) -> None:
    if object_.type == "MESH":
        for polygon in object_.data.polygons:
            polygon.use_smooth = True


def apply_scale(object_) -> None:
    bpy.context.view_layer.objects.active = object_
    object_.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.select_set(False)


def bevel(object_, width: float, segments: int = 1) -> None:
    if width <= 0:
        return
    bpy.context.view_layer.objects.active = object_
    object_.select_set(True)
    modifier = object_.modifiers.new("worn forged edge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    object_.select_set(False)


def cube(name, location, scale, material, edge=0.004, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    object_ = bpy.context.object
    object_.name = name
    object_.scale = scale
    apply_scale(object_)
    bevel(object_, edge, 2 if edge > 0.003 else 1)
    object_.data.materials.append(material)
    smooth(object_)
    return object_


def cylinder(name, location, radius, depth, material, vertices, edge=0.003, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    object_ = bpy.context.object
    object_.name = name
    bevel(object_, edge, 2 if vertices >= 22 else 1)
    object_.data.materials.append(material)
    smooth(object_)
    return object_


def cone(name, location, radius1, radius2, depth, material, vertices, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location, rotation=rotation)
    object_ = bpy.context.object
    object_.name = name
    object_.data.materials.append(material)
    smooth(object_)
    return object_


def sphere(name, location, scale, material, segments, rings=None, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings or max(6, segments // 2), location=location, rotation=rotation)
    object_ = bpy.context.object
    object_.name = name
    object_.scale = scale
    apply_scale(object_)
    object_.data.materials.append(material)
    smooth(object_)
    return object_


def torus(name, location, major_radius, minor_radius, material, segments, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius, major_segments=segments, minor_segments=max(5, segments // 4), location=location, rotation=rotation)
    object_ = bpy.context.object
    object_.name = name
    object_.data.materials.append(material)
    smooth(object_)
    return object_


def cylinder_between(name, start, end, radius, material, vertices, edge=0.002):
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(start_vector + end_vector) * 0.5)
    object_ = bpy.context.object
    object_.name = name
    object_.rotation_mode = "QUATERNION"
    object_.rotation_quaternion = direction.to_track_quat("Z", "Y")
    object_.data.materials.append(material)
    bevel(object_, edge, 1)
    smooth(object_)
    return object_


def cone_between(name, start, end, radius_start, radius_end, material, vertices):
    """Create a tapered organic segment between two points."""
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=(start_vector + end_vector) * 0.5,
    )
    object_ = bpy.context.object
    object_.name = name
    object_.rotation_mode = "QUATERNION"
    object_.rotation_quaternion = direction.to_track_quat("Z", "Y")
    object_.data.materials.append(material)
    smooth(object_)
    return object_


def add_rivets(prefix, points, material, sphere_segments, radius=0.012):
    for index, point in enumerate(points):
        sphere(f"{prefix}_rivet_{index}", point, (radius, radius * 0.65, radius), material, max(8, sphere_segments // 2))


def add_horse_form(materials, settings, prefix, *, body_location, body_scale, compact=False):
    """Build a rounded, non-faction horse with articulated legs and facial detail."""
    seg, sph, detail = settings["segments"], settings["sphere_segments"], settings["detail"]
    x0, y0, z0 = body_location
    hide = materials["horse"]
    sphere(f"{prefix}_body", body_location, body_scale, hide, sph)
    sphere(f"{prefix}_chest", (x0, y0 - body_scale[1] * 0.55, z0 + 0.035), (body_scale[0] * 0.82, body_scale[1] * 0.52, body_scale[2] * 1.08), hide, max(10, sph - 2))
    neck_end = (x0, y0 - body_scale[1] * 0.88, z0 + body_scale[2] * 1.75)
    cone_between(f"{prefix}_neck", (x0, y0 - body_scale[1] * 0.48, z0 + body_scale[2] * 0.4), neck_end, body_scale[0] * 0.48, body_scale[0] * 0.32, hide, max(10, seg // 2))
    sphere(f"{prefix}_head", (x0, neck_end[1] - 0.025, neck_end[2] + 0.07), (body_scale[0] * 0.43, body_scale[0] * 0.62, body_scale[0] * 0.48), hide, max(10, sph // 2), rotation=(0.18, 0, 0))
    sphere(f"{prefix}_muzzle", (x0, neck_end[1] - body_scale[0] * 0.42, neck_end[2] + 0.025), (body_scale[0] * 0.34, body_scale[0] * 0.32, body_scale[0] * 0.28), materials["leather"], max(8, sph // 2))
    for side in (-1, 1):
        cone(f"{prefix}_ear_{side}", (x0 + side * body_scale[0] * 0.22, neck_end[1] + 0.004, neck_end[2] + 0.19), body_scale[0] * 0.11, 0.004, body_scale[0] * 0.42, hide, max(7, seg // 3), (-0.1, 0, side * 0.08))
        sphere(f"{prefix}_eye_{side}", (x0 + side * body_scale[0] * 0.31, neck_end[1] - body_scale[0] * 0.37, neck_end[2] + 0.10), (0.011, 0.008, 0.011), materials["hair"], max(8, sph // 3))
    # Two tapered segments and a separate hoof make the legs read as animals rather than posts.
    leg_y = (-body_scale[1] * 0.62, body_scale[1] * 0.62)
    leg_x = body_scale[0] * 0.56
    for x_side in (-1, 1):
        for y_index, y_delta in enumerate(leg_y):
            hip = (x0 + x_side * leg_x, y0 + y_delta, z0 - body_scale[2] * 0.4)
            knee = (x0 + x_side * leg_x * 0.96, y0 + y_delta + (0.025 if y_index == 0 else -0.018), 0.39 if not compact else 0.37)
            ankle = (x0 + x_side * leg_x * 0.92, y0 + y_delta + (0.045 if y_index == 0 else -0.035), 0.25)
            cone_between(f"{prefix}_upper_leg_{x_side}_{y_index}", hip, knee, body_scale[0] * 0.18, body_scale[0] * 0.13, hide, max(8, seg // 3))
            cone_between(f"{prefix}_lower_leg_{x_side}_{y_index}", knee, ankle, body_scale[0] * 0.13, body_scale[0] * 0.09, hide, max(8, seg // 3))
            cube(f"{prefix}_hoof_{x_side}_{y_index}", (ankle[0], ankle[1] - 0.018, 0.225), (body_scale[0] * 0.12, body_scale[0] * 0.17, 0.035), materials["iron"], 0.007)
    # Mane, tail and harness retain their natural colors in both factions.
    for index in range(2 + detail):
        y = y0 - body_scale[1] * (0.28 + index * 0.16)
        z = z0 + body_scale[2] * (0.72 + index * 0.23)
        sphere(f"{prefix}_mane_{index}", (x0, y, z), (0.025, 0.07, 0.075), materials["hair"], max(8, sph // 3))
    cone_between(f"{prefix}_tail", (x0, y0 + body_scale[1] * 0.8, z0 + 0.03), (x0, y0 + body_scale[1] * 1.18, z0 - 0.18), 0.045, 0.018, materials["hair"], max(8, seg // 3))
    torus(f"{prefix}_bridle", (x0, neck_end[1] - body_scale[0] * 0.22, neck_end[2] + 0.07), body_scale[0] * 0.42, 0.009, materials["bronze"], max(10, seg // 2), (math.pi / 2, 0, 0))


def add_base(materials, settings, role):
    segments = settings["segments"]
    cylinder("base_lower", (0, 0, 0.045), 0.445, 0.09, materials["stone"], segments, 0.008)
    cylinder("base_bronze_band", (0, 0, 0.105), 0.425, 0.05, materials["bronze"], segments, 0.004)
    cylinder("base_upper", (0, 0, 0.155), 0.395, 0.07, materials["stone"], segments, 0.006)
    torus("base_trim", (0, 0, 0.195), 0.348, 0.01, materials["trim"], segments)
    inlays = max(4, settings["detail"] * 4)
    for index in range(inlays):
        angle = 2 * math.pi * index / inlays
        cube(f"{role}_base_inlay_{index}", (0.426 * math.sin(angle), -0.426 * math.cos(angle), 0.106), (0.012, 0.006, 0.016), materials["trim"], 0.001, (0, 0, -angle))


def add_clay_scars(materials, settings, prefix, *, center=(0, -0.18, 0.72), scale=1.0):
    """Add deterministic recessed seams so figures read as excavated clay."""
    if settings["detail"] < 2:
        return
    x, y, z = center
    paths = (
        ((x - 0.08 * scale, y, z + 0.12 * scale), (x - 0.035 * scale, y - 0.004, z + 0.045 * scale)),
        ((x - 0.035 * scale, y - 0.004, z + 0.045 * scale), (x + 0.025 * scale, y, z - 0.015 * scale)),
        ((x + 0.075 * scale, y, z + 0.02 * scale), (x + 0.035 * scale, y - 0.004, z - 0.055 * scale)),
    )
    for index, (start, end) in enumerate(paths):
        cylinder_between(f"{prefix}_clay_fissure_{index}", start, end, 0.0045 * scale, materials["hair"], max(6, settings["segments"] // 4), 0)


def add_human(materials, settings, *, height=1.0, robe=True, armor=True, hat="helmet", offset=(0, 0, 0)):
    """Create a grounded Qin terracotta figure with role-specific headgear."""
    x0, y0, z0 = offset
    seg = settings["segments"]
    sph = settings["sphere_segments"]
    detail = settings["detail"]
    foot_z = z0 + 0.25
    for side in (-1, 1):
        cube(f"qin_boot_{side}", (x0 + side * 0.07, y0 - 0.025, foot_z), (0.058, 0.09, 0.043), materials["leather"], 0.006)
        cone_between(f"wrapped_shin_{side}", (x0 + side * 0.07, y0, foot_z + 0.035), (x0 + side * 0.075, y0, z0 + 0.43 * height), 0.057, 0.066, materials["skin"], max(8, seg // 2))
        for wrap in range(max(2, detail)):
            cylinder(f"shin_wrap_{side}_{wrap}", (x0 + side * 0.073, y0, z0 + (0.31 + wrap * 0.045) * height), 0.064, 0.011, materials["hair"], max(8, seg // 3), 0.001)
    if robe:
        cone("qin_layered_robe", (x0, y0 + 0.01, z0 + 0.54 * height), 0.22, 0.13, 0.56 * height, materials["skin"], seg)
        cone("qin_under_robe", (x0, y0 + 0.006, z0 + 0.50 * height), 0.195, 0.12, 0.50 * height, materials["leather"], max(10, seg - 4))
        cone("weathered_command_panel", (x0, y0 - 0.16, z0 + 0.56 * height), 0.092, 0.065, 0.43 * height, materials["skin"], max(10, seg // 2), (0, 0, 0))
        cylinder("robe_hem", (x0, y0, z0 + 0.285 * height), 0.215, 0.028, materials["trim"], max(10, seg // 2), 0.003)
    else:
        cone("armored_torso", (x0, y0, z0 + 0.61 * height), 0.145, 0.175, 0.39 * height, materials["skin"], seg)
        cone("armored_skirt", (x0, y0, z0 + 0.43 * height), 0.205, 0.145, 0.22 * height, materials["leather"], seg)
    if armor:
        cube("qin_lamellar_chest", (x0, y0 - 0.135, z0 + 0.72 * height), (0.15, 0.032, 0.17 * height), materials["leather"], 0.009)
        plate_rows = max(2, detail + 1)
        for row in range(plate_rows):
            for column in range(-2, 3):
                cube(
                    f"lamellar_plate_{row}_{column}",
                    (x0 + column * 0.052, y0 - 0.171, z0 + (0.61 + row * 0.075) * height),
                    (0.023, 0.009, 0.032 * height),
                    materials["bronze"] if (row + column) % 3 == 0 else materials["skin"],
                    0.004,
                )
        for side in (-1, 1):
            for layer in range(detail):
                cube(f"shoulder_guard_{side}_{layer}", (x0 + side * (0.16 + layer * 0.025), y0, z0 + (0.76 - layer * 0.035) * height), (0.075, 0.09, 0.016), materials["bronze"] if layer == 0 else materials["skin"], 0.003, (0, -side * 0.12, 0))
    # Small surviving mineral-pigment seal: identity is legible without
    # repainting the whole excavated figure in saturated faction colour.
    cube("faction_chest_seal", (x0, y0 - 0.178, z0 + 0.72 * height), (0.052, 0.009, 0.052), materials["cloth"], 0.009, (0, 0, math.pi / 4))
    for side in (-1, 1):
        shoulder = (x0 + side * 0.13, y0, z0 + 0.74 * height)
        elbow = (x0 + side * 0.19, y0 - 0.055, z0 + 0.60 * height)
        wrist = (x0 + side * 0.16, y0 - 0.105, z0 + 0.49 * height)
        cone_between(f"upper_arm_{side}", shoulder, elbow, 0.052, 0.044, materials["leather"], max(8, seg // 2))
        cone_between(f"forearm_{side}", elbow, wrist, 0.045, 0.034, materials["skin"], max(8, seg // 2))
        sphere(f"hand_{side}", wrist, (0.036, 0.031, 0.04), materials["skin"], max(8, sph // 3))
    sphere("human_head", (x0, y0 - 0.005, z0 + 0.92 * height), (0.085, 0.073, 0.105), materials["skin"], sph)
    sphere("nose", (x0, y0 - 0.074, z0 + 0.925 * height), (0.018, 0.018, 0.026), materials["skin"], max(8, sph // 3))
    for side in (-1, 1):
        sphere(f"sculpted_ear_{side}", (x0 + side * 0.083, y0, z0 + 0.925 * height), (0.014, 0.009, 0.025), materials["skin"], max(8, sph // 3))
        cube(f"heavy_brow_{side}", (x0 + side * 0.032, y0 - 0.071, z0 + 0.965 * height), (0.024, 0.006, 0.007), materials["hair"], 0.003, (0, 0, side * -0.08))
        sphere(f"recessed_eye_{side}", (x0 + side * 0.032, y0 - 0.073, z0 + 0.95 * height), (0.008, 0.004, 0.006), materials["hair"], max(8, sph // 3))
    cube("set_mouth", (x0, y0 - 0.075, z0 + 0.895 * height), (0.032, 0.004, 0.005), materials["hair"], 0.002)
    for side in (-1, 1):
        cone_between(f"qin_moustache_{side}", (x0 + side * 0.005, y0 - 0.076, z0 + 0.91 * height), (x0 + side * 0.05, y0 - 0.071, z0 + 0.895 * height), 0.008, 0.003, materials["hair"], max(6, seg // 4))
    cone("short_beard", (x0, y0 - 0.065, z0 + 0.845 * height), 0.04, 0.012, 0.11 * height, materials["hair"], max(8, seg // 3))
    sphere("hair_cap", (x0, y0 + 0.008, z0 + 0.985 * height), (0.09, 0.076, 0.04), materials["hair"], max(8, sph // 2))
    if hat == "scholar":
        cylinder("qin_officer_cap_band", (x0, y0, z0 + 1.02 * height), 0.097, 0.07, materials["bronze"], max(12, seg // 2), 0.005)
        cube("qin_officer_cap", (x0, y0 + 0.003, z0 + 1.085 * height), (0.078, 0.062, 0.058 * height), materials["skin"], 0.014)
        cylinder("qin_officer_topknot", (x0 + 0.025, y0 + 0.005, z0 + 1.16 * height), 0.037, 0.09, materials["hair"], max(10, seg // 2), 0.004)
    elif hat == "crown":
        cylinder("general_headdress_band", (x0, y0, z0 + 1.02 * height), 0.095, 0.07, materials["bronze"], max(10, seg // 2), 0.003)
        cube("general_headdress_plate", (x0, y0 + 0.006, z0 + 1.1 * height), (0.095, 0.055, 0.07 * height), materials["skin"], 0.01)
        for side in (-1, 1):
            cone_between(f"general_headdress_tail_{side}", (x0 + side * 0.045, y0 + 0.045, z0 + 1.13 * height), (x0 + side * 0.16, y0 + 0.09, z0 + 1.01 * height), 0.025, 0.009, materials["hair"], max(8, seg // 3))
        sphere("general_topknot", (x0, y0, z0 + 1.20 * height), (0.048, 0.045, 0.055), materials["hair"], max(8, sph // 2))
    else:
        torus("qin_headband", (x0, y0, z0 + 0.995 * height), 0.091, 0.012, materials["bronze"], max(10, seg // 2), (math.pi / 2, 0, 0))
        sphere("right_side_topknot", (x0 + 0.052, y0 + 0.01, z0 + 1.075 * height), (0.048, 0.042, 0.055), materials["hair"], max(8, sph // 2))
        cylinder("topknot_binding", (x0 + 0.052, y0 + 0.01, z0 + 1.06 * height), 0.052, 0.025, materials["trim"], max(8, seg // 2), 0.002)
    add_clay_scars(materials, settings, "human", center=(x0, y0 - 0.176, z0 + 0.70 * height), scale=height)


def geometry_marshal(m, s):
    add_human(m, s, height=1.34, robe=True, armor=True, hat="crown", offset=(0, 0, 0.02))
    for side in (-1, 1):
        cone_between(f"general_mantle_{side}", (side * 0.13, 0.035, 1.1), (side * 0.25, 0.11, 0.58), 0.11, 0.17, m["skin"], max(10, s["segments"] // 2))
    cylinder_between("command_sword", (0.25, -0.08, 0.42), (0.3, -0.11, 1.18), 0.017, m["iron"], max(8, s["segments"] // 2))
    cube("sword_guard", (0.285, -0.105, 1.05), (0.065, 0.014, 0.012), m["trim"], 0.002)
    if s["detail"] >= 2:
        cylinder_between("long_beard", (0, -0.078, 1.24), (0, -0.105, 1.05), 0.032, m["hair"], max(8, s["segments"] // 3))


def geometry_advisor(m, s):
    add_human(m, s, height=1.22, robe=True, armor=False, hat="scholar", offset=(0, 0.015, 0.02))
    # Qin command officer: cross-collar, bamboo slips and tiger tally replace
    # the later-dynasty scholar fan used by the previous art direction.
    for side in (-1, 1):
        cube(f"advisor_cross_collar_{side}", (side * 0.055, -0.132, 0.89), (0.024, 0.012, 0.14), m["trim"], 0.006, (0, side * 0.34, side * 0.28))
    torus("advisor_belt", (0, 0.015, 0.66), 0.142, 0.018, m["bronze"], max(12, s["segments"] // 2))
    sphere("advisor_belt_seal", (0, -0.145, 0.66), (0.045, 0.018, 0.045), m["trim"], max(8, s["sphere_segments"] // 2))
    for index in range(5):
        cube(f"bamboo_command_slip_{index}", (-0.11 + index * 0.055, -0.19, 0.83 + (index % 2) * 0.01), (0.021, 0.012, 0.18), m["wood"], 0.004, (0, 0, -0.09 + index * 0.04))
        for notch in range(3):
            cube(f"slip_script_{index}_{notch}", (-0.11 + index * 0.055, -0.204, 0.74 + notch * 0.07), (0.009, 0.003, 0.018), m["hair"], 0.001)
    cube("tiger_tally_body", (0.2, -0.19, 0.72), (0.095, 0.02, 0.035), m["trim"], 0.009, (0, 0, 0.12))
    sphere("tiger_tally_head", (0.285, -0.19, 0.735), (0.035, 0.02, 0.03), m["trim"], max(8, s["sphere_segments"] // 2))
    torus("advisor_command_seal", (0, 0.13, 0.92), 0.15, 0.018, m["trim"], max(10, s["segments"] // 2), (math.pi / 2, 0, 0))


def geometry_elephant(m, s):
    seg, sph, detail = s["segments"], s["sphere_segments"], s["detail"]
    sphere("elephant_body", (0, 0.03, 0.62), (0.31, 0.32, 0.24), m["elephant"], sph)
    sphere("elephant_chest", (0, -0.17, 0.64), (0.27, 0.2, 0.255), m["elephant"], max(10, sph - 2))
    for x in (-0.19, 0.19):
        for y in (-0.16, 0.18):
            cone_between(f"elephant_leg_{x}_{y}", (x, y, 0.57), (x * 1.03, y, 0.265), 0.086, 0.068, m["elephant"], max(10, seg // 2))
            cylinder(f"elephant_foot_{x}_{y}", (x * 1.03, y - 0.012, 0.245), 0.079, 0.065, m["elephant"], max(10, seg // 2), 0.009)
            for toe in (-1, 0, 1):
                sphere(f"elephant_toe_{x}_{y}_{toe}", (x * 1.03 + toe * 0.026, y - 0.068, 0.235), (0.017, 0.012, 0.014), m["ivory"], max(8, sph // 3))
            torus(f"leg_band_{x}_{y}", (x, y, 0.49), 0.083, 0.011, m["bronze"], max(10, seg // 2))
    sphere("elephant_head", (0, -0.285, 0.69), (0.22, 0.18, 0.22), m["elephant"], sph)
    sphere("elephant_forehead", (0, -0.38, 0.74), (0.15, 0.105, 0.16), m["elephant"], max(10, sph - 2))
    for side in (-1, 1):
        sphere(f"ear_{side}", (side * 0.215, -0.205, 0.72), (0.12, 0.032, 0.175), m["elephant"], max(10, sph // 2), rotation=(0, side * -0.18, side * -0.09))
        sphere(f"inner_ear_{side}", (side * 0.218, -0.237, 0.72), (0.086, 0.012, 0.13), m["skin"], max(8, sph // 2), rotation=(0, side * -0.18, side * -0.09))
        sphere(f"elephant_eye_{side}", (side * 0.085, -0.438, 0.755), (0.012, 0.008, 0.012), m["hair"], max(8, sph // 3))
    trunk_points = [(0, -0.42, 0.67), (0, -0.44, 0.55), (0.012, -0.435, 0.43), (0.035, -0.405, 0.32)]
    radii = (0.065, 0.058, 0.047, 0.032)
    for index in range(len(trunk_points) - 1):
        cone_between(f"trunk_{index}", trunk_points[index], trunk_points[index + 1], radii[index], radii[index + 1], m["elephant"], max(10, seg // 2))
        torus(f"trunk_wrinkle_{index}", trunk_points[index + 1], radii[index + 1] * 0.9, 0.004, m["elephant"], max(8, seg // 3), (math.pi / 2, 0, 0))
    for side in (-1, 1):
        cone_between(f"tusk_{side}", (side * 0.11, -0.405, 0.62), (side * 0.17, -0.46, 0.42), 0.03, 0.005, m["ivory"], max(10, seg // 2))
    cube("elephant_head_armor", (0, -0.435, 0.82), (0.14, 0.018, 0.095), m["elephant"], 0.018)
    cube("elephant_command_seal", (0, -0.459, 0.82), (0.052, 0.008, 0.052), m["cloth"], 0.009, (0, 0, math.pi / 4))
    add_rivets("elephant_head", [(-0.105, -0.457, 0.86), (0.105, -0.457, 0.86), (0, -0.457, 0.76)], m["trim"], sph, 0.011)
    # Faction barding is a layer over natural elephant hide, not its replacement.
    sphere("elephant_barding", (0, 0.07, 0.76), (0.315, 0.29, 0.095), m["elephant"], max(10, sph - 2))
    for side in (-1, 1):
        cube(f"elephant_side_armor_{side}", (side * 0.3, 0.055, 0.67), (0.023, 0.22, 0.13), m["bronze"], 0.014)
    cube("howdah_floor", (0, 0.04, 0.87), (0.25, 0.22, 0.045), m["wood"], 0.004)
    for x in (-0.23, 0.23):
        for y in (-0.18, 0.18):
            cylinder_between(f"howdah_post_{x}_{y}", (x, y, 0.88), (x, y, 1.18), 0.016, m["bronze"], max(8, seg // 3))
    for side in (-1, 1):
        cube(f"howdah_side_{side}", (side * 0.245, 0.04, 1.03), (0.018, 0.22, 0.11), m["skin"], 0.004)
    if detail >= 2:
        torus("howdah_crest", (0, -0.19, 1.1), 0.12, 0.014, m["trim"], max(10, seg // 2), (math.pi / 2, 0, 0))


def geometry_chariot(m, s):
    seg, sph = s["segments"], s["sphere_segments"]
    add_horse_form(m, s, "chariot_horse", body_location=(0, -0.12, 0.49), body_scale=(0.15, 0.22, 0.14), compact=True)
    cube("chariot_horse_barding", (0, -0.10, 0.57), (0.155, 0.18, 0.035), m["horse"], 0.014)
    cube("chariot_floor", (0, 0.19, 0.5), (0.29, 0.18, 0.045), m["wood"], 0.005)
    cube("chariot_rear_guard", (0, 0.34, 0.72), (0.28, 0.035, 0.25), m["wood"], 0.018, (-0.08, 0, 0))
    cube("chariot_guard_inlay", (0, 0.301, 0.72), (0.23, 0.012, 0.19), m["skin"], 0.014, (-0.08, 0, 0))
    cube("chariot_command_seal", (0, 0.281, 0.73), (0.06, 0.008, 0.06), m["cloth"], 0.009, (-0.08, 0, math.pi / 4))
    add_rivets("chariot_guard", [(-0.21, 0.285, 0.58), (0.21, 0.285, 0.58), (-0.21, 0.285, 0.86), (0.21, 0.285, 0.86)], m["trim"], sph)
    spoke_count = max(6, s["detail"] * 4)
    for side in (-1, 1):
        torus(f"chariot_wheel_{side}", (side * 0.31, 0.18, 0.44), 0.22, 0.032, m["bronze"], seg, (0, math.pi / 2, 0))
        for spoke in range(spoke_count):
            angle = math.pi * 2 * spoke / spoke_count
            cylinder_between(f"wheel_spoke_{side}_{spoke}", (side * 0.31, 0.18, 0.44), (side * 0.31, 0.18 + math.sin(angle) * 0.18, 0.44 + math.cos(angle) * 0.18), 0.008, m["trim"], max(6, seg // 4), 0)
    for side in (-1, 1):
        cylinder_between(f"chariot_shaft_{side}", (side * 0.2, 0.16, 0.52), (side * 0.11, -0.26, 0.51), 0.014, m["bronze"], max(8, seg // 3))
    cone("driver_torso", (0, 0.18, 0.82), 0.085, 0.11, 0.29, m["skin"], max(10, seg // 2))
    cube("driver_lamellar", (0, 0.085, 0.84), (0.09, 0.018, 0.12), m["iron"], 0.01)
    for side in (-1, 1):
        cone_between(f"driver_arm_{side}", (side * 0.08, 0.14, 0.9), (side * 0.07, -0.02, 0.72), 0.032, 0.023, m["skin"], max(8, seg // 3))
    sphere("driver_head", (0, 0.17, 1.01), (0.07, 0.065, 0.08), m["skin"], max(10, sph // 2))
    sphere("driver_helmet", (0, 0.175, 1.065), (0.078, 0.07, 0.05), m["iron"], max(10, sph // 2))
    cone("driver_helmet", (0, 0.17, 1.13), 0.03, 0.006, 0.12, m["trim"], max(8, seg // 2))


def geometry_horse(m, s):
    seg, sph = s["segments"], s["sphere_segments"]
    add_horse_form(m, s, "warhorse", body_location=(0, 0.015, 0.55), body_scale=(0.25, 0.33, 0.19))
    sphere("horse_barding", (0, 0.03, 0.69), (0.265, 0.29, 0.075), m["horse"], max(10, sph - 2))
    cube("horse_command_seal", (0, -0.245, 0.70), (0.058, 0.012, 0.058), m["cloth"], 0.009, (0, 0, math.pi / 4))
    for side in (-1, 1):
        cube(f"horse_lamellar_flank_{side}", (side * 0.255, 0.045, 0.63), (0.022, 0.23, 0.115), m["bronze"], 0.014)
    torus("horse_barding_trim", (0, -0.19, 0.68), 0.16, 0.016, m["trim"], max(10, seg // 2), (math.pi / 2, 0, 0))
    cone("rider_torso", (0, 0.04, 0.98), 0.10, 0.135, 0.34, m["skin"], max(12, seg // 2))
    cube("rider_breastplate", (0, -0.075, 0.99), (0.112, 0.026, 0.14), m["iron"], 0.014)
    for row in range(max(2, s["detail"] + 1)):
        for column in (-1, 0, 1):
            cube(f"rider_plate_{row}_{column}", (column * 0.054, -0.108, 0.90 + row * 0.075), (0.024, 0.008, 0.03), m["bronze"] if column == 0 else m["iron"], 0.004)
    for side in (-1, 1):
        cone_between(f"rider_arm_{side}", (side * 0.11, 0, 1.08), (side * 0.16, -0.09, 0.88), 0.042, 0.03, m["skin"], max(8, seg // 3))
        cone_between(f"rider_leg_{side}", (side * 0.10, 0.06, 0.86), (side * 0.22, 0.08, 0.59), 0.052, 0.035, m["iron"], max(8, seg // 3))
    sphere("rider_head", (0, 0.025, 1.21), (0.078, 0.07, 0.09), m["skin"], max(8, sph // 2))
    sphere("rider_nose", (0, -0.044, 1.215), (0.016, 0.015, 0.022), m["skin"], max(8, sph // 3))
    cone("rider_beard", (0, -0.035, 1.15), 0.035, 0.006, 0.09, m["hair"], max(8, seg // 3))
    sphere("rider_helmet", (0, 0.03, 1.28), (0.095, 0.083, 0.06), m["bronze"], max(8, sph // 2))
    torus("rider_helmet_band", (0, 0.02, 1.27), 0.087, 0.009, m["trim"], max(10, seg // 2), (math.pi / 2, 0, 0))
    cone("rider_plume", (0, 0.05, 1.42), 0.045, 0.006, 0.25, m["hair"], max(8, seg // 2))
    cylinder_between("cavalry_spear", (0.19, -0.02, 0.73), (0.29, -0.16, 1.55), 0.014, m["wood"], max(8, seg // 3))
    cone("spear_head", (0.305, -0.18, 1.64), 0.045, 0.004, 0.2, m["trim"], max(8, seg // 3), (0.12, 0.1, 0))


def geometry_cannon(m, s):
    seg, sph = s["segments"], s["sphere_segments"]
    # Xiangqi's 炮 becomes a Qin heavy siege crossbow.  Its line-and-screen
    # rules remain unchanged; this removes the anachronistic gunpowder cannon.
    cube("siege_crossbow_carriage", (0, 0.08, 0.39), (0.29, 0.28, 0.07), m["wood"], 0.014)
    cube("siege_crossbow_stock", (0, -0.01, 0.62), (0.075, 0.35, 0.055), m["leather"], 0.012)
    cube("siege_crossbow_groove", (0, -0.035, 0.682), (0.024, 0.34, 0.012), m["hair"], 0.004)
    for side in (-1, 1):
        cube(f"siege_faction_panel_{side}", (side * 0.292, 0.08, 0.44), (0.018, 0.23, 0.105), m["skin"], 0.009)
        cube(f"siege_command_seal_{side}", (side * 0.314, 0.03, 0.45), (0.007, 0.05, 0.05), m["cloth"], 0.008, (math.pi / 4, 0, 0))
        torus(f"siege_wheel_{side}", (side * 0.3, 0.1, 0.39), 0.22, 0.035, m["bronze"], seg, (0, math.pi / 2, 0))
        cylinder(f"siege_hub_{side}", (side * 0.3, 0.1, 0.39), 0.055, 0.08, m["trim"], max(8, seg // 2), 0.002, (0, math.pi / 2, 0))
        for spoke in range(max(6, s["detail"] * 4)):
            angle = math.pi * 2 * spoke / max(6, s["detail"] * 4)
            cylinder_between(f"siege_spoke_{side}_{spoke}", (side * 0.3, 0.1, 0.39), (side * 0.3, 0.1 + math.sin(angle) * 0.175, 0.39 + math.cos(angle) * 0.175), 0.008, m["wood"], max(6, seg // 4), 0)
    # Layered recurved bow limbs and taut cord make the weapon readable from
    # the default oblique camera as a crossbow rather than a barrel.
    limb_points = ((-0.37, -0.25, 0.70), (-0.18, -0.29, 0.74), (0, -0.31, 0.68), (0.18, -0.29, 0.74), (0.37, -0.25, 0.70))
    for index in range(len(limb_points) - 1):
        cylinder_between(f"recurved_bow_limb_{index}", limb_points[index], limb_points[index + 1], 0.023, m["bronze"], max(8, seg // 3))
    cylinder_between("bowstring_left", limb_points[0], (0, -0.08, 0.69), 0.005, m["hair"], max(6, seg // 4), 0)
    cylinder_between("bowstring_right", limb_points[-1], (0, -0.08, 0.69), 0.005, m["hair"], max(6, seg // 4), 0)
    cylinder_between("heavy_bronze_bolt", (0, 0.26, 0.705), (0, -0.37, 0.705), 0.014, m["trim"], max(8, seg // 3))
    cone("heavy_bolt_head", (0, -0.42, 0.705), 0.045, 0.004, 0.15, m["trim"], max(8, seg // 3), (math.pi / 2, 0, 0))
    cylinder("draw_winch", (0, 0.23, 0.62), 0.07, 0.32, m["bronze"], max(10, seg // 2), 0.004, (0, math.pi / 2, 0))
    for side in (-1, 1):
        # Kneeling Qin operators, intentionally sculpted as part of the clay tableau.
        cone(f"crossbow_operator_body_{side}", (side * 0.23, 0.24, 0.62), 0.07, 0.095, 0.24, m["skin"], max(10, seg // 2), (0, 0, side * 0.12))
        cube(f"crossbow_operator_lamellar_{side}", (side * 0.23, 0.165, 0.64), (0.068, 0.018, 0.09), m["bronze"], 0.008, (0, 0, side * 0.12))
        cone_between(f"crossbow_operator_arm_{side}", (side * 0.16, 0.22, 0.68), (side * 0.10, 0.02, 0.63), 0.028, 0.019, m["skin"], max(8, seg // 3))
        sphere(f"crossbow_operator_head_{side}", (side * 0.25, 0.23, 0.79), (0.058, 0.054, 0.065), m["skin"], max(10, sph // 2))
        sphere(f"crossbow_operator_topknot_{side}", (side * 0.28, 0.24, 0.86), (0.035, 0.031, 0.04), m["hair"], max(8, sph // 3))
    add_clay_scars(m, s, "siege", center=(0, -0.362, 0.46), scale=0.7)


def geometry_soldier(m, s):
    add_human(m, s, height=1.03, robe=False, armor=True, hat="helmet", offset=(-0.03, 0.03, 0.015))
    cube("infantry_rectangular_lamellar", (-0.03, -0.19, 0.69), (0.17, 0.022, 0.23), m["bronze"], 0.008)
    for row in range(max(3, s["detail"] + 2)):
        for column in range(-2, 3):
            cube(f"infantry_plate_{row}_{column}", (-0.03 + column * 0.058, -0.218, 0.53 + row * 0.075), (0.025, 0.007, 0.031), m["skin"] if (row + column) % 3 else m["cloth"], 0.003)
    cylinder_between("infantry_spear", (0.25, -0.04, 0.32), (0.3, -0.08, 1.35), 0.014, m["wood"], max(8, s["segments"] // 3))
    cone("infantry_spear_head", (0.305, -0.085, 1.46), 0.052, 0.004, 0.22, m["trim"], max(8, s["segments"] // 3), (0.04, 0.02, 0))


# Kept only as an opt-in development fallback for diagnosing Blender itself.
# Production builds always import AUTHORITATIVE_MODEL_FILES and fail closed if
# one is missing.
GEOMETRY_BUILDERS = {
    "marshal": geometry_marshal, "advisor": geometry_advisor, "elephant": geometry_elephant,
    "chariot": geometry_chariot, "horse": geometry_horse, "cannon": geometry_cannon, "soldier": geometry_soldier,
}


def material_base_color(material):
    if material and material.use_nodes and material.node_tree:
        bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if bsdf and "Base Color" in bsdf.inputs:
            return tuple(bsdf.inputs["Base Color"].default_value[:3])
    if material:
        return tuple(material.diffuse_color[:3])
    return (0.18, 0.18, 0.18)


def semantic_color_for_material(material):
    name = material.name.lower() if material else ""
    for token, semantic in SEMANTIC_MATERIAL_TOKENS:
        if token in name:
            return SEMANTIC_REFERENCE_COLORS[semantic]
    return None


def collapse_materials_to_vertex_palette(character, role):
    """Bake source colors and exact faction reference masks into COLOR_0."""
    palette = character.data.color_attributes.new(name="faction_palette", type="BYTE_COLOR", domain="CORNER")
    slot_colors = []
    for slot in character.material_slots:
        material = slot.material
        rgb = semantic_color_for_material(material) or material_base_color(material)
        slot_colors.append((*rgb, 1.0))
    for polygon in character.data.polygons:
        color = slot_colors[polygon.material_index]
        for loop_index in polygon.loop_indices:
            palette.data[loop_index].color = color
        polygon.material_index = 0
    material = pbr_material(f"{role}_terracotta_vertex_palette", (1, 1, 1, 1), 0.94, 0.04)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = palette.name
    links.new(vertex_color.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    character.data.materials.clear()
    character.data.materials.append(material)
    character.data.color_attributes.active_color = palette


def join_mesh_objects(mesh_objects, role):
    if not mesh_objects:
        raise RuntimeError(f"{role}: authoritative GLB imported no mesh objects")
    for obj in mesh_objects:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if obj.parent:
            bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(mesh_objects) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in mesh_objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_objects[0]
        bpy.ops.object.join()
        character = bpy.context.object
    else:
        character = mesh_objects[0]
    character.name = "character_mesh"
    character.data.name = f"{role}_authoritative_geometry"
    return character


def import_authoritative_geometry(role):
    relative_path = AUTHORITATIVE_MODEL_FILES[role]
    source_path = ROOT / relative_path
    if not source_path.is_file():
        raise FileNotFoundError(
            f"{role}: missing authoritative visual source {relative_path}; "
            "runtime builds do not fall back to placeholder geometry"
        )
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    imported_meshes = [
        obj for obj in bpy.context.scene.objects
        if obj not in before and obj.type == "MESH"
    ]
    return join_mesh_objects(imported_meshes, role)


def triangle_count(character):
    character.data.calc_loop_triangles()
    return len(character.data.loop_triangles)


def decimate_to_lod(character, role, lod_name):
    current = triangle_count(character)
    budget = LOD_TRIANGLE_BUDGETS[role][lod_name]
    target = min(current, math.floor(budget * LOD_TARGET_FRACTIONS[lod_name]))
    if current <= target:
        return current
    modifier = character.modifiers.new(f"{lod_name} authoritative decimation", "DECIMATE")
    modifier.ratio = max(0.01, target / current)
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = character
    character.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    character.select_set(False)
    reduced = triangle_count(character)
    if reduced > budget:
        modifier = character.modifiers.new(f"{lod_name} budget safety decimation", "DECIMATE")
        modifier.ratio = max(0.01, (budget * 0.96) / reduced)
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = character
        character.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        character.select_set(False)
        reduced = triangle_count(character)
    if reduced > budget:
        raise RuntimeError(f"{role}/{lod_name}: {reduced} triangles exceeds budget {budget} after decimation")
    return reduced


def normalize_to_contract(character, role):
    bounds_min = [min(vertex.co[axis] for vertex in character.data.vertices) for axis in range(3)]
    bounds_max = [max(vertex.co[axis] for vertex in character.data.vertices) for axis in range(3)]
    size = [bounds_max[axis] - bounds_min[axis] for axis in range(3)]
    if min(size) <= 0:
        raise RuntimeError(f"{role}: authoritative geometry has invalid bounds {size}")
    dimensions = CONTRACT_DIMENSIONS[role]
    horizontal_scale = dimensions["footprint"] / max(size[0], size[1])
    vertical_scale = dimensions["height"] / size[2]
    center_x = (bounds_min[0] + bounds_max[0]) * 0.5
    center_y = (bounds_min[1] + bounds_max[1]) * 0.5
    for vertex in character.data.vertices:
        vertex.co.x = (vertex.co.x - center_x) * horizontal_scale
        vertex.co.y = (vertex.co.y - center_y) * horizontal_scale
        vertex.co.z = (vertex.co.z - bounds_min[2]) * vertical_scale
    character.data.update()


def create_procedural_fallback_geometry(role, settings):
    """Build the retired placeholder only for explicit local diagnostics."""
    materials = make_materials()
    add_base(materials, settings, role)
    GEOMETRY_BUILDERS[role](materials, settings)
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    bpy.ops.object.join()
    character = bpy.context.object
    character.name = "character_mesh"
    character.data.name = f"{role}_shared_geometry"
    lod2_decimation = {"advisor": 0.76, "soldier": 0.58}
    if role in lod2_decimation and settings["detail"] == 1:
        # Preserve the command-slip/spear silhouette and simplify tessellation
        # as a whole so the mobile LOD remains under its strict role budget.
        modifier = character.modifiers.new("lod2 silhouette decimation", "DECIMATE")
        modifier.ratio = lod2_decimation[role]
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = character
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    collapse_materials_to_vertex_palette(character, role)
    character.data.calc_loop_triangles()
    return character


def create_geometry(role, lod_name, settings):
    if os.environ.get("XIANGQI_USE_PROCEDURAL_FALLBACK") == "1":
        print(f"WARNING {role}/{lod_name}: using retired procedural development fallback")
        return create_procedural_fallback_geometry(role, settings)
    character = import_authoritative_geometry(role)
    decimate_to_lod(character, role, lod_name)
    normalize_to_contract(character, role)
    collapse_materials_to_vertex_palette(character, role)
    character.data.calc_loop_triangles()
    return character


def create_rig(role):
    armature = bpy.data.armatures.new(f"{role}_skeleton")
    rig = bpy.data.objects.new("rig_root", armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    definitions = {
        "root": ((0, 0, 0), (0, 0, 0.2), None), "pelvis": ((0, 0, 0.2), (0, 0, 0.55), "root"),
        "spine": ((0, 0, 0.55), (0, 0, 0.85), "pelvis"), "chest": ((0, 0, 0.85), (0, 0, 1.08), "spine"),
        "neck": ((0, 0, 1.08), (0, 0, 1.18), "chest"), "head": ((0, 0, 1.18), (0, 0, 1.42), "neck"),
        "upper_arm.L": ((-0.12, 0, 1.02), (-0.24, -0.06, 0.83), "chest"), "forearm.L": ((-0.24, -0.06, 0.83), (-0.16, -0.13, 0.62), "upper_arm.L"),
        "hand.L": ((-0.16, -0.13, 0.62), (-0.09, -0.15, 0.58), "forearm.L"), "upper_arm.R": ((0.12, 0, 1.02), (0.24, -0.06, 0.83), "chest"),
        "forearm.R": ((0.24, -0.06, 0.83), (0.16, -0.13, 0.62), "upper_arm.R"), "hand.R": ((0.16, -0.13, 0.62), (0.09, -0.15, 0.58), "forearm.R"),
        "mount": ((0, 0.1, 0.5), (0, -0.18, 0.72), "pelvis"), "weapon": ((0.25, -0.08, 0.35), (0.29, -0.1, 1.35), "hand.R"),
    }
    bones = {}
    for name, (head, tail, parent) in definitions.items():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail, bone.use_deform = head, tail, True
        if parent:
            bone.parent = bones[parent]
        bones[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return rig


def skin_character(character, rig):
    groups = {bone.name: character.vertex_groups.new(name=bone.name) for bone in rig.data.bones}
    for vertex in character.data.vertices:
        x, y, z = vertex.co
        if z < 0.22: bone = "root"
        elif z < 0.52: bone = "pelvis"
        elif abs(x) > 0.23 and z > 0.45: bone = "forearm.L" if x < 0 else "forearm.R"
        elif abs(x) > 0.15 and z > 0.75: bone = "upper_arm.L" if x < 0 else "upper_arm.R"
        elif z > 1.12: bone = "head"
        elif z > 0.82: bone = "chest"
        elif abs(y) > 0.25 and z > 0.35: bone = "mount"
        else: bone = "spine"
        groups[bone].add([vertex.index], 1.0, "REPLACE")
    modifier = character.modifiers.new("piece_armature", "ARMATURE")
    modifier.object = rig


def create_socket(name, parent, location, bone=None):
    socket = bpy.data.objects.new(name, None)
    socket.empty_display_type, socket.empty_display_size = "PLAIN_AXES", 0.035
    bpy.context.scene.collection.objects.link(socket)
    socket.parent = parent
    if bone:
        socket.parent_type, socket.parent_bone = "BONE", bone
    socket.location = location


def reset_pose(rig):
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def create_action(rig, name, frames):
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame, rotations in frames:
        reset_pose(rig)
        for bone_name, rotation in rotations.items():
            rig.pose.bones[bone_name].rotation_euler = rotation
        for pose_bone in rig.pose.bones:
            pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
    action.frame_start, action.frame_end = frames[0][0], frames[-1][0]


def create_actions(rig, role):
    neutral = {}
    mounted = role in {"elephant", "chariot", "horse", "cannon"}
    attack_scale = {"marshal": 1.0, "advisor": 0.7, "elephant": 1.25, "chariot": 1.15, "horse": 1.35, "cannon": 1.4, "soldier": 1.1}[role]
    travel_bone = "mount" if mounted else "spine"
    action_frames = {
        "idle_loop": [(1, neutral), (16, {"chest": (0.02, 0, 0.018), "head": (0, 0, -0.018)}), (31, neutral)],
        "move_start": [(1, neutral), (10, {travel_bone: (0.06, 0, 0), "chest": (0.025, 0, 0)})],
        "move_loop": [(1, {travel_bone: (0.05, 0, -0.035)}), (9, {travel_bone: (0.08, 0, 0.04), "chest": (0, 0, 0.025)}), (17, {travel_bone: (0.05, 0, -0.035)})],
        "move_end": [(1, {travel_bone: (0.055, 0, 0.02)}), (10, neutral)],
        "attack_primary": [(1, neutral), (8, {"chest": (0, -0.12 * attack_scale, -0.07), "upper_arm.R": (-0.25, -0.12, -0.25), "weapon": (0, 0.1, -0.16)}), (15, {"chest": (0.1, 0.25 * attack_scale, 0.1), "upper_arm.R": (0.48, 0.18, 0.45), "weapon": (0, -0.2, 0.34 * attack_scale)}), (24, neutral)],
        "hit_react": [(1, neutral), (5, {travel_bone: (-0.18, 0, 0.1), "chest": (-0.12, 0, -0.1), "head": (0.15, 0, 0)}), (13, neutral)],
        "destroy": [(1, neutral), (12, {travel_bone: (0.35, 0, 0.2), "chest": (0.25, 0, -0.3), "head": (0.3, 0.1, 0), "upper_arm.L": (0, 0, -0.3), "upper_arm.R": (0, 0, 0.35)}), (28, {travel_bone: (0.85, 0.08, 0.4), "chest": (0.62, 0.1, -0.5), "head": (0.55, 0.2, 0.15), "upper_arm.L": (-0.3, 0, -0.5), "upper_arm.R": (0.35, 0, 0.6)})],
    }
    qin_attacks = {
        "marshal": [(1, neutral), (8, {"chest": (0, -0.16, -0.08), "weapon": (0, 0.12, -0.25)}), (15, {"chest": (0.08, 0.34, 0.12), "upper_arm.R": (0.52, 0.16, 0.48), "weapon": (0, -0.28, 0.45)}), (25, neutral)],
        "advisor": [(1, neutral), (9, {"upper_arm.L": (-0.25, 0, -0.18), "upper_arm.R": (-0.18, 0, 0.18), "chest": (0, -0.05, 0)}), (17, {"upper_arm.R": (0.32, 0.08, 0.32), "hand.R": (0, 0, 0.3), "head": (0, 0, -0.08)}), (26, neutral)],
        "elephant": [(1, neutral), (9, {"mount": (-0.1, 0, 0), "chest": (-0.08, 0, 0)}), (16, {"mount": (0.42, 0, 0), "chest": (0.25, 0, -0.1)}), (28, neutral)],
        "chariot": [(1, neutral), (8, {"mount": (-0.12, 0, 0), "chest": (-0.05, 0, 0)}), (17, {"mount": (0.3, 0, -0.12), "weapon": (0, 0, 0.25)}), (26, neutral)],
        "horse": [(1, neutral), (7, {"mount": (-0.1, 0, 0.08), "weapon": (0, 0.12, -0.25)}), (15, {"mount": (0.18, 0, -0.12), "upper_arm.R": (0.45, 0.1, 0.35), "weapon": (0, -0.24, 0.48)}), (25, neutral)],
        "cannon": [(1, neutral), (10, {"mount": (-0.08, 0, 0), "upper_arm.L": (-0.28, 0, -0.18), "upper_arm.R": (-0.28, 0, 0.18)}), (15, {"mount": (0.18, 0, 0.04), "chest": (-0.1, 0, 0), "weapon": (0, 0, 0.22)}), (28, neutral)],
        "soldier": [(1, neutral), (7, {"chest": (0, -0.1, -0.08), "weapon": (0, 0.12, -0.22)}), (14, {"chest": (0.08, 0.25, 0.12), "upper_arm.R": (0.42, 0.12, 0.38), "weapon": (0, -0.2, 0.35)}), (23, neutral)],
    }
    action_frames["attack_primary"] = qin_attacks[role]
    for clip_name in CLIP_NAMES:
        create_action(rig, clip_name, action_frames[clip_name])
    rig.animation_data.action = None
    reset_pose(rig)


def write_metadata(role):
    directory = OUTPUT_ROOT / "assets" / "characters" / role
    directory.mkdir(parents=True, exist_ok=True)
    authoritative_path = AUTHORITATIVE_MODEL_FILES[role]
    metadata = {
        "schema": "xiangqi-source-asset/v1", "role": role, "displayNames": DISPLAY_NAMES[role],
        "generator": {"application": "Blender", "version": bpy.app.version_string, "script": "scripts/blender/create_xiangqi_piece_assets.py"},
        "authoritativeVisualSource": {"path": authoritative_path, "editableMaster": authoritative_path.replace(".glb", ".blend")},
        "sourceCommit": SOURCE_COMMIT,
        "derivationMode": "procedural-development-fallback" if os.environ.get("XIANGQI_USE_PROCEDURAL_FALLBACK") == "1" else "authoritative-import",
        "reference": "assets/models/README.md",
        "license": "Repository-owned Qin-terracotta research asset; no third-party geometry or bitmap textures",
        "visualIntent": VISUAL_INTENT[role],
        "periodPolicy": "Qin terracotta visual fantasy: no gunpowder artillery; cannon role is represented by a heavy siege crossbow",
        "derivation": "Authoritative research GLB normalized and decimated per LOD, then adapted to the shared runtime rig, actions, sockets and faction palette contract",
        "knownLimitations": ["first-pass broad automatic skin weights require manual deformation polish before an extreme close-up", "source solid materials are baked to vertex colors; bitmap normal maps are intentionally absent", "canonical runtime actions are adapters and may be iterated without changing the visual source authority"],
        "texturePolicy": {"bitmapTextures": 0, "ktx2": "not-applicable-no-bitmap-textures", "solidColorBake": f"COLOR_0 VEC3 exact RGB reference colors; one {role}_terracotta_vertex_palette material"},
    }
    (directory / f"{role}.asset.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


def build_lod(role, lod_name, settings):
    reset_scene()
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1.0
    piece_root = bpy.data.objects.new("piece_root", None)
    piece_root.empty_display_type, piece_root.empty_display_size = "CIRCLE", 0.445
    bpy.context.scene.collection.objects.link(piece_root)
    character = create_geometry(role, lod_name, settings)
    rig = create_rig(role)
    rig.parent = piece_root
    skin_character(character, rig)
    create_socket("socket_ground", piece_root, (0, 0, 0))
    create_socket("socket_hit_center", rig, (0, 0, 0), "chest")
    create_socket("socket_attack_origin", rig, (0, -0.06, 0.05), "hand.R")
    create_socket("socket_trail_start", rig, (0, 0, -0.35), "weapon")
    create_socket("socket_trail_end", rig, (0, 0, 0.35), "weapon")
    create_actions(rig, role)
    source_dir = OUTPUT_ROOT / "assets" / "characters" / role / "source"
    export_dir = OUTPUT_ROOT / "assets" / "characters" / role / "exports"
    if lod_name == "lod0":
        source_dir.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source_dir / f"{role}.blend"))
    export_dir.mkdir(parents=True, exist_ok=True)
    raw_path = export_dir / f"{role}-{lod_name}-raw.glb"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(raw_path), export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_materials="EXPORT", export_texcoords=False, export_animations=True, export_animation_mode="ACTIONS", export_reset_pose_bones=True, export_skins=True, export_morph=False, export_cameras=False, export_lights=False)
    character.data.calc_loop_triangles()
    print(f"XIANGQI_ASSET role={role} lod={lod_name} raw={raw_path} triangles={len(character.data.loop_triangles)} bones={len(rig.data.bones)} clips={len(CLIP_NAMES)}")


selected_roles = tuple(role for role in GENERATED_ROLES if role in os.environ.get("XIANGQI_ROLES", ",".join(GENERATED_ROLES)).split(","))
selected_lods = tuple(lod for lod in LOD_SETTINGS if lod in os.environ.get("XIANGQI_LODS", ",".join(LOD_SETTINGS)).split(","))

for current_role in selected_roles:
    write_metadata(current_role)
    for current_lod in selected_lods:
        build_lod(current_role, current_lod, LOD_SETTINGS[current_lod])

print(f"XIANGQI_ASSET generatedRoles={len(selected_roles)} preservedRoles=0 runtimeAssets={len(selected_roles) * len(selected_lods)}")
