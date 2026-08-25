from __future__ import annotations

import hashlib
import math
import os
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from cjk_font_cmap import font_glyph_ids, validated_text_body


ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "assets" / "models"
RENDER_DIR = ROOT / "assets" / "renders"
STYLE_FAMILY = "red-xiangqi-qin-terracotta-cartoon-v1"
ROLES = (
    {"role": "advisor", "title": "Advisor", "glyph": "仕"},
    {"role": "elephant", "title": "Elephant", "glyph": "相"},
    {"role": "chariot", "title": "Chariot", "glyph": "车"},
    {"role": "horse", "title": "Horse", "glyph": "马"},
    {"role": "cannon", "title": "Cannon", "glyph": "炮"},
    {"role": "soldier", "title": "Soldier", "glyph": "兵"},
)
ORTHO_SCALES = {
    "advisor": 3.35,
    "elephant": 3.25,
    "chariot": 3.35,
    "horse": 3.55,
    "cannon": 3.30,
    "soldier": 3.55,
}


def canonical_triangle_cycle(vertices):
    rotations = tuple(tuple(vertices[index:] + vertices[:index]) for index in range(3))
    return min(rotations)


def canonical_material_payload(material):
    if material is None:
        raise RuntimeError("Triangle references an empty material slot")
    bsdf = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes else None
    if bsdf is None:
        raise RuntimeError(f"Material lacks Principled BSDF: {material.name}")
    # Vinyl source materials drive Base Color through a ramp, while their GLB
    # counterparts are deliberately flat. diffuse_color is the shared color
    # contract copied by gltf_material and preserved by the GLB round trip.
    numeric_values = (
        *material.diffuse_color,
        bsdf.inputs["Roughness"].default_value,
        bsdf.inputs["Metallic"].default_value,
    )
    numeric_payload = tuple(int(round(float(value) * 100_000)) for value in numeric_values)
    material_name = material.name.removesuffix(" (GLB)").lower()
    return material_name, numeric_payload


