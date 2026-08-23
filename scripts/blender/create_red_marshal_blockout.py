from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "assets" / "models"
RENDER_DIR = ROOT / "assets" / "renders"
GLB_PATH = OUTPUT_DIR / "red-marshal-sculpt-blockout-v1.glb"
RENDER_PATH = RENDER_DIR / "red-marshal-sculpt-blockout-v1.png"


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        pass


def material(name: str, color: tuple[float, float, float, float], roughness: float = 0.72, metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def smooth(obj) -> None:
    if obj.type != "MESH":
        return
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def register(obj):
    if obj.name not in MODEL_COLLECTION.objects:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        MODEL_COLLECTION.objects.link(obj)
    return obj


def apply_bevel(obj, width: float, segments: int = 2) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("Sculpt bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def rounded_box(name, location, scale, mat, bevel=0.035, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_bevel(obj, bevel, 2)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def uv_sphere(name, location, scale, mat, segments=24, rings=16):
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


def cylinder(name, location, radius, depth, mat, vertices=32, rotation=(0.0, 0.0, 0.0), bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        apply_bevel(obj, bevel, 2)
    smooth(obj)
    return obj


def cone(name, location, radius1, radius2, depth, mat, vertices=24, rotation=(0.0, 0.0, 0.0), bevel=0.015):
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


def torus(name, location, major_radius, minor_radius, mat, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=48,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def capsule_between(name, start, end, radius, mat, segments=20):
    start_vec = Vector(start)
    end_vec = Vector(end)
    direction = end_vec - start_vec
    midpoint = (start_vec + end_vec) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=direction.length, location=midpoint)
    obj = register(bpy.context.object)
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    apply_bevel(obj, radius * 0.18, 3)
    smooth(obj)
    return obj


def loft(name, rings, mat, segments=24):
    vertices = []
    faces = []
    for z, radius_x, radius_y in rings:
        for index in range(segments):
            angle = 2 * math.pi * index / segments
            vertices.append((radius_x * math.cos(angle), radius_y * math.sin(angle), z))
    for ring in range(len(rings) - 1):
        for index in range(segments):
            next_index = (index + 1) % segments
            a = ring * segments + index
            b = ring * segments + next_index
            c = (ring + 1) * segments + next_index
            d = (ring + 1) * segments + index
            faces.append((a, b, c, d))
    faces.append(tuple(reversed(range(segments))))
    top_start = (len(rings) - 1) * segments
    faces.append(tuple(top_start + index for index in range(segments)))
    mesh_data = bpy.data.meshes.new(f"{name}Mesh")
    mesh_data.from_pydata(vertices, [], faces)
    mesh_data.update()
    obj = register(bpy.data.objects.new(name, mesh_data))
    obj.data.materials.append(mat)
    smooth(obj)
    bevel = obj.modifiers.new("Soft cloth edges", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


def curve_object(name, points, radius, mat, resolution=3):
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 10
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


def cape_mesh(name, mat):
    rows = 12
    columns = 16
    vertices = []
    faces = []
    for row in range(rows):
        t = row / (rows - 1)
        z = 0.88 + t * 1.98
        half_width = 0.7 * (1 - t) + 0.48 * t
        for column in range(columns):
            u = column / (columns - 1)
            x = -half_width + 2 * half_width * u
            y = 0.29 + 0.035 * math.cos(u * math.pi * 5) * (1 - 0.3 * t)
            vertices.append((x, y, z))
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = a + columns + 1
            d = a + columns
            faces.append((a, b, c, d))
    mesh_data = bpy.data.meshes.new(f"{name}Mesh")
    mesh_data.from_pydata(vertices, [], faces)
    mesh_data.update()
    obj = register(bpy.data.objects.new(name, mesh_data))
    obj.data.materials.append(mat)
    solidify = obj.modifiers.new("Cape thickness", "SOLIDIFY")
    solidify.thickness = 0.045
    bevel = obj.modifiers.new("Cape soft edge", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    subdivision = obj.modifiers.new("Cape sculpt surface", "SUBSURF")
    subdivision.levels = 1
    subdivision.render_levels = 1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in (solidify, bevel, subdivision):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    smooth(obj)
    return obj


def diamond_stud(name, location, mat, scale=0.055):
    return rounded_box(name, location, (scale, 0.025, scale), mat, bevel=0.012, rotation=(math.radians(45), 0, math.radians(45)))


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


reset_scene()
MODEL_COLLECTION = bpy.data.collections.new("Red Marshal Sculpt Blockout")
bpy.context.scene.collection.children.link(MODEL_COLLECTION)

clay = material("Warm sculpt clay", (0.43, 0.40, 0.36, 1.0), 0.82)
clay_light = material("Raised sculpt detail", (0.56, 0.52, 0.46, 1.0), 0.76)
clay_dark = material("Recessed sculpt detail", (0.16, 0.14, 0.12, 1.0), 0.88)
stone = material("Stone blockout", (0.31, 0.29, 0.27, 1.0), 0.94)
metal_clay = material("Metal blockout", (0.36, 0.33, 0.29, 1.0), 0.54, 0.28)

# Unified chess base.
cylinder("Base lower", (0, 0, 0.13), 1.25, 0.26, stone, 64, bevel=0.045)
cylinder("Base middle", (0, 0, 0.34), 1.19, 0.18, metal_clay, 64, bevel=0.035)
cylinder("Base upper", (0, 0, 0.51), 1.1, 0.2, stone, 64, bevel=0.035)
torus("Base upper ring", (0, 0, 0.61), 1.05, 0.032, clay_light)
torus("Base lower ring", (0, 0, 0.25), 1.19, 0.025, clay_light)
for index in range(8):
    angle = index * math.pi / 4
    diamond_stud(
        f"Base stud {index}",
        (1.205 * math.sin(angle), -1.205 * math.cos(angle), 0.36),
        clay_light,
        0.05,
    ).rotation_euler[2] = -angle

# Realistic adult proportions and layered garments.
rounded_box("Boot left", (-0.24, -0.03, 0.74), (0.16, 0.28, 0.13), clay_dark, 0.045)
rounded_box("Boot right", (0.24, -0.03, 0.74), (0.16, 0.28, 0.13), clay_dark, 0.045)
loft(
    "Long tailored robe",
    [
        (0.79, 0.66, 0.34),
        (1.05, 0.64, 0.33),
        (1.5, 0.56, 0.29),
        (1.93, 0.46, 0.25),
        (2.18, 0.38, 0.24),
    ],
    clay,
    32,
)
cape_mesh("Heavy embroidered cape", clay)
loft(
    "Armored torso",
    [
        (2.1, 0.39, 0.25),
        (2.45, 0.51, 0.29),
        (2.72, 0.42, 0.25),
        (2.86, 0.31, 0.2),
    ],
    metal_clay,
    28,
)
rounded_box("Structured belt", (0, -0.01, 2.12), (0.46, 0.29, 0.075), clay_light, 0.035)
cylinder("Belt clasp", (0, -0.33, 2.12), 0.13, 0.07, clay_dark, 24, rotation=(math.pi / 2, 0, 0), bevel=0.02)

# Armor apron: overlapping plates rather than a flat texture.
for row in range(7):
    for column in range(5):
        x = -0.28 + column * 0.14
        z = 1.12 + row * 0.13
        y = -0.35 - row * 0.002
        rounded_box(
            f"Apron lamella {row}-{column}",
            (x, y, z),
            (0.06, 0.022, 0.052),
            clay_light if (column in (0, 4) or row == 0) else metal_clay,
            0.012,
        )

# Breastplate rows.
for row in range(4):
    for column in range(5):
        x = -0.28 + column * 0.14
        z = 2.28 + row * 0.12
        rounded_box(
            f"Chest lamella {row}-{column}",
            (x, -0.3, z),
            (0.06, 0.022, 0.047),
            clay_light if (row == 0 or column in (0, 4)) else metal_clay,
            0.011,
        )

# Cloth folds and collar piping.
for index, x in enumerate((-0.49, -0.37, 0.37, 0.49)):
    curve_object(
        f"Robe fold {index}",
        [(x, -0.31, 0.9), (x * 0.9, -0.3, 1.45), (x * 0.78, -0.27, 2.02)],
        0.018,
        clay_light,
    )
curve_object("Collar left", [(-0.29, -0.25, 2.76), (-0.17, -0.3, 2.58), (0, -0.34, 2.42)], 0.027, clay_light)
curve_object("Collar right", [(0.29, -0.25, 2.76), (0.17, -0.3, 2.58), (0, -0.34, 2.42)], 0.027, clay_light)

# Folded arms and wide ceremonial sleeves.
shoulder_left = uv_sphere("Shoulder guard left", (-0.52, 0, 2.62), (0.3, 0.24, 0.11), clay_light, 24, 12)
shoulder_right = uv_sphere("Shoulder guard right", (0.52, 0, 2.62), (0.3, 0.24, 0.11), clay_light, 24, 12)
capsule_between("Upper sleeve left", (-0.52, -0.02, 2.56), (-0.57, -0.13, 2.25), 0.145, clay, 24)
capsule_between("Upper sleeve right", (0.52, -0.02, 2.56), (0.57, -0.13, 2.25), 0.145, clay, 24)
capsule_between("Forearm sleeve left", (-0.57, -0.13, 2.25), (-0.19, -0.32, 2.08), 0.155, clay, 24)
capsule_between("Forearm sleeve right", (0.57, -0.13, 2.25), (0.19, -0.32, 2.08), 0.155, clay, 24)
torus("Cuff left", (-0.27, -0.29, 2.1), 0.16, 0.025, clay_light, rotation=(math.pi / 2, 0.25, 0.9))
torus("Cuff right", (0.27, -0.29, 2.1), 0.16, 0.025, clay_light, rotation=(math.pi / 2, -0.25, -0.9))
uv_sphere("Hand left", (-0.1, -0.37, 2.06), (0.1, 0.075, 0.115), clay_light, 20, 12)
uv_sphere("Hand right", (0.1, -0.37, 2.06), (0.1, 0.075, 0.115), clay_light, 20, 12)

# Anatomically restrained head and facial planes.
cylinder("Neck", (0, 0, 2.92), 0.14, 0.25, clay, 24, bevel=0.025)
uv_sphere("Head", (0, -0.015, 3.19), (0.225, 0.2, 0.275), clay, 32, 20)
uv_sphere("Left ear", (-0.225, -0.005, 3.18), (0.045, 0.032, 0.068), clay, 16, 10)
uv_sphere("Right ear", (0.225, -0.005, 3.18), (0.045, 0.032, 0.068), clay, 16, 10)
cone("Nose", (0, -0.218, 3.18), 0.047, 0.014, 0.14, clay, 20, rotation=(math.pi / 2, 0, 0), bevel=0.01)
uv_sphere("Eye left", (-0.078, -0.205, 3.24), (0.034, 0.018, 0.019), clay_dark, 16, 8)
uv_sphere("Eye right", (0.078, -0.205, 3.24), (0.034, 0.018, 0.019), clay_dark, 16, 8)
curve_object("Brow left", [(-0.135, -0.21, 3.3), (-0.08, -0.222, 3.315), (-0.025, -0.21, 3.3)], 0.014, clay_dark)
curve_object("Brow right", [(0.135, -0.21, 3.3), (0.08, -0.222, 3.315), (0.025, -0.21, 3.3)], 0.014, clay_dark)
curve_object("Moustache left", [(-0.005, -0.225, 3.11), (-0.075, -0.24, 3.085), (-0.15, -0.21, 3.09)], 0.019, clay_dark)
curve_object("Moustache right", [(0.005, -0.225, 3.11), (0.075, -0.24, 3.085), (0.15, -0.21, 3.09)], 0.019, clay_dark)
for index, x in enumerate((-0.1, -0.065, -0.03, 0, 0.03, 0.065, 0.1)):
    curve_object(
        f"Beard strand {index}",
        [(x, -0.2, 3.08), (x * 0.82, -0.24, 2.94), (x * 0.52, -0.2, 2.75 - 0.03 * math.cos(index))],
        0.024 if index in (2, 3, 4) else 0.019,
        clay_dark,
        2,
    )

# Ceremonial crown with readable hard-surface construction.
cylinder("Crown body", (0, 0, 3.47), 0.255, 0.27, metal_clay, 24, bevel=0.022)
cylinder("Crown band", (0, 0, 3.36), 0.285, 0.08, clay_light, 28, bevel=0.018)
rounded_box("Crown front relief", (0, -0.258, 3.47), (0.17, 0.026, 0.1), clay_light, 0.018)
for index, x in enumerate((-0.2, -0.1, 0, 0.1, 0.2)):
    height = 0.36 if index == 2 else 0.3
    rounded_box(
        f"Crown post {index}",
        (x, -0.01, 3.68 + (0.03 if index == 2 else 0)),
        (0.026, 0.026, height / 2),
        clay_light,
        0.012,
    )
    uv_sphere(f"Crown finial {index}", (x, -0.01, 3.84 + (0.06 if index == 2 else 0)), (0.04, 0.04, 0.05), clay_light, 16, 10)

# Sheathed straight sword at the right hip.
capsule_between("Sword sheath", (0.67, 0.02, 2.04), (0.81, 0.07, 0.77), 0.048, clay_dark, 16)
capsule_between("Sword grip", (0.65, 0.01, 2.02), (0.62, -0.01, 2.3), 0.038, clay_light, 16)
rounded_box("Sword guard", (0.645, 0, 2.04), (0.17, 0.055, 0.035), clay_light, 0.018, rotation=(0, 0.1, 0.02))

# Convert sculpt curves to mesh so the GLB is self-contained.
for obj in list(MODEL_COLLECTION.objects):
    if obj.type != "CURVE":
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    smooth(obj)
    obj.select_set(False)

# Ground and studio lights for an honest Blender preview render.
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.015))
ground = bpy.context.object
ground.name = "Preview ground"
ground.data.materials.append(material("Preview ground material", (0.11, 0.105, 0.1, 1.0), 0.96))

world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.05, 0.046, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32

def area_light(name, location, energy, size, color):
    light_data = bpy.data.lights.new(name=name, type="AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light_data.color = color
    obj = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, (0, 0, 2.0))
    return obj


area_light("Key", (4.5, -5.5, 7.0), 1050, 4.0, (1.0, 0.83, 0.67))
area_light("Fill", (-4.0, -2.5, 4.5), 650, 3.5, (0.68, 0.79, 1.0))
area_light("Rim", (2.0, 4.5, 5.5), 900, 3.0, (1.0, 0.65, 0.42))

camera_data = bpy.data.cameras.new("Preview camera")
camera = bpy.data.objects.new("Preview camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (5.0, -8.6, 4.25)
camera.data.lens = 58
look_at(camera, (0, 0, 2.0))
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(RENDER_PATH)
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RENDER_DIR.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)

# Export only the model collection; preview plane, lights and camera stay out of the GLB.
bpy.ops.object.select_all(action="DESELECT")
for obj in MODEL_COLLECTION.objects:
    if obj.type == "MESH":
        obj.select_set(True)
bpy.context.view_layer.objects.active = next(obj for obj in MODEL_COLLECTION.objects if obj.type == "MESH")
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
)

for obj in MODEL_COLLECTION.objects:
    if obj.type == "MESH":
        obj.data.calc_loop_triangles()
triangles = sum(len(obj.data.loop_triangles) for obj in MODEL_COLLECTION.objects if obj.type == "MESH")
print(f"EXPORT_GLTF={GLB_PATH}")
print(f"RENDER={RENDER_PATH}")
print(f"OBJECTS={sum(1 for obj in MODEL_COLLECTION.objects if obj.type == 'MESH')}")
print(f"TRIANGLES={triangles}")
