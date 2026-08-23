from __future__ import annotations

import importlib
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
NAME = "red-marshal-terracotta-v4"
GLB_PATH = ROOT / "assets" / "models" / f"{NAME}.glb"
RENDER_DIR = ROOT / "assets" / "renders" / NAME
HERO_PATH = ROOT / "assets" / "renders" / f"{NAME}.png"
BLEND_PATH = ROOT / "assets" / "models" / f"{NAME}.blend"
ANATOMY_SOURCE_PATH = ROOT / "assets" / "models" / "red-marshal-six-view-aligned-v3.glb"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/Songti.ttc")


def dynamic_import(package_suffix: str, key: str):
    for module_name in sys.modules:
        if module_name.endswith(package_suffix):
            return getattr(importlib.import_module(module_name), key)
    raise RuntimeError(f"MPFB is not loaded: {package_suffix}")


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def material(name, color, roughness=0.82, metallic=0.0, noise=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if noise:
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 7.5
        tex.inputs["Detail"].default_value = 5.0
        tex.inputs["Roughness"].default_value = 0.72
        ramp = nodes.new("ShaderNodeValToRGB")
        dark = tuple(max(0.0, c * 0.72) for c in color[:3]) + (1.0,)
        light = tuple(min(1.0, c * 1.14) for c in color[:3]) + (1.0,)
        ramp.color_ramp.elements[0].color = dark
        ramp.color_ramp.elements[1].color = light
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.16
        bump.inputs["Distance"].default_value = 0.035
        links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(tex.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def register(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    MODEL.objects.link(obj)
    return obj


def smooth(obj) -> None:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def bevel(obj, width, segments=2) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Subtle hand-worn edge", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def rounded_box(name, location, scale, mat, edge=0.015, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if edge:
        bevel(obj, edge, 2)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def sphere(name, location, scale, mat, segments=36, rings=22):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    obj.select_set(False)
    return obj


def cylinder(name, location, radius, depth, mat, vertices=48, rotation=(0, 0, 0), edge=0.012):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    if edge:
        bevel(obj, edge, 2)
    smooth(obj)
    return obj


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=64,
        minor_segments=10,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def cylinder_between(name, start, end, radius, mat, vertices=28, edge=0.012):
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
    obj.data.materials.append(mat)
    if edge:
        bevel(obj, edge, 2)
    smooth(obj)
    return obj


def cone_between(name, start, end, radius_start, radius_end, mat, vertices=36, edge=0.012):
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
    obj.data.materials.append(mat)
    if edge:
        bevel(obj, edge, 2)
    smooth(obj)
    return obj


def curve(name, points, radius, mat, resolution=3):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 8
    data.bevel_depth = radius
    data.bevel_resolution = resolution
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = register(bpy.data.objects.new(name, data))
    obj.data.materials.append(mat)
    return obj


def loft(name, rings, mat, segments=48, edge=0.012):
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
    top = (len(rings) - 1) * segments
    faces.append(tuple(top + index for index in range(segments)))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = register(bpy.data.objects.new(name, mesh))
    obj.data.materials.append(mat)
    smooth(obj)
    if edge:
        bevel(obj, edge, 2)
    return obj


def lamella(name, x, y, z, width, height, mat, rotation=(0, 0, 0)):
    """A thin Qin-style overlapping scale with a shallow pointed lower edge."""
    w = width * 0.5
    h = height * 0.5
    d = 0.012
    outline = [(-w, h), (w, h), (w, -h * 0.45), (w * 0.52, -h), (0, -h * 1.12), (-w * 0.52, -h), (-w, -h * 0.45)]
    verts = [(px, -d, pz) for px, pz in outline] + [(px, d, pz) for px, pz in outline]
    count = len(outline)
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for i in range(count):
        nxt = (i + 1) % count
        faces.append((i, nxt, count + nxt, count + i))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = register(bpy.data.objects.new(name, mesh))
    obj.location = (x, y, z)
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    bevel(obj, 0.006, 2)
    smooth(obj)
    return obj


def look_at(obj, target):
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
    look_at(obj, (0, 0, 2.25))


reset_scene()
MODEL = bpy.data.collections.new("Qin Terracotta Marshal V4")
bpy.context.scene.collection.children.link(MODEL)

# Restrained archaeological palette with faint surviving vermilion traces.
clay = material("Weathered Qin clay", (0.38, 0.205, 0.105, 1), 0.9, noise=True)
clay_light = material("Worn clay edges", (0.52, 0.31, 0.18, 1), 0.88, noise=True)
clay_dark = material("Clay recesses and hair", (0.105, 0.062, 0.035, 1), 0.94, noise=True)
armor_clay = material("Dark lacquered lamellar", (0.18, 0.105, 0.055, 1), 0.86, noise=True)
vermilion = material("Faded Qin vermilion", (0.37, 0.045, 0.025, 1), 0.8, noise=True)
bronze = material("Aged bronze fittings", (0.18, 0.21, 0.16, 1), 0.58, 0.28, noise=True)
base_clay = material("Fired clay chess base", (0.25, 0.135, 0.07, 1), 0.92, noise=True)

# Extract only the realistic anatomy faces from our own earlier GLB. Every old costume
# face is discarded, so V4 has no dependency on the V3 crown, armour or robe design.
if not ANATOMY_SOURCE_PATH.exists():
    raise FileNotFoundError(ANATOMY_SOURCE_PATH)
bpy.ops.import_scene.gltf(filepath=str(ANATOMY_SOURCE_PATH))
imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(imported_meshes) != 1:
    raise RuntimeError(f"Expected one anatomy source mesh, got {len(imported_meshes)}")
body = imported_meshes[0]
body.name = "Terracotta face and hands"
skin_slots = [index for index, slot in enumerate(body.material_slots) if "skin" in slot.name.lower()]
if not skin_slots:
    raise RuntimeError("Could not find the Sculpt skin material in the V3 anatomy source")
skin_index = skin_slots[0]
mesh_bm = bmesh.new()
mesh_bm.from_mesh(body.data)
mesh_bm.faces.ensure_lookup_table()
bmesh.ops.delete(mesh_bm, geom=[face for face in mesh_bm.faces if face.material_index != skin_index], context="FACES")
# Keep only the portrait and the two hands. The source's bare torso and arms were useful
# during posing but must not survive into a fully clothed Qin military officer.
def keep_visible_anatomy(face):
    center = face.calc_center_median()
    is_portrait = center.z > 3.5 or (center.z > 3.31 and abs(center.x) < 0.27)
    is_hand = 2.33 < center.z < 2.9 and center.y < -0.38 and abs(center.x) < 0.58
    return is_portrait or is_hand


bmesh.ops.delete(mesh_bm, geom=[face for face in mesh_bm.faces if not keep_visible_anatomy(face)], context="FACES")
bmesh.ops.delete(mesh_bm, geom=[vert for vert in mesh_bm.verts if not vert.link_faces], context="VERTS")
mesh_bm.to_mesh(body.data)
mesh_bm.free()
for collection in list(body.users_collection):
    collection.objects.unlink(body)
MODEL.objects.link(body)
body.data.materials.clear()
body.data.materials.append(clay)
for polygon in body.data.polygons:
    polygon.material_index = 0
smooth(body)

# The source pose is a quiet two-handed command pose; these landmarks wrap fitted sleeves
# around the arms without requiring the original temporary skeleton.
arm_points = {
    "l": {
        "shoulder": Vector((0.45, -0.09, 3.16)),
        "elbow": Vector((0.7, -0.56, 2.76)),
        "wrist": Vector((0.25, -0.69, 2.55)),
    },
    "r": {
        "shoulder": Vector((-0.45, -0.09, 3.16)),
        "elbow": Vector((-0.7, -0.56, 2.76)),
        "wrist": Vector((-0.23, -0.7, 2.57)),
    },
}

# Chess-piece plinth derived from rammed-earth and Qin bronze ring motifs.
cylinder("Lower fired-clay plinth", (0, 0, 0.11), 1.23, 0.22, base_clay, 72, edge=0.035)
cylinder("Recessed vermilion ring", (0, 0, 0.275), 1.17, 0.13, vermilion, 72, edge=0.025)
cylinder("Upper fired-clay plinth", (0, 0, 0.42), 1.1, 0.18, base_clay, 72, edge=0.028)
torus("Upper bronze ring", (0, 0, 0.52), 1.04, 0.023, bronze)
torus("Lower worn ring", (0, 0, 0.21), 1.17, 0.018, clay_light)
cylinder("Underside plate", (0, 0, -0.025), 1.03, 0.05, clay_dark, 64, edge=0.01)
for angle in (math.radians(45), math.radians(-45)):
    rounded_box("Underside brace", (0, 0, -0.062), (0.72, 0.055, 0.022), base_clay, 0.012, rotation=(0, 0, angle))

# Full-length Qin robe, deliberately narrow at the shoulder and gently flared at the hem.
rounded_box("Left boot", (-0.2, -0.08, 0.64), (0.145, 0.255, 0.095), clay_dark, 0.035)
rounded_box("Right boot", (0.2, -0.08, 0.64), (0.145, 0.255, 0.095), clay_dark, 0.035)
loft(
    "Double-layer Qin long robe",
    [
        (0.67, 0.7, 0.34, 0.035),
        (1.15, 0.69, 0.35, 0.025),
        (1.85, 0.61, 0.34, 0.01),
        (2.45, 0.55, 0.32, 0.0),
        (2.96, 0.53, 0.31, 0.0),
        (3.2, 0.48, 0.29, 0.0),
    ],
    clay,
    60,
)
loft(
    "High-neck Qin under-tunic",
    [
        (2.38, 0.49, 0.29, -0.005),
        (2.82, 0.5, 0.3, -0.005),
        (3.18, 0.47, 0.285, 0.0),
        (3.34, 0.38, 0.255, 0.0),
        (3.45, 0.27, 0.22, 0.015),
    ],
    clay,
    56,
)

# Crossed collar, waist sash, and understated surviving pigment.
curve("Left crossed collar", [(-0.32, -0.31, 3.22), (-0.12, -0.365, 3.02), (0.18, -0.36, 2.78)], 0.025, clay_light)
curve("Right crossed collar", [(0.32, -0.31, 3.22), (0.08, -0.37, 2.98), (-0.18, -0.36, 2.78)], 0.025, clay_light)
rounded_box("Command sash", (0, -0.02, 2.33), (0.52, 0.31, 0.055), vermilion, 0.018)
rounded_box("Bronze sash buckle", (0, -0.34, 2.33), (0.11, 0.022, 0.085), bronze, 0.012)

# Tapered sleeves follow the command pose and terminate exactly at the retained hands.
for side in ("l", "r"):
    shoulder = arm_points[side]["shoulder"]
    elbow = arm_points[side]["elbow"]
    wrist = arm_points[side]["wrist"]
    cone_between(f"Upper robe sleeve {side}", shoulder, elbow, 0.17, 0.145, clay, 40, 0.016)
    cone_between(f"Forearm robe sleeve {side}", elbow, wrist, 0.145, 0.105, clay, 40, 0.014)
    cylinder_between(f"Narrow cuff {side}", elbow.lerp(wrist, 0.78), wrist, 0.11, vermilion, 36, 0.01)

# Dense overlapping fish-scale armour: small plates, tapered silhouette, no checkerboard blocks.
for row in range(13):
    z = 1.43 + row * 0.13
    t = row / 12
    half_width = 0.43 - 0.045 * t
    columns = 11 if row < 8 else 10
    for column in range(columns):
        spacing = (half_width * 2) / (columns - 1)
        x = -half_width + column * spacing
        if columns == 10:
            x += spacing * 0.08
        y = -0.365 - 0.035 * (1.0 - (x / max(half_width, 0.01)) ** 2)
        lamella(f"Front fish-scale {row:02}-{column:02}", x, y, z, 0.092, 0.115, armor_clay)

# Back armour is quieter but still reads correctly in the orthographic rear view.
for row in range(11):
    z = 1.62 + row * 0.135
    half_width = 0.41 - 0.035 * (row / 10)
    for column in range(10):
        spacing = (half_width * 2) / 9
        x = -half_width + column * spacing
        y = 0.335 + 0.025 * (1.0 - (x / max(half_width, 0.01)) ** 2)
        lamella(f"Back fish-scale {row:02}-{column:02}", x, y, z, 0.09, 0.112, armor_clay, rotation=(0, 0, math.pi))

# Shoulder scales hug the body. Rank knots identify the high-ranking officer.
for side, sign in (("left", -1), ("right", 1)):
    for layer in range(5):
        rounded_box(
            f"Shoulder scale {side}-{layer}",
            (sign * (0.48 + layer * 0.04), -0.035, 3.15 - layer * 0.09),
            (0.12, 0.255, 0.026),
            armor_clay,
            0.012,
            rotation=(0, -sign * math.radians(12 + layer * 4), 0),
        )
    curve(f"Rank ribbon loop {side}", [(sign * 0.48, -0.37, 2.94), (sign * 0.6, -0.43, 2.82), (sign * 0.46, -0.4, 2.69)], 0.025, vermilion)
    curve(f"Rank ribbon tail {side}", [(sign * 0.5, -0.39, 2.72), (sign * 0.57, -0.4, 2.48), (sign * 0.5, -0.37, 2.31)], 0.018, vermilion)

# Vertical sword and two-handed command pose, adapted from the official high officer figure.
cylinder_between("Long command sword scabbard", (0, -0.49, 0.82), (0, -0.49, 2.43), 0.045, clay_dark, 28, 0.01)
cylinder_between("Sword grip", (0, -0.5, 2.4), (0, -0.5, 2.76), 0.035, bronze, 28, 0.01)
rounded_box("Sword guard", (0, -0.5, 2.42), (0.18, 0.04, 0.025), bronze, 0.01)
sphere("Sword pommel", (0, -0.5, 2.78), (0.055, 0.055, 0.055), bronze, 24, 14)

# Qin heguan: low cap, central hair knot, restrained paired pheasant-feather curves.
sphere("Hair mass", (0, 0.09, 4.01), (0.22, 0.21, 0.13), clay_dark, 40, 24)
cylinder("Low heguan cap", (0, 0.045, 4.08), 0.205, 0.15, clay_dark, 48, edge=0.014)
rounded_box("Heguan front plaque", (0, -0.238, 4.09), (0.12, 0.018, 0.095), bronze, 0.012)
sphere("Central hair knot", (0, 0.055, 4.21), (0.09, 0.08, 0.115), clay_dark, 30, 18)
curve("Left pheasant feather", [(-0.025, 0.055, 4.24), (-0.075, 0.06, 4.46), (-0.13, 0.05, 4.58), (-0.18, 0.03, 4.49)], 0.012, clay_dark)
curve("Right pheasant feather", [(0.025, 0.055, 4.24), (0.075, 0.06, 4.46), (0.13, 0.05, 4.58), (0.18, 0.03, 4.49)], 0.012, clay_dark)

# Archaeological portrait detail: short moustache and compact beard, never fantasy-long.
curve("Left moustache", [(-0.01, -0.34, 3.72), (-0.09, -0.365, 3.7), (-0.16, -0.34, 3.71)], 0.009, clay_dark)
curve("Right moustache", [(0.01, -0.34, 3.72), (0.09, -0.365, 3.7), (0.16, -0.34, 3.71)], 0.009, clay_dark)
curve("Compact chin beard", [(0, -0.34, 3.62), (0, -0.37, 3.5), (0, -0.33, 3.4)], 0.035, clay_dark, 4)

# Recessed faction label on the plinth.
bpy.ops.object.text_add(location=(0, -1.105, 0.34), rotation=(math.pi / 2, 0, 0))
label = register(bpy.context.object)
label.name = "Marshal character label"
label.data.body = "帅"
label.data.align_x = "CENTER"
label.data.align_y = "CENTER"
label.data.size = 0.31
label.data.extrude = 0.012
label.data.bevel_depth = 0.004
if FONT_PATH.exists():
    label.data.font = bpy.data.fonts.load(str(FONT_PATH))
label.data.materials.append(bronze)

# Convert all curves and text, then merge to one static web mesh with material slots.
for obj in list(MODEL.objects):
    if obj.type not in {"CURVE", "FONT"}:
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    smooth(obj)
    obj.select_set(False)

bpy.ops.object.select_all(action="DESELECT")
mesh_objects = [obj for obj in MODEL.objects if obj.type == "MESH"]
for obj in mesh_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body = bpy.context.object
body.name = "Red Marshal Qin Terracotta V4"

# Studio render setup.
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.03))
ground = bpy.context.object
ground.data.materials.append(material("Studio ground", (0.028, 0.022, 0.018, 1), 0.96))
world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.009, 0.007, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.24
area_light("Warm key", (4.8, -6.7, 7.2), 1250, 4.0, (1.0, 0.72, 0.48))
area_light("Cool fill", (-4.3, -3.2, 5.0), 620, 3.5, (0.52, 0.68, 1.0))
area_light("Earthen rim", (3.0, 4.5, 6.0), 1050, 3.0, (1.0, 0.4, 0.19))

camera_data = bpy.data.cameras.new("V4 camera")
camera = bpy.data.objects.new("V4 camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (5.6, -9.8, 4.0)
camera.data.lens = 68
look_at(camera, (0, 0, 2.25))
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1280
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(HERO_PATH)
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = False
HERO_PATH.parent.mkdir(parents=True, exist_ok=True)
RENDER_DIR.mkdir(parents=True, exist_ok=True)
GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)

# Every validation view comes from the exact exported mesh.
ground.hide_render = True
area_light("Underside validation fill", (0, 0, -6), 900, 4.0, (0.72, 0.8, 1.0))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 5.2
scene.render.resolution_x = 720
scene.render.resolution_y = 720
views = {
    "front": ((0, -9, 2.35), (0, 0, 2.35)),
    "back": ((0, 9, 2.35), (0, 0, 2.35)),
    "right": ((9, 0, 2.35), (0, 0, 2.35)),
    "left": ((-9, 0, 2.35), (0, 0, 2.35)),
    "top": ((0, 0, 10), (0, 0, 0)),
    "bottom": ((0, 0, -10), (0, 0, 0)),
}
for view_name, (location, target) in views.items():
    camera.location = location
    look_at(camera, target)
    scene.render.filepath = str(RENDER_DIR / f"{view_name}.png")
    bpy.ops.render.render(write_still=True)

# Save an editable source and a clean single-node GLB.
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
)
body.data.calc_loop_triangles()
print(f"EXPORT_GLTF={GLB_PATH}")
print(f"EDITABLE_BLEND={BLEND_PATH}")
print(f"HERO_RENDER={HERO_PATH}")
print(f"SIX_VIEW_DIR={RENDER_DIR}")
print("MESH_OBJECTS=1")
print(f"TRIANGLES={len(body.data.loop_triangles)}")
print(f"MATERIALS={len(body.data.materials)}")