def canonical_triangle_signature(objects):
    triangles = []
    material_triangles = []
    for obj in objects:
        obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            vertices = []
            for vertex_index in triangle.vertices:
                world_vertex = obj.matrix_world @ obj.data.vertices[vertex_index].co
                vertices.append(tuple(int(round(value * 10_000)) for value in world_vertex))
            canonical_triangle = canonical_triangle_cycle(vertices)
            triangles.append(canonical_triangle)
            polygon = obj.data.polygons[triangle.polygon_index]
            material = obj.data.materials[polygon.material_index]
            material_name, material_payload = canonical_material_payload(material)
            material_triangles.append((canonical_triangle, material_name, material_payload))
    triangles.sort()
    material_triangles.sort()
    geometry_digest = hashlib.sha256()
    for triangle in triangles:
        for vertex in triangle:
            for value in vertex:
                geometry_digest.update(struct.pack("<q", value))
    material_digest = hashlib.sha256()
    for triangle, material_name, material_payload in material_triangles:
        for vertex in triangle:
            for value in vertex:
                material_digest.update(struct.pack("<q", value))
        encoded_name = material_name.encode("utf-8")
        material_digest.update(struct.pack("<I", len(encoded_name)))
        material_digest.update(encoded_name)
        for value in material_payload:
            material_digest.update(struct.pack("<q", value))
    return geometry_digest.hexdigest(), material_digest.hexdigest(), len(triangles)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def register(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    MODEL.objects.link(obj)
    obj["construction"] = "primitive_or_simple_mesh"
    return obj


def smooth(obj) -> None:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def bevel(obj, width: float, segments: int = 2) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("Soft vinyl edge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def triangulate_mesh(obj) -> None:
    if all(len(polygon.vertices) == 3 for polygon in obj.data.polygons):
        return
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Stable export triangulation", "TRIANGULATE")
    modifier.quad_method = "FIXED"
    modifier.ngon_method = "BEAUTY"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def apply_mesh_transform(obj) -> None:
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)


def vinyl_material(name, shadow, color, roughness=0.46, metallic=0.0, bump=0.04):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 7.0
    noise.inputs["Detail"].default_value = 2.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = shadow
    ramp.color_ramp.elements[1].color = color
    bump_node = nodes.new("ShaderNodeBump")
    bump_node.inputs["Strength"].default_value = bump
    bump_node.inputs["Distance"].default_value = 0.012
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump_node.inputs["Height"])
    links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def simple_material(name, color, roughness=0.5, metallic=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material


def gltf_material(source):
    source_bsdf = source.node_tree.nodes.get("Principled BSDF")
    return simple_material(
        f"{source.name} (GLB)",
        tuple(source.diffuse_color),
        source_bsdf.inputs["Roughness"].default_value,
        source_bsdf.inputs["Metallic"].default_value,
    )


def rounded_box(name, location, scale, material, edge=0.018, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if edge:
        bevel(obj, edge, 3)
    obj.data.materials.append(material)
    smooth(obj)
    obj.select_set(False)
    return obj


def sphere(name, location, scale, material, segments=28, rings=18, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(material)
    smooth(obj)
    obj.select_set(False)
    return obj


def cylinder(name, location, radius, depth, material, vertices=32, rotation=(0, 0, 0), edge=0.01):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(material)
    if edge:
        bevel(obj, edge, 2)
    smooth(obj)
    return obj


def torus(name, location, major_radius, minor_radius, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=40,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(material)
    smooth(obj)
    return obj


def cylinder_between(name, start, end, radius, material, vertices=20, edge=0.006):
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=direction.length,
        location=(a + b) * 0.5,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.data.materials.append(material)
    if edge:
        bevel(obj, edge, 2)
    smooth(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def cone_between(name, start, end, radius_start, radius_end, material, vertices=24, edge=0.008):
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=(a + b) * 0.5,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.data.materials.append(material)
    if edge:
        bevel(obj, edge, 2)
    smooth(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def tube_path(name, points, radius, material, segments=16):
    for index, (start, end) in enumerate(zip(points, points[1:], strict=False)):
        cylinder_between(f"{name} segment {index:02}", start, end, radius, material, segments, radius * 0.3)
    for index, point in enumerate(points):
        sphere(f"{name} joint {index:02}", point, (radius, radius, radius), material, segments, 10)


def loft(name, rings, material, segments=36, edge=0.01):
    vertices = []
    faces = []
    for z, radius_x, radius_y, center_y in rings:
        for index in range(segments):
            angle = 2 * math.pi * index / segments
            vertices.append((radius_x * math.cos(angle), center_y + radius_y * math.sin(angle), z))
    for ring in range(len(rings) - 1):
        for index in range(segments):
            nxt = (index + 1) % segments
            a = ring * segments + index
            b = ring * segments + nxt
            c = (ring + 1) * segments + nxt
            d = (ring + 1) * segments + index
            faces.append((a, b, c, d))
    faces.append(tuple(reversed(range(segments))))
    offset = (len(rings) - 1) * segments
    faces.append(tuple(offset + index for index in range(segments)))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = register(bpy.data.objects.new(name, mesh))
    obj.data.materials.append(material)
    smooth(obj)
    if edge:
        bevel(obj, edge, 2)
    return obj


def create_palette() -> None:
    global TERRACOTTA, PORTRAIT, DEEP_BROWN, LACQUER, CINNABAR, JADE, EYE_IVORY, IRIS, PLINTH
    TERRACOTTA = vinyl_material("Warm terracotta vinyl", (0.22, 0.065, 0.025, 1), (0.55, 0.205, 0.085, 1))
    PORTRAIT = vinyl_material("Soft portrait terracotta", (0.25, 0.08, 0.035, 1), (0.62, 0.285, 0.12, 1), 0.42, bump=0.022)
    DEEP_BROWN = vinyl_material("Deep brown hair and details", (0.018, 0.009, 0.006, 1), (0.105, 0.052, 0.031, 1), 0.5)
    LACQUER = vinyl_material("Deep brown lacquer armour", (0.025, 0.012, 0.008, 1), (0.145, 0.067, 0.038, 1), 0.47)
    CINNABAR = vinyl_material("Cinnabar red trim", (0.15, 0.018, 0.008, 1), (0.55, 0.07, 0.028, 1), 0.43)
    JADE = vinyl_material("Polished jade green", (0.022, 0.085, 0.055, 1), (0.16, 0.43, 0.30, 1), 0.28, 0.12, 0.018)
    EYE_IVORY = vinyl_material("Warm ivory eye white", (0.46, 0.34, 0.22, 1), (0.88, 0.76, 0.56, 1), 0.24, bump=0.0)
    IRIS = vinyl_material("Chestnut brown iris", (0.055, 0.018, 0.006, 1), (0.29, 0.105, 0.025, 1), 0.22, bump=0.0)
    PLINTH = vinyl_material("Thick fired-clay plinth", (0.18, 0.045, 0.018, 1), (0.44, 0.145, 0.055, 1), 0.54)


def glyph_font_path() -> Path:
    configured = os.environ.get("TERRACOTTA_FONT_PATH")
    candidates = (
        Path(configured).expanduser() if configured else None,
        ROOT / "assets" / "fonts" / "NotoSerifCJKsc-Regular.otf",
        Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        Path("/System/Library/Fonts/STHeiti Medium.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    )
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "No CJK font found for the chess glyphs; set TERRACOTTA_FONT_PATH to a Chinese font"
    )


GLYPH_FONT_PATH = glyph_font_path()
GLYPH_FONT_GLYPH_IDS = font_glyph_ids(GLYPH_FONT_PATH, (spec["glyph"] for spec in ROLES))
GLYPH_FONT = bpy.data.fonts.load(str(GLYPH_FONT_PATH), check_existing=True)


def add_standard_glyph(glyph: str) -> None:
    bpy.ops.object.text_add(location=(0, -1.095, 0.225), rotation=(math.pi / 2, 0, 0))
    label = register(bpy.context.object)
    label.name = f"Front {glyph} standard font glyph"
    label.data.body = glyph
    actual_glyph = validated_text_body(glyph, label.data.body)
    label.data.align_x = "CENTER"
    label.data.align_y = "CENTER"
    label.data.size = 0.285
    label.data.extrude = 0.009
    label.data.bevel_depth = 0.004
    label.data.bevel_resolution = 2
    label.data.fill_mode = "BOTH"
    label.data.font = GLYPH_FONT
    label.data.materials.append(EYE_IVORY)
    label["glyph_text"] = actual_glyph
    label["glyph_codepoint"] = ord(actual_glyph)
    label["glyph_font_glyph_id"] = GLYPH_FONT_GLYPH_IDS[actual_glyph]
    label["glyph_source_kind"] = "cjk_font_outline"
    label["glyph_font_filename"] = GLYPH_FONT_PATH.name

    bpy.ops.object.select_all(action="DESELECT")
    label.select_set(True)
    bpy.context.view_layer.objects.active = label
    bpy.ops.object.convert(target="MESH")
    label = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    triangulate_mesh(label)
    if not label.data.polygons or len(label.data.vertices) < 20:
        raise RuntimeError(f"Font did not produce a usable outline for glyph {glyph!r}: {GLYPH_FONT_PATH}")
    label.select_set(False)


def add_base(glyph: str) -> None:
    cylinder("Thick lower chess base", (0, 0, 0.10), 1.08, 0.20, PLINTH, 56, edge=0.025)
    cylinder("Dark recessed base band", (0, 0, 0.215), 1.04, 0.07, DEEP_BROWN, 56, edge=0.012)
    cylinder("Rounded upper chess base", (0, 0, 0.325), 0.98, 0.18, TERRACOTTA, 56, edge=0.023)
    torus("Soft upper base rim", (0, 0, 0.408), 0.935, 0.025, PORTRAIT)
    for angle in range(0, 360, 60):
        radians = math.radians(angle)
        sphere("Base relief dot", (0.985 * math.sin(radians), -0.985 * math.cos(radians), 0.215), (0.032, 0.018, 0.032), PORTRAIT, 16, 10)
    cylinder(f"Front {glyph} faction medallion", (0, -1.055, 0.225), 0.19, 0.055, CINNABAR, 40, rotation=(math.pi / 2, 0, 0), edge=0.012)
    add_standard_glyph(glyph)


def add_eye_pair(prefix: str, center, spacing=0.19, scale=1.0) -> None:
    cx, cy, cz = center
    for side, sign in (("Left", -1), ("Right", 1)):
        x = cx + sign * spacing
        sphere(f"{prefix} {side} eye white", (x, cy, cz), (0.13 * scale, 0.047 * scale, 0.12 * scale), EYE_IVORY, 26, 16)
        sphere(f"{prefix} {side} iris", (x, cy - 0.043 * scale, cz), (0.066 * scale, 0.021 * scale, 0.073 * scale), IRIS, 22, 14)
        sphere(f"{prefix} {side} pupil", (x, cy - 0.063 * scale, cz), (0.032 * scale, 0.012 * scale, 0.042 * scale), DEEP_BROWN, 18, 12)
        sphere(f"{prefix} {side} catchlight", (x - sign * 0.018 * scale, cy - 0.074 * scale, cz + 0.032 * scale), (0.013 * scale,) * 3, EYE_IVORY, 14, 8)


def add_human_core(prefix: str, head_z=2.08, robe=False, youthful=False) -> None:
    rounded_box(f"{prefix} left tiny boot", (-0.24, -0.08, 0.51), (0.22, 0.25, 0.105), DEEP_BROWN, 0.05)
    rounded_box(f"{prefix} right tiny boot", (0.24, -0.08, 0.51), (0.22, 0.25, 0.105), DEEP_BROWN, 0.05)
    rounded_box(f"{prefix} left terracotta toe", (-0.24, -0.30, 0.54), (0.20, 0.075, 0.055), TERRACOTTA, 0.025)
    rounded_box(f"{prefix} right terracotta toe", (0.24, -0.30, 0.54), (0.20, 0.075, 0.055), TERRACOTTA, 0.025)
    if robe:
        loft(f"{prefix} bell robe", ((0.48, 0.54, 0.37, 0.02), (0.84, 0.58, 0.39, 0.01), (1.30, 0.46, 0.34, 0.0), (1.55, 0.37, 0.28, 0.0)), LACQUER, 40)
    else:
        loft(f"{prefix} pear torso", ((0.48, 0.49, 0.35, 0.02), (0.86, 0.58, 0.39, 0.01), (1.28, 0.52, 0.36, 0.0), (1.55, 0.38, 0.28, 0.0)), TERRACOTTA, 40)
        rounded_box(f"{prefix} simple lamellar vest", (0, -0.31, 1.16), (0.47, 0.08, 0.30), LACQUER, 0.035)
        for x in (-0.28, 0, 0.28):
            rounded_box(f"{prefix} vest plate", (x, -0.405, 1.16), (0.105, 0.025, 0.115), LACQUER, 0.018)
    rounded_box(f"{prefix} cinnabar sash", (0, -0.36, 0.88), (0.49, 0.055, 0.055), CINNABAR, 0.015)
    sphere(f"{prefix} huge round head", (0, -0.03, head_z), (0.57, 0.49, 0.55), PORTRAIT, 42, 28)
    sphere(f"{prefix} dark hair halo", (0, 0.12, head_z + 0.11), (0.55, 0.43, 0.48), DEEP_BROWN, 38, 24)
    sphere(f"{prefix} left ear", (-0.55, -0.03, head_z), (0.12, 0.08, 0.14), PORTRAIT, 22, 14)
    sphere(f"{prefix} right ear", (0.55, -0.03, head_z), (0.12, 0.08, 0.14), PORTRAIT, 22, 14)
    add_eye_pair(prefix, (0, -0.495, head_z + 0.08), 0.20, 1.0)
    sphere(f"{prefix} soft front hair cap", (0, -0.465, head_z + 0.39), (0.36, 0.025, 0.08), DEEP_BROWN, 28, 16)
    sphere(f"{prefix} left curved brow", (-0.22, -0.515, head_z + 0.25), (0.115, 0.016, 0.027), DEEP_BROWN, 22, 12, (0, 0, -0.10))
    sphere(f"{prefix} right curved brow", (0.22, -0.515, head_z + 0.25), (0.115, 0.016, 0.027), DEEP_BROWN, 22, 12, (0, 0, 0.10))
    sphere(f"{prefix} tiny nose", (0, -0.545, head_z - 0.07), (0.052, 0.035, 0.045), PORTRAIT, 20, 12)
    sphere(f"{prefix} left rounded cheek", (-0.30, -0.515, head_z - 0.12), (0.085, 0.018, 0.055), TERRACOTTA, 20, 12)
    sphere(f"{prefix} right rounded cheek", (0.30, -0.515, head_z - 0.12), (0.085, 0.018, 0.055), TERRACOTTA, 20, 12)
    sphere(f"{prefix} friendly mouth", (0, -0.54, head_z - 0.18), (0.065, 0.012, 0.012), DEEP_BROWN, 18, 10)
    if not youthful:
        sphere(f"{prefix} tiny moustache left", (-0.065, -0.545, head_z - 0.14), (0.065, 0.014, 0.018), DEEP_BROWN, 18, 10, (0, 0, -0.15))
        sphere(f"{prefix} tiny moustache right", (0.065, -0.545, head_z - 0.14), (0.065, 0.014, 0.018), DEEP_BROWN, 18, 10, (0, 0, 0.15))


def build_advisor() -> None:
    add_human_core("Advisor", robe=True)
    cylinder("Advisor low official cap", (0, 0, 2.58), 0.43, 0.13, LACQUER, 40, edge=0.015)
    rounded_box("Advisor left cap wing", (-0.50, 0.02, 2.58), (0.25, 0.08, 0.075), LACQUER, 0.035, (0, -0.08, 0.10))
    rounded_box("Advisor right cap wing", (0.50, 0.02, 2.58), (0.25, 0.08, 0.075), LACQUER, 0.035, (0, 0.08, -0.10))
    sphere("Advisor jade cap seal", (0, -0.425, 2.60), (0.075, 0.03, 0.075), JADE, 22, 14)
    for side, sign in (("left", -1), ("right", 1)):
        cylinder_between(f"Advisor {side} short sleeve", (sign * 0.40, 0, 1.38), (sign * 0.42, -0.34, 1.12), 0.15, LACQUER, 24, 0.012)
        sphere(f"Advisor {side} mitten hand", (sign * 0.16, -0.57, 1.13), (0.12, 0.09, 0.13), PORTRAIT, 24, 14)
    rounded_box("Advisor bamboo court tablet", (0, -0.63, 1.32), (0.22, 0.045, 0.42), TERRACOTTA, 0.035)
    rounded_box("Advisor tablet cinnabar binding", (0, -0.68, 1.28), (0.225, 0.012, 0.035), CINNABAR, 0.008)
    rounded_box("Advisor broad standing collar", (0, -0.30, 1.58), (0.34, 0.07, 0.08), DEEP_BROWN, 0.025)
    for x in (-0.28, 0.28):
        rounded_box("Advisor robe jade clasp", (x, -0.405, 0.96), (0.045, 0.018, 0.045), JADE, 0.012)
    for z in (0.76, 1.00, 1.24):
        rounded_box("Advisor robe front fold", (0, -0.405, z), (0.018, 0.014, 0.085), TERRACOTTA, 0.006)


def build_elephant() -> None:
    sphere("Elephant compact body", (0, 0.10, 1.16), (0.78, 0.68, 0.60), TERRACOTTA, 42, 28)
    for x in (-0.52, 0.52):
        for y in (-0.30, 0.38):
            cylinder("Elephant short leg", (x, y, 0.72), 0.18, 0.54, TERRACOTTA, 28, edge=0.025)
            sphere("Elephant round foot", (x, y - 0.04, 0.48), (0.23, 0.26, 0.12), DEEP_BROWN, 26, 16)
    sphere("Elephant oversized head", (0, -0.63, 1.47), (0.59, 0.49, 0.54), PORTRAIT, 42, 28)
    sphere("Elephant left fan ear", (-0.53, -0.46, 1.51), (0.38, 0.10, 0.44), TERRACOTTA, 32, 20, (0, 0, -0.10))
    sphere("Elephant right fan ear", (0.53, -0.46, 1.51), (0.38, 0.10, 0.44), TERRACOTTA, 32, 20, (0, 0, 0.10))
    add_eye_pair("Elephant", (0, -1.08, 1.62), 0.22, 0.85)
    tube_path("Elephant curled trunk", ((0, -1.03, 1.40), (0, -1.20, 1.12), (0.08, -1.22, 0.86), (0.20, -1.13, 0.80)), 0.10, PORTRAIT, 20)
    cone_between("Elephant left ivory tusk", (-0.22, -1.05, 1.31), (-0.30, -1.17, 1.05), 0.055, 0.012, EYE_IVORY, 20)
    cone_between("Elephant right ivory tusk", (0.22, -1.05, 1.31), (0.30, -1.17, 1.05), 0.055, 0.012, EYE_IVORY, 20)
    rounded_box("Elephant lacquer armour blanket", (0, 0.13, 1.59), (0.70, 0.54, 0.16), LACQUER, 0.055)
    rounded_box("Elephant cinnabar blanket stripe", (0, -0.43, 1.58), (0.66, 0.035, 0.06), CINNABAR, 0.015)
    for row, z in enumerate((1.40, 1.61, 1.80)):
        for column, x in enumerate((-0.43, 0, 0.43)):
            rounded_box(f"Elephant blanket plate {row}-{column}", (x, -0.51, z), (0.16, 0.028, 0.075), LACQUER, 0.018)
            sphere(f"Elephant jade blanket stud {row}-{column}", (x, -0.545, z), (0.032, 0.016, 0.032), JADE, 16, 8)
    cylinder("Elephant tiny guardian tower", (0, 0.10, 1.96), 0.31, 0.30, LACQUER, 32, edge=0.025)
    rounded_box("Elephant tower cinnabar rail", (0, -0.28, 2.10), (0.36, 0.05, 0.045), CINNABAR, 0.015)
    sphere("Elephant forehead jade seal", (0, -1.07, 1.87), (0.065, 0.025, 0.065), JADE, 20, 12)


def wheel(name: str, x: float, y: float, z: float, radius: float) -> None:
    torus(f"{name} tyre", (x, y, z), radius, 0.075, DEEP_BROWN, (0, math.pi / 2, 0))
    cylinder(f"{name} jade hub", (x, y, z), 0.13, 0.16, JADE, 28, (0, math.pi / 2, 0), 0.012)
    for angle in range(0, 360, 45):
        radians = math.radians(angle)
        cylinder_between(
            f"{name} spoke {angle}",
            (x, y, z),
            (x, y + radius * 0.79 * math.cos(radians), z + radius * 0.79 * math.sin(radians)),
            0.028,
            TERRACOTTA,
            16,
            0.004,
        )


def build_chariot() -> None:
    wheel("Chariot left wheel", -0.75, 0.04, 0.91, 0.52)
    wheel("Chariot right wheel", 0.75, 0.04, 0.91, 0.52)
    rounded_box("Chariot compact cart floor", (0, 0.08, 0.77), (0.70, 0.55, 0.11), TERRACOTTA, 0.045)
    rounded_box("Chariot curved front shield", (0, -0.48, 1.03), (0.67, 0.10, 0.35), LACQUER, 0.055)
    rounded_box("Chariot cinnabar shield rail", (0, -0.59, 1.25), (0.64, 0.025, 0.045), CINNABAR, 0.012)
    for x in (-0.42, 0, 0.42):
        sphere("Chariot jade shield stud", (x, -0.61, 1.04), (0.045, 0.02, 0.045), JADE, 18, 10)
    sphere("Chariot driver large head", (0, -0.02, 1.82), (0.44, 0.38, 0.42), PORTRAIT, 36, 24)
    sphere("Chariot driver hair", (0, 0.10, 1.92), (0.42, 0.33, 0.36), DEEP_BROWN, 32, 20)
    add_eye_pair("Chariot driver", (0, -0.38, 1.88), 0.15, 0.78)
    sphere("Chariot driver tiny nose", (0, -0.42, 1.76), (0.042, 0.03, 0.04), PORTRAIT, 18, 10)
    sphere("Chariot driver smile", (0, -0.42, 1.68), (0.05, 0.01, 0.01), DEEP_BROWN, 16, 8)
    rounded_box("Chariot driver armour torso", (0, -0.01, 1.43), (0.31, 0.24, 0.27), LACQUER, 0.045)
    cylinder("Chariot driver helmet band", (0, 0.01, 2.18), 0.31, 0.10, LACQUER, 32, edge=0.014)
    rounded_box("Chariot driver helmet red trim", (0, -0.29, 2.19), (0.25, 0.025, 0.035), CINNABAR, 0.010)
    rounded_box("Chariot driver topknot", (0, 0.05, 2.35), (0.10, 0.08, 0.16), DEEP_BROWN, 0.035)
    sphere("Chariot left mitten", (-0.20, -0.58, 1.34), (0.11, 0.08, 0.11), PORTRAIT, 20, 12)
    sphere("Chariot right mitten", (0.20, -0.58, 1.34), (0.11, 0.08, 0.11), PORTRAIT, 20, 12)
    torus("Chariot reins", (0, -0.62, 1.38), 0.24, 0.018, EYE_IVORY, (math.pi / 2, 0, 0))
    for x in (-0.42, 0, 0.42):
        rounded_box("Chariot shield armour plate", (x, -0.605, 0.98), (0.15, 0.018, 0.11), LACQUER, 0.020)


def build_horse() -> None:
    sphere("Horse compact barrel body", (0, 0.12, 1.14), (0.72, 0.50, 0.48), TERRACOTTA, 40, 26)
    for x in (-0.47, 0.47):
        for y in (-0.18, 0.35):
            cylinder("Horse short leg", (x, y, 0.72), 0.12, 0.50, DEEP_BROWN, 24, edge=0.018)
            sphere("Horse rounded hoof", (x, y - 0.03, 0.48), (0.17, 0.20, 0.10), TERRACOTTA, 22, 14)
    cone_between("Horse arched neck", (0, -0.10, 1.34), (0, -0.57, 1.76), 0.30, 0.24, TERRACOTTA, 32, 0.018)
    sphere("Horse cute long head", (0, -0.74, 1.83), (0.38, 0.42, 0.40), PORTRAIT, 36, 24, (0.12, 0, 0))
    sphere("Horse soft muzzle", (0, -1.10, 1.70), (0.28, 0.22, 0.22), PORTRAIT, 28, 18)
    cone_between("Horse left ear", (-0.18, -0.63, 2.10), (-0.22, -0.60, 2.34), 0.09, 0.015, TERRACOTTA, 20)
    cone_between("Horse right ear", (0.18, -0.63, 2.10), (0.22, -0.60, 2.34), 0.09, 0.015, TERRACOTTA, 20)
    add_eye_pair("Horse", (0, -1.10, 1.96), 0.17, 0.72)
    tube_path("Horse dark mane", ((0, -0.28, 2.05), (0, -0.05, 1.77), (0, 0.12, 1.46)), 0.075, DEEP_BROWN, 18)
    rounded_box("Horse lacquer saddle blanket", (0, 0.10, 1.51), (0.61, 0.41, 0.15), LACQUER, 0.045)
    for side, sign in (("left", -1), ("right", 1)):
        rounded_box(f"Horse {side} broad side armour", (sign * 0.69, 0.08, 1.28), (0.025, 0.34, 0.24), LACQUER, 0.020)
        rounded_box(f"Horse {side} cinnabar side trim", (sign * 0.72, -0.27, 1.28), (0.014, 0.025, 0.21), CINNABAR, 0.008)
    rounded_box("Horse cinnabar saddle trim", (0, -0.31, 1.50), (0.53, 0.025, 0.045), CINNABAR, 0.012)
    for x in (-0.38, 0, 0.38):
        rounded_box("Horse blanket armour plate", (x, -0.34, 1.38), (0.15, 0.025, 0.10), LACQUER, 0.020)
        sphere("Horse blanket jade stud", (x, -0.372, 1.40), (0.032, 0.015, 0.032), JADE, 16, 8)
    rounded_box("Horse rider tiny armour torso", (0, -0.14, 2.12), (0.36, 0.25, 0.36), LACQUER, 0.050)
    for x in (-0.22, 0, 0.22):
        rounded_box("Horse rider chest plate", (x, -0.405, 2.14), (0.085, 0.018, 0.12), LACQUER, 0.015)
        sphere("Horse rider chest jade stud", (x, -0.43, 2.17), (0.022, 0.011, 0.022), JADE, 14, 8)
    sphere("Horse rider round head", (0, -0.16, 2.65), (0.40, 0.35, 0.40), PORTRAIT, 36, 24)
    sphere("Horse rider hair cap", (0, 0.00, 2.77), (0.38, 0.29, 0.34), DEEP_BROWN, 30, 20)
    add_eye_pair("Horse rider", (0, -0.49, 2.71), 0.14, 0.71)
    sphere("Horse rider left brow", (-0.15, -0.51, 2.87), (0.082, 0.012, 0.020), DEEP_BROWN, 18, 10, (0, 0, -0.10))
    sphere("Horse rider right brow", (0.15, -0.51, 2.87), (0.082, 0.012, 0.020), DEEP_BROWN, 18, 10, (0, 0, 0.10))
    cylinder("Horse rider helmet band", (0, -0.13, 2.98), 0.32, 0.09, LACQUER, 32, edge=0.012)
    sphere("Horse rider helmet jade seal", (0, -0.45, 2.98), (0.055, 0.025, 0.055), JADE, 18, 10)
    rounded_box("Horse rider cinnabar belt", (0, -0.40, 1.99), (0.31, 0.025, 0.035), CINNABAR, 0.010)
    sphere("Horse rider jade clasp", (0, -0.44, 2.00), (0.04, 0.02, 0.04), JADE, 16, 8)
    sphere("Horse rider left mitten", (-0.24, -0.49, 2.16), (0.10, 0.075, 0.10), PORTRAIT, 20, 12)
    sphere("Horse rider right mitten", (0.24, -0.49, 2.16), (0.10, 0.075, 0.10), PORTRAIT, 20, 12)
    rounded_box("Horse forehead armour", (0, -1.10, 2.02), (0.16, 0.025, 0.19), LACQUER, 0.030)
    sphere("Horse forehead jade seal", (0, -1.135, 2.07), (0.04, 0.018, 0.04), JADE, 16, 8)
    torus("Horse cinnabar bridle", (0, -1.08, 1.81), 0.24, 0.018, CINNABAR, (math.pi / 2, 0, 0))


def build_cannon() -> None:
    rounded_box("Cannon torsion machine bed", (-0.18, 0.02, 0.70), (0.73, 0.42, 0.13), TERRACOTTA, 0.045)
    for x in (-0.70, 0.34):
        wheel(f"Cannon carriage {x:+.2f}", x, 0.05, 0.65, 0.29)
    for x in (-0.54, 0.18):
        rounded_box("Cannon upright", (x, 0.06, 1.14), (0.09, 0.15, 0.46), LACQUER, 0.025)
        sphere("Cannon jade torsion hub", (x, -0.11, 1.20), (0.12, 0.045, 0.12), JADE, 22, 14)
    rounded_box("Cannon top torsion crossbeam", (-0.18, 0.06, 1.58), (0.55, 0.16, 0.10), LACQUER, 0.025)
    cylinder_between("Cannon left throwing arm", (-0.48, -0.10, 1.18), (-0.08, -0.53, 1.72), 0.055, TERRACOTTA, 20, 0.007)
    cylinder_between("Cannon right throwing arm", (0.12, -0.10, 1.18), (-0.08, -0.53, 1.72), 0.055, TERRACOTTA, 20, 0.007)
    cylinder_between("Cannon visible bow cord left", (-0.48, -0.12, 1.18), (-0.08, -0.58, 1.72), 0.012, EYE_IVORY, 12, 0.002)
    cylinder_between("Cannon visible bow cord right", (0.12, -0.12, 1.18), (-0.08, -0.58, 1.72), 0.012, EYE_IVORY, 12, 0.002)
    sphere("Cannon cinnabar sling stone", (-0.08, -0.61, 1.73), (0.13, 0.10, 0.13), CINNABAR, 24, 14)
    sphere("Cannon engineer large head", (0.53, -0.03, 1.83), (0.40, 0.35, 0.40), PORTRAIT, 34, 22)
    sphere("Cannon engineer hair cap", (0.53, 0.08, 1.94), (0.38, 0.30, 0.34), DEEP_BROWN, 30, 20)
    add_eye_pair("Cannon engineer", (0.53, -0.36, 1.90), 0.14, 0.74)
    sphere("Cannon engineer nose", (0.53, -0.40, 1.78), (0.04, 0.03, 0.04), PORTRAIT, 18, 10)
    sphere("Cannon engineer left brow", (0.39, -0.38, 2.02), (0.075, 0.012, 0.018), DEEP_BROWN, 18, 10, (0, 0, -0.10))
    sphere("Cannon engineer right brow", (0.67, -0.38, 2.02), (0.075, 0.012, 0.018), DEEP_BROWN, 18, 10, (0, 0, 0.10))
    rounded_box("Cannon engineer armour torso", (0.56, 0.02, 1.31), (0.34, 0.26, 0.31), LACQUER, 0.045)
    rounded_box("Cannon engineer red belt", (0.56, -0.25, 1.20), (0.33, 0.025, 0.04), CINNABAR, 0.010)
    sphere("Cannon engineer left mitten", (0.22, -0.38, 1.38), (0.10, 0.08, 0.11), PORTRAIT, 20, 12)
    sphere("Cannon engineer right mitten", (0.68, -0.40, 1.34), (0.10, 0.08, 0.11), PORTRAIT, 20, 12)
    cylinder("Cannon engineer helmet band", (0.53, 0.02, 2.18), 0.29, 0.09, LACQUER, 30, edge=0.012)
    sphere("Cannon engineer jade helmet seal", (0.53, -0.27, 2.18), (0.052, 0.022, 0.052), JADE, 18, 10)
    cylinder("Cannon side winding axle", (-0.18, -0.48, 1.12), 0.06, 0.82, TERRACOTTA, 24, (0, math.pi / 2, 0), 0.008)
    torus("Cannon winding wheel", (-0.62, -0.48, 1.12), 0.18, 0.028, CINNABAR, (0, math.pi / 2, 0))


def build_soldier() -> None:
    add_human_core("Soldier", youthful=True)
    sphere("Soldier compact topknot", (0, 0.08, 2.65), (0.14, 0.12, 0.18), DEEP_BROWN, 24, 14)
    rounded_box("Soldier cinnabar topknot tie", (0, -0.02, 2.55), (0.16, 0.06, 0.035), CINNABAR, 0.012)
    sphere("Soldier jade vest clasp", (0, -0.42, 1.30), (0.055, 0.025, 0.055), JADE, 18, 10)
    for row, z in enumerate((1.10, 1.34)):
        for column, x in enumerate((-0.30, 0, 0.30)):
            rounded_box(f"Soldier front armour plate {row}-{column}", (x, -0.405, z), (0.12, 0.025, 0.095), LACQUER, 0.018)
            sphere(f"Soldier armour jade stud {row}-{column}", (x, -0.437, z + 0.025), (0.023, 0.012, 0.023), JADE, 14, 8)
    for sign in (-1, 1):
        rounded_box("Soldier shoulder guard", (sign * 0.47, -0.17, 1.48), (0.18, 0.04, 0.11), LACQUER, 0.025, (0, -sign * 0.16, sign * 0.06))
    for x in (-0.30, 0, 0.30):
        rounded_box("Soldier skirt armour plate", (x, -0.40, 0.78), (0.12, 0.025, 0.13), LACQUER, 0.018)
    cylinder_between("Soldier tall spear shaft", (0.60, -0.24, 0.48), (0.60, -0.24, 3.15), 0.035, DEEP_BROWN, 20, 0.005)
    cone_between("Soldier spear point", (0.60, -0.24, 3.13), (0.60, -0.24, 3.45), 0.095, 0.008, EYE_IVORY, 24, 0.004)
    rounded_box("Soldier spear red tassel", (0.60, -0.24, 3.07), (0.10, 0.045, 0.07), CINNABAR, 0.018)
    for z in (1.08, 1.42):
        sphere(f"Soldier spear mitten {z:.2f}", (0.54, -0.37, z), (0.11, 0.085, 0.12), PORTRAIT, 22, 14)
    cylinder_between("Soldier left short arm", (-0.38, -0.02, 1.38), (-0.18, -0.35, 1.15), 0.14, LACQUER, 22, 0.010)


ROLE_BUILDERS = {
    "advisor": build_advisor,
    "elephant": build_elephant,
    "chariot": build_chariot,
    "horse": build_horse,
    "cannon": build_cannon,
    "soldier": build_soldier,
}


def look_at(obj, target) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area_light(name, location, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, (0, 0, 1.45))


def add_studio():
    ground_material = simple_material("Matte umber studio floor", (0.018, 0.014, 0.012, 1), 0.96)
    backdrop_material = simple_material("Soft charcoal studio backdrop", (0.028, 0.023, 0.021, 1), 0.96)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.015))
    ground = bpy.context.object
    ground.name = "Studio ground"
    ground.data.materials.append(ground_material)
    bpy.ops.mesh.primitive_plane_add(size=15, location=(0, 3.0, 3.1), rotation=(math.pi / 2, 0, 0))
    backdrop = bpy.context.object
    backdrop.name = "Studio backdrop"
    backdrop.data.materials.append(backdrop_material)
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.006, 0.005, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.13
    area_light("Large warm key", (-4.3, -5.4, 6.2), 1050, 4.3, (1.0, 0.80, 0.64))
    area_light("Soft front fill", (3.1, -4.8, 3.6), 340, 3.8, (0.72, 0.79, 0.92))
    area_light("Cinnabar rear rim", (3.7, 2.7, 5.1), 900, 3.0, (1.0, 0.48, 0.25))
    area_light("Low face bounce", (-1.4, -2.4, 1.0), 180, 2.2, (0.72, 0.48, 0.34))
    camera_data = bpy.data.cameras.new("Cartoon set studio camera")
    camera = bpy.data.objects.new("Cartoon set studio camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = (4.0, -8.2, 3.0)
    camera.data.lens = 74
    look_at(camera, (0, 0, 1.45))
    bpy.context.scene.camera = camera
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    return camera


def build_role(spec) -> None:
    global MODEL
    role = spec["role"]
    title = spec["title"]
    glyph = spec["glyph"]
    name = f"red-{role}-terracotta-cartoon-v1"
    blend_path = MODEL_DIR / f"{name}.blend"
    glb_path = MODEL_DIR / f"{name}.glb"
    hero_path = RENDER_DIR / f"{name}.png"
    front_path = RENDER_DIR / f"{name}-front.png"

    reset_scene()
    MODEL = bpy.data.collections.new(f"Qin Terracotta {title} Cartoon V1 - Editable Parts")
    bpy.context.scene.collection.children.link(MODEL)
    create_palette()
    add_base(glyph)
    ROLE_BUILDERS[role]()

    editable_meshes = [obj for obj in MODEL.objects if obj.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in editable_meshes:
        triangulate_mesh(obj)
        apply_mesh_transform(obj)
    export_collection = bpy.data.collections.new(f"Red {title} Cartoon V1 - Joined Render and GLB Mesh")
    bpy.context.scene.collection.children.link(export_collection)
    export_parts = []
    for source in editable_meshes:
        duplicate = source.copy()
        duplicate.data = source.data.copy()
        export_collection.objects.link(duplicate)
        export_parts.append(duplicate)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in export_parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = export_parts[0]
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = f"Red {title} Qin Terracotta Cartoon V1 - Joined Mesh"
    MODEL.hide_render = True

    editable_signature, editable_material_signature, editable_triangles = canonical_triangle_signature(editable_meshes)
    joined_signature, joined_material_signature, joined_triangles = canonical_triangle_signature([body])
    if editable_triangles != joined_triangles:
        raise RuntimeError(f"{role}: editable and joined triangle counts differ")
    if editable_signature != joined_signature or editable_material_signature != joined_material_signature:
        raise RuntimeError(
            f"{role}: editable parts and joined source differ; "
            f"geometry={editable_signature == joined_signature}, "
            f"materials={editable_material_signature == joined_material_signature}"
        )
    manifest = {
        "source_role": role,
        "source_glyph": glyph,
        "source_glyph_kind": "cjk_font_outline",
        "source_glyph_codepoint": ord(glyph),
        "source_glyph_font_glyph_id": GLYPH_FONT_GLYPH_IDS[glyph],
        "source_editable_signature_sha256": editable_signature,
        "source_joined_signature_sha256": joined_signature,
        "source_editable_material_signature_sha256": editable_material_signature,
        "source_joined_material_signature_sha256": joined_material_signature,
        "source_triangle_count": joined_triangles,
        "source_primitive_only": True,
        "source_style_family": STYLE_FAMILY,
    }
    for key, value in manifest.items():
        body[key] = value

    camera = add_studio()
    scene = bpy.context.scene
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(hero_path)
    bpy.ops.render.render(write_still=True)
    camera.location = (0, -8.0, 1.55)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ORTHO_SCALES[role]
    look_at(camera, (0, 0, 1.55))
    scene.render.filepath = str(front_path)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    if len(body.data.materials) != 9:
        raise RuntimeError(f"{role}: expected nine consolidated materials, got {len(body.data.materials)}")
    for index, source_material in enumerate(tuple(body.data.materials)):
        body.data.materials[index] = gltf_material(source_material)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_extras=True,
    )
    print(f"ROLE_BUILT={role}")
    print(f"EDITABLE_PARTS={len(editable_meshes)}")
    print(f"TRIANGLES={joined_triangles}")
    print(f"BLEND={blend_path}")
    print(f"GLB={glb_path}")


for role_spec in ROLES:
    build_role(role_spec)

print(f"SET_BUILT={STYLE_FAMILY}")
