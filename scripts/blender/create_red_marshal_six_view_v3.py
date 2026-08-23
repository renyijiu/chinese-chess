from __future__ import annotations

import importlib
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "assets" / "models" / "red-marshal-six-view-aligned-v3.glb"
RENDER_PATH = ROOT / "assets" / "renders" / "red-marshal-six-view-aligned-v3.png"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/Songti.ttc")


def dynamic_import(package_suffix: str, key: str):
    for module_name in sys.modules:
        if module_name.endswith(package_suffix):
            return getattr(importlib.import_module(module_name), key)
    raise RuntimeError(f"MPFB is not loaded: {package_suffix}")


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def material(name, color, roughness=0.72, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def register(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    MODEL_COLLECTION.objects.link(obj)
    return obj


def smooth(obj) -> None:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def apply_bevel(obj, width, segments=2) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("Hand-finished edge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def rounded_box(name, location, scale, mat, bevel=0.025, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_bevel(obj, bevel, 3)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def uv_sphere(name, location, scale, mat, segments=32, rings=20):
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


def cylinder(name, location, radius, depth, mat, vertices=48, rotation=(0, 0, 0), bevel=0.018):
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
    if bevel:
        apply_bevel(obj, bevel, 2)
    smooth(obj)
    return obj


def cone(name, location, radius1, radius2, depth, mat, vertices=32, rotation=(0, 0, 0), bevel=0.012):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        apply_bevel(obj, bevel, 2)
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


def cylinder_between(name, start, end, radius, mat, vertices=28, bevel=0.02):
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
    if bevel:
        apply_bevel(obj, bevel, 3)
    smooth(obj)
    return obj


def loft(name, rings, mat, segments=36):
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
    bevel = obj.modifiers.new("Tailored cloth edge", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


def curve_object(name, points, radius, mat, resolution=3):
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 8
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = resolution
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = register(bpy.data.objects.new(name, curve_data))
    obj.data.materials.append(mat)
    return obj


def cape(name, mat):
    rows = 18
    columns = 24
    vertices = []
    faces = []
    for row in range(rows):
        t = row / (rows - 1)
        z = 0.7 + t * 2.52
        half_width = 0.83 - 0.25 * t
        for column in range(columns):
            u = column / (columns - 1)
            x = -half_width + 2 * half_width * u
            y = 0.36 + 0.035 * math.cos(u * math.pi * 5) * (1.0 - 0.45 * t)
            vertices.append((x, y, z))
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = a + columns + 1
            d = a + columns
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = register(bpy.data.objects.new(name, mesh))
    obj.data.materials.append(mat)
    solidify = obj.modifiers.new("Woven thickness", "SOLIDIFY")
    solidify.thickness = 0.035
    subdivision = obj.modifiers.new("Large cloth folds", "SUBSURF")
    subdivision.levels = 1
    subdivision.render_levels = 1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    bpy.ops.object.modifier_apply(modifier=subdivision.name)
    obj.select_set(False)
    smooth(obj)
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(name, location, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, (0, 0, 2.25))
    return obj


reset_scene()
MODEL_COLLECTION = bpy.data.collections.new("Red Marshal Realistic V2")
bpy.context.scene.collection.children.link(MODEL_COLLECTION)

skin = material("Sculpt skin", (0.43, 0.39, 0.35, 1), 0.8)
cloth = material("Sculpt cloth", (0.28, 0.25, 0.22, 1), 0.88)
armor = material("Sculpt forged metal", (0.36, 0.33, 0.29, 1), 0.52, 0.32)
raised = material("Sculpt raised detail", (0.56, 0.51, 0.44, 1), 0.72)
hair = material("Sculpt hair and recess", (0.095, 0.08, 0.07, 1), 0.93)
stone = material("Sculpt stone base", (0.24, 0.225, 0.21, 1), 0.95)

# Anatomical base: a middle-aged Asian male with realistic adult proportions.
HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
macro = {
    "gender": 1.0,
    "age": 0.72,
    "muscle": 0.58,
    "weight": 0.52,
    "height": 0.58,
    "proportions": 0.58,
    "cupsize": 0.0,
    "firmness": 0.5,
    "race": {"asian": 1.0, "african": 0.0, "caucasian": 0.0},
}
human = HumanService.create_human(
    mask_helpers=True,
    detailed_helpers=True,
    extra_vertex_groups=False,
    feet_on_ground=True,
    scale=0.25,
    macro_detail_dict=macro,
)
human.name = "Anatomical Asian male source"
human.data.materials.clear()
human.data.materials.append(skin)
for polygon in human.data.polygons:
    polygon.material_index = 0
    polygon.use_smooth = True

rig = HumanService.add_builtin_rig(human, "game_engine", import_weights=True)
rig.name = "Temporary posing rig"
pose_helpers = []
for side, target_x, target_z, elbow_x in (("l", 0.35, 2.68, 0.9), ("r", -0.28, 2.7, -0.9)):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(target_x, -0.58, target_z))
    target = bpy.context.object
    pose_helpers.append(target)
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(elbow_x, -0.28, 2.7))
    pole = bpy.context.object
    pose_helpers.append(pole)
    lower_arm = rig.pose.bones[f"lowerarm_{side}"]
    lower_arm.ik_stretch = 0.0
    constraint = lower_arm.constraints.new("IK")
    constraint.target = target
    constraint.pole_target = pole
    constraint.chain_count = 2
    constraint.pole_angle = math.pi if side == "r" else 0.0

bpy.context.view_layer.update()

def pose_point(bone_name, use_tail=False):
    bone = rig.pose.bones[bone_name]
    point = bone.tail if use_tail else bone.head
    return rig.matrix_world @ point


arm_points = {
    side: {
        "shoulder": pose_point(f"upperarm_{side}"),
        "elbow": pose_point(f"lowerarm_{side}"),
        "wrist": pose_point(f"hand_{side}"),
    }
    for side in ("l", "r")
}

# Freeze the posed, evaluated body so the GLB is a clean static game asset.
depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated = human.evaluated_get(depsgraph)
static_mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
body = bpy.data.objects.new("Anatomical body and hands", static_mesh)
MODEL_COLLECTION.objects.link(body)
body.matrix_world = evaluated.matrix_world.copy()
body.data.materials.clear()
body.data.materials.append(skin)
smooth(body)

for obj in [human, rig, *pose_helpers]:
    bpy.data.objects.remove(obj, do_unlink=True)

# Chess-piece plinth, kept broad enough to read from the game camera.
cylinder("Base lower", (0, 0, 0.12), 1.34, 0.24, stone, 72, bevel=0.045)
cylinder("Base middle", (0, 0, 0.31), 1.27, 0.16, armor, 72, bevel=0.032)
cylinder("Base upper", (0, 0, 0.47), 1.18, 0.18, stone, 72, bevel=0.032)
torus("Base upper rim", (0, 0, 0.57), 1.12, 0.025, raised)
torus("Base lower rim", (0, 0, 0.23), 1.25, 0.022, raised)
for index in range(12):
    angle = 2 * math.pi * index / 12
    rounded_box(
        f"Base inlay {index}",
        (1.275 * math.sin(angle), -1.275 * math.cos(angle), 0.31),
        (0.035, 0.018, 0.06),
        raised,
        0.009,
        rotation=(0, 0, -angle),
    )

# Underside structure visible in the supplied bottom view.
cylinder("Underside plate", (0, 0, -0.025), 1.08, 0.05, armor, 64, bevel=0.012)
cylinder("Underside central hub", (0, 0, -0.065), 0.3, 0.075, stone, 48, bevel=0.018)
for index, angle in enumerate((math.radians(45), math.radians(-45))):
    rounded_box(
        f"Underside cross brace {index}",
        (0, 0, -0.068),
        (0.78, 0.065, 0.026),
        stone,
        0.016,
        rotation=(0, 0, angle),
    )

# Six-view aligned costume: broad A-line outer coat, narrow apron and hanging sleeves.
rounded_box("Boot left", (-0.22, -0.08, 0.68), (0.17, 0.29, 0.115), hair, 0.045)
rounded_box("Boot right", (0.22, -0.08, 0.68), (0.17, 0.29, 0.115), hair, 0.045)
loft(
    "Full length ceremonial coat",
    [
        (0.76, 0.82, 0.42, 0.03),
        (1.2, 0.8, 0.41, 0.025),
        (1.9, 0.7, 0.38, 0.015),
        (2.55, 0.6, 0.35, 0.0),
        (3.08, 0.54, 0.32, 0.0),
        (3.26, 0.5, 0.29, 0.0),
    ],
    cloth,
    56,
)
cape("Broad embroidered back cloak", cloth)

# Narrow inner breastplate and belt visible through the open front of the robe.
loft(
    "Inner fitted breastplate",
    [
        (2.35, 0.42, 0.27, -0.02),
        (2.7, 0.47, 0.29, -0.02),
        (3.02, 0.49, 0.29, -0.01),
        (3.23, 0.45, 0.27, 0.0),
    ],
    armor,
    48,
)
loft(
    "Layered brocade chest robe",
    [
        (2.45, 0.43, 0.28, -0.035),
        (2.85, 0.47, 0.3, -0.035),
        (3.2, 0.49, 0.29, -0.02),
        (3.43, 0.37, 0.25, -0.01),
    ],
    cloth,
    48,
)
rounded_box("Wide command belt", (0, -0.02, 2.39), (0.5, 0.3, 0.065), raised, 0.022)
cylinder("Lion belt boss", (0, -0.335, 2.39), 0.17, 0.055, armor, 48, rotation=(math.pi / 2, 0, 0), bevel=0.016)
uv_sphere("Lion brow", (0, -0.395, 2.43), (0.11, 0.025, 0.055), raised, 24, 12)
uv_sphere("Lion muzzle", (0, -0.405, 2.34), (0.075, 0.022, 0.06), raised, 24, 12)

# The reference has a narrow five-column lamellar apron ending above the boots.
for row in range(7):
    for column in range(5):
        x = -0.26 + column * 0.13
        z = 1.45 + row * 0.13
        rounded_box(
            f"Narrow apron lamella {row:02}-{column:02}",
            (x, -0.405, z),
            (0.052, 0.017, 0.052),
            raised if column in (0, 4) else armor,
            0.009,
        )

# Long sleeve masses reproduce the low hanging silhouette from front, side and back views.
for side, sign in (("left", -1), ("right", 1)):
    sleeve = loft(
        f"Hanging robe sleeve {side}",
        [
            (1.82, 0.28, 0.17, 0.02),
            (2.12, 0.3, 0.21, -0.01),
            (2.5, 0.27, 0.23, -0.01),
            (2.92, 0.24, 0.22, 0.0),
            (3.18, 0.2, 0.2, 0.0),
        ],
        cloth,
        40,
    )
    sleeve.location.x = sign * 0.61
    shoulder = arm_points["r" if sign < 0 else "l"]["shoulder"]
    elbow = arm_points["r" if sign < 0 else "l"]["elbow"]
    wrist = arm_points["r" if sign < 0 else "l"]["wrist"]
    cuff_start = elbow.lerp(wrist, 0.64)
    cuff_end = elbow.lerp(wrist, 0.84)
    cylinder_between(f"Narrow sleeve cuff {side}", cuff_start, cuff_end, 0.13, raised, 32, 0.012)

# Close-fitting red under-sleeves cover the anatomical arms; the wider panels above provide the drape.
for side in ("l", "r"):
    shoulder = arm_points[side]["shoulder"]
    elbow = arm_points[side]["elbow"]
    wrist = arm_points[side]["wrist"]
    cylinder_between(
        f"Cloth upper sleeve {side}",
        shoulder.lerp(elbow, 0.08),
        shoulder.lerp(elbow, 0.94),
        0.112,
        cloth,
        32,
        0.018,
    )
    cylinder_between(
        f"Cloth forearm sleeve {side}",
        elbow.lerp(wrist, 0.05),
        elbow.lerp(wrist, 0.68),
        0.105,
        cloth,
        32,
        0.016,
    )

# Compact segmented pauldrons descend along the upper arm instead of projecting sideways.
for side, sign in (("left", -1), ("right", 1)):
    for layer in range(3):
        rounded_box(
            f"Compact shoulder lamella {side}-{layer}",
            (sign * (0.55 + layer * 0.045), -0.06, 3.22 - layer * 0.095),
            (0.17, 0.265, 0.038),
            raised if layer == 0 else armor,
            0.018,
            rotation=(0, -sign * math.radians(7 + layer * 4), 0),
        )

# Open-front coat borders, high collar and hem trim visible in the reference.
curve_object("High collar left", [(-0.31, -0.3, 3.3), (-0.24, -0.36, 3.48), (-0.12, -0.34, 3.53)], 0.026, raised)
curve_object("High collar right", [(0.31, -0.3, 3.3), (0.24, -0.36, 3.48), (0.12, -0.34, 3.53)], 0.026, raised)
for index, x in enumerate((-0.47, 0.47)):
    curve_object(
        f"Open coat border {index}",
        [(x, -0.375, 0.82), (x * 0.92, -0.405, 1.7), (x * 0.72, -0.38, 2.5), (x * 0.6, -0.32, 3.18)],
        0.022,
        raised,
    )
curve_object("Coat hem trim", [(-0.72, -0.32, 0.84), (0, -0.43, 0.76), (0.72, -0.32, 0.84)], 0.022, raised)

# Narrow three-post ceremonial crown from the six-view board; no helmet brim or side wings.
uv_sphere("Hair cap", (0, -0.005, 4.02), (0.3, 0.27, 0.17), hair, 36, 20)
cylinder("Crown body", (0, -0.005, 4.08), 0.285, 0.22, armor, 44, bevel=0.016)
cylinder("Crown lower band", (0, -0.005, 3.99), 0.31, 0.065, raised, 48, bevel=0.014)
rounded_box("Crown front jewel plate", (0, -0.286, 4.1), (0.14, 0.018, 0.1), raised, 0.014)
for index, x in enumerate((-0.16, 0, 0.16)):
    height = 0.38 if index == 1 else 0.31
    rounded_box(
        f"Crown vertical post {index}",
        (x, -0.005, 4.22 + height * 0.5),
        (0.034, 0.038, height * 0.5),
        raised,
        0.012,
    )
    uv_sphere(f"Crown post finial {index}", (x, -0.005, 4.23 + height), (0.045, 0.045, 0.05), raised, 18, 10)

# Mature face, moustache and continuous long beard matching the front and side portraits.
curve_object("Brow left", [(-0.19, -0.325, 3.91), (-0.12, -0.35, 3.93), (-0.04, -0.335, 3.91)], 0.011, hair)
curve_object("Brow right", [(0.19, -0.325, 3.91), (0.12, -0.35, 3.93), (0.04, -0.335, 3.91)], 0.011, hair)
curve_object("Moustache left", [(-0.01, -0.37, 3.68), (-0.1, -0.39, 3.65), (-0.2, -0.35, 3.66)], 0.014, hair)
curve_object("Moustache right", [(0.01, -0.37, 3.68), (0.1, -0.39, 3.65), (0.2, -0.35, 3.66)], 0.014, hair)
loft(
    "Long continuous beard",
    [
        (2.98, 0.06, 0.03, -0.305),
        (3.28, 0.13, 0.046, -0.335),
        (3.57, 0.18, 0.04, -0.33),
    ],
    hair,
    30,
)
for index, x in enumerate((-0.08, 0, 0.08)):
    curve_object(
        f"Fine beard groove {index}",
        [(x, -0.38, 3.54), (x * 0.82, -0.395, 3.3), (x * 0.45, -0.345, 3.04)],
        0.006,
        raised,
        3,
    )

# Sword sits at the right hip and follows the side-view angle.
cylinder_between("Sword scabbard", (0.72, -0.24, 2.36), (0.94, -0.08, 0.94), 0.05, hair, 24, 0.014)
cylinder_between("Sword grip", (0.71, -0.25, 2.35), (0.66, -0.29, 2.66), 0.036, raised, 24, 0.012)
rounded_box("Sword guard", (0.7, -0.25, 2.36), (0.17, 0.045, 0.03), raised, 0.012, rotation=(0, 0.12, 0.03))

# Convert text and curve details into meshes for a self-contained GLB.
for obj in list(MODEL_COLLECTION.objects):
    if obj.type not in {"CURVE", "FONT"}:
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    smooth(obj)
    obj.select_set(False)

# Merge into one web-friendly mesh node while preserving material slots.
bpy.ops.object.select_all(action="DESELECT")
mesh_objects = [obj for obj in MODEL_COLLECTION.objects if obj.type == "MESH"]
for obj in mesh_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body = bpy.context.object
body.name = "Red Marshal six-view aligned V3"

# Studio preview.
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.02))
ground = bpy.context.object
ground.data.materials.append(material("Preview ground", (0.055, 0.05, 0.046, 1), 0.97))

world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.018, 0.015, 0.013, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.28

add_area_light("Key", (4.8, -6.5, 7.5), 1150, 4.0, (1.0, 0.82, 0.66))
add_area_light("Fill", (-4.5, -3.0, 5.2), 650, 3.5, (0.68, 0.8, 1.0))
add_area_light("Rim", (2.5, 4.8, 6.2), 950, 3.0, (1.0, 0.62, 0.38))

camera_data = bpy.data.cameras.new("Preview camera")
camera = bpy.data.objects.new("Preview camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (5.4, -9.6, 4.1)
camera.data.lens = 66
look_at(camera, (0, 0, 2.25))
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1280
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(RENDER_PATH)
scene.view_settings.look = "AgX - Medium High Contrast"

GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
RENDER_PATH.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)

# Orthographic validation renders in the same order as the supplied six-view board.
ground.hide_render = True
add_area_light("Underside validation fill", (0, 0, -6), 850, 4.0, (0.78, 0.84, 1.0))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 5.35
scene.render.resolution_x = 640
scene.render.resolution_y = 640
six_views = {
    "front": ((0, -9, 2.45), (0, 0, 2.45)),
    "back": ((0, 9, 2.45), (0, 0, 2.45)),
    "right": ((9, 0, 2.45), (0, 0, 2.45)),
    "left": ((-9, 0, 2.45), (0, 0, 2.45)),
    "top": ((0, 0, 10), (0, 0, 0)),
    "bottom": ((0, 0, -10), (0, 0, 0)),
}
for view_name, (camera_location, target) in six_views.items():
    camera.location = camera_location
    look_at(camera, target)
    scene.render.filepath = str(RENDER_PATH.parent / f"red-marshal-six-view-aligned-v3-{view_name}.png")
    bpy.ops.render.render(write_still=True)

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
print(f"RENDER={RENDER_PATH}")
print("MESH_OBJECTS=1")
print(f"TRIANGLES={len(body.data.loop_triangles)}")
print(f"MATERIALS={len(body.data.materials)}")
