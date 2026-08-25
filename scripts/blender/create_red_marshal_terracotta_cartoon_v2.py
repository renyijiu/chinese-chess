from __future__ import annotations

import hashlib
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
NAME = "red-marshal-terracotta-cartoon-v2"
GLB_PATH = ROOT / "assets" / "models" / f"{NAME}.glb"
BLEND_PATH = ROOT / "assets" / "models" / f"{NAME}.blend"
HERO_PATH = ROOT / "assets" / "renders" / f"{NAME}.png"
FRONT_PATH = ROOT / "assets" / "renders" / f"{NAME}-front.png"
HEAD_PATH = ROOT / "assets" / "renders" / f"{NAME}-head.png"
RENDER_DIR = ROOT / "assets" / "renders" / NAME


def canonical_triangle_signature(objects):
    triangles = []
    material_triangles = []
    for obj in objects:
        obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            vertices = []
            for vertex_index in triangle.vertices:
                world_vertex = obj.matrix_world @ obj.data.vertices[vertex_index].co
                vertices.append(
                    tuple(int(round(coordinate * 10_000)) for coordinate in world_vertex)
                )
            canonical_triangle = tuple(sorted(vertices))
            triangles.append(canonical_triangle)
            polygon = obj.data.polygons[triangle.polygon_index]
            material = obj.data.materials[polygon.material_index]
            material_name = material.name.removesuffix(" (GLB)").lower()
            material_triangles.append((canonical_triangle, material_name))
    triangles.sort()
    material_triangles.sort()
    digest = hashlib.sha256()
    for triangle in triangles:
        for vertex in triangle:
            for value in vertex:
                digest.update(struct.pack("<q", value))
    material_digest = hashlib.sha256()
    for triangle, material_name in material_triangles:
        for vertex in triangle:
            for value in vertex:
                material_digest.update(struct.pack("<q", value))
        encoded_name = material_name.encode("utf-8")
        material_digest.update(struct.pack("<I", len(encoded_name)))
        material_digest.update(encoded_name)
    return digest.hexdigest(), material_digest.hexdigest(), len(triangles)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


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


def vinyl_material(
    name: str,
    shadow: tuple[float, float, float, float],
    color: tuple[float, float, float, float],
    roughness: float = 0.46,
    metallic: float = 0.0,
    texture_strength: float = 0.055,
):
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
    noise.inputs["Roughness"].default_value = 0.48
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.26
    ramp.color_ramp.elements[0].color = shadow
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = color
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = texture_strength
    bump.inputs["Distance"].default_value = 0.012
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
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
    """Create a procedural-node-free material for predictable GLB viewers."""
    source_bsdf = source.node_tree.nodes.get("Principled BSDF")
    return simple_material(
        f"{source.name} (GLB)",
        tuple(source.diffuse_color),
        roughness=source_bsdf.inputs["Roughness"].default_value,
        metallic=source_bsdf.inputs["Metallic"].default_value,
    )


def rounded_box(name, location, scale, material, edge=0.018, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = register(bpy.context.object)
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if edge:
        bevel(obj, edge, 3)
    obj.data.materials.append(material)
    smooth(obj)
    obj.select_set(False)
    return obj


def sphere(name, location, scale, material, segments=32, rings=20, rotation=(0, 0, 0)):
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
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    smooth(obj)
    obj.select_set(False)
    return obj


def cylinder(
    name,
    location,
    radius,
    depth,
    material,
    vertices=40,
    rotation=(0, 0, 0),
    edge=0.012,
):
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
        major_segments=56,
        minor_segments=10,
        location=location,
        rotation=rotation,
    )
    obj = register(bpy.context.object)
    obj.name = name
    obj.data.materials.append(material)
    smooth(obj)
    return obj


def cylinder_between(name, start, end, radius, material, vertices=24, edge=0.008):
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
    return obj


def cone_between(name, start, end, radius_start, radius_end, material, vertices=30, edge=0.01):
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
    return obj


def tube_path(name, points, radius, material, segments=18):
    """Build a curved-looking stroke exclusively from joined-looking mesh primitives."""
    for index, (start, end) in enumerate(zip(points, points[1:], strict=False)):
        cylinder_between(f"{name} segment {index:02}", start, end, radius, material, segments, radius * 0.35)
    for index, point in enumerate(points):
        sphere(f"{name} joint {index:02}", point, (radius, radius, radius), material, segments, 10)


def loft(name, rings, material, segments=48, edge=0.012):
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
    obj.data.materials.append(material)
    smooth(obj)
    if edge:
        bevel(obj, edge, 2)
    return obj


def vertical_slab(name, outline_xz, y_center, half_thickness, material, edge=0.012):
    count = len(outline_xz)
    vertices = [(x, y_center - half_thickness, z) for x, z in outline_xz]
    vertices += [(x, y_center + half_thickness, z) for x, z in outline_xz]
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = register(bpy.data.objects.new(name, mesh))
    obj.data.materials.append(material)
    if edge:
        bevel(obj, edge, 3)
    smooth(obj)
    return obj


def armour_panel(name, location, scale, material, rotation=(0, 0, 0), studs=True):
    panel = rounded_box(name, location, scale, material, min(scale) * 0.34, rotation)
    if studs:
        x, y, z = location
        for side in (-1, 1):
            sphere(
                f"{name} round stud {side:+d}",
                (x + side * scale[0] * 0.52, y - scale[1] - 0.014, z + scale[2] * 0.4),
                (0.026, 0.018, 0.026),
                JADE,
                18,
                10,
            )
    return panel


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
    look_at(obj, (0, 0, 1.65))
    return obj


reset_scene()
MODEL = bpy.data.collections.new("Qin Terracotta Marshal Cartoon V2 - Editable Parts")
bpy.context.scene.collection.children.link(MODEL)

TERRACOTTA = vinyl_material(
    "Warm terracotta vinyl",
    (0.22, 0.065, 0.025, 1),
    (0.55, 0.205, 0.085, 1),
)
PORTRAIT = vinyl_material(
    "Soft portrait terracotta",
    (0.25, 0.08, 0.035, 1),
    (0.62, 0.285, 0.12, 1),
    0.42,
    texture_strength=0.025,
)
DEEP_BROWN = vinyl_material(
    "Deep brown hair and details",
    (0.018, 0.009, 0.006, 1),
    (0.105, 0.052, 0.031, 1),
    0.5,
)
LACQUER = vinyl_material(
    "Deep brown lacquer armour",
    (0.025, 0.012, 0.008, 1),
    (0.145, 0.067, 0.038, 1),
    0.47,
)
CINNABAR = vinyl_material(
    "Cinnabar red trim",
    (0.15, 0.018, 0.008, 1),
    (0.55, 0.07, 0.028, 1),
    0.43,
)
JADE = vinyl_material(
    "Polished jade green",
    (0.022, 0.085, 0.055, 1),
    (0.16, 0.43, 0.30, 1),
    0.28,
    metallic=0.12,
    texture_strength=0.018,
)
EYE_IVORY = vinyl_material(
    "Warm ivory eye white",
    (0.46, 0.34, 0.22, 1),
    (0.88, 0.76, 0.56, 1),
    0.24,
    texture_strength=0.0,
)
IRIS = vinyl_material(
    "Chestnut brown iris",
    (0.055, 0.018, 0.006, 1),
    (0.29, 0.105, 0.025, 1),
    0.22,
    texture_strength=0.0,
)
PLINTH = vinyl_material(
    "Thick fired-clay plinth",
    (0.18, 0.045, 0.018, 1),
    (0.44, 0.145, 0.055, 1),
    0.54,
)

# Thick, round chess base with a readable front seal.
cylinder("Thick lower chess base", (0, 0, 0.10), 1.08, 0.20, PLINTH, 72, edge=0.03)
cylinder("Dark recessed base band", (0, 0, 0.215), 1.045, 0.07, DEEP_BROWN, 72, edge=0.014)
cylinder("Rounded upper chess base", (0, 0, 0.325), 0.98, 0.18, TERRACOTTA, 72, edge=0.026)
torus("Soft upper base rim", (0, 0, 0.408), 0.935, 0.025, PORTRAIT)
torus("Soft lower base rim", (0, 0, 0.095), 1.035, 0.018, PORTRAIT)
for angle in range(0, 360, 30):
    radians = math.radians(angle)
    sphere(
        f"Base relief dot {angle:03}",
        (0.985 * math.sin(radians), -0.985 * math.cos(radians), 0.215),
        (0.032, 0.018, 0.032),
        PORTRAIT,
        16,
        10,
    )

# Small feet and a pear-shaped body keep the figure near 2.25 heads tall.
rounded_box("Left tiny boot", (-0.27, -0.08, 0.50), (0.25, 0.28, 0.12), DEEP_BROWN, 0.06)
rounded_box("Right tiny boot", (0.27, -0.08, 0.50), (0.25, 0.28, 0.12), DEEP_BROWN, 0.06)
rounded_box("Left terracotta toe", (-0.27, -0.32, 0.55), (0.23, 0.09, 0.065), TERRACOTTA, 0.035)
rounded_box("Right terracotta toe", (0.27, -0.32, 0.55), (0.23, 0.09, 0.065), TERRACOTTA, 0.035)
loft(
    "Pear shaped marshal torso",
    (
        (0.45, 0.60, 0.40, 0.03),
        (0.70, 0.70, 0.45, 0.02),
        (1.05, 0.72, 0.46, 0.01),
        (1.38, 0.68, 0.43, 0.0),
        (1.66, 0.55, 0.36, 0.0),
        (1.75, 0.44, 0.31, 0.0),
    ),
    TERRACOTTA,
    56,
    0.018,
)
loft(
    "Simple standing collar",
    ((1.60, 0.48, 0.34, 0.0), (1.73, 0.42, 0.30, 0.0), (1.83, 0.34, 0.26, 0.0)),
    DEEP_BROWN,
    44,
    0.012,
)
rounded_box("Broad waist sash", (0, -0.01, 1.05), (0.69, 0.43, 0.07), DEEP_BROWN, 0.018)
rounded_box("Cinnabar sash face", (0, -0.45, 1.05), (0.66, 0.025, 0.027), CINNABAR, 0.008)

# Short folded arms terminate in simple mitten hands clasping the sword.
arm_paths = {
    "left": ((-0.53, -0.02, 1.49), (-0.58, -0.32, 1.28), (-0.13, -0.59, 1.29)),
    "right": ((0.53, -0.02, 1.49), (0.58, -0.32, 1.28), (0.13, -0.59, 1.29)),
}
for side, (shoulder, elbow, wrist) in arm_paths.items():
    cone_between(f"{side.title()} short sleeve", shoulder, elbow, 0.19, 0.175, LACQUER, 32, 0.016)
    cone_between(f"{side.title()} short forearm", elbow, wrist, 0.175, 0.135, DEEP_BROWN, 32, 0.014)
    sphere(f"{side.title()} round elbow", elbow, (0.175, 0.16, 0.17), DEEP_BROWN, 28, 18)
    cuff_start = Vector(elbow).lerp(Vector(wrist), 0.72)
    cylinder_between(f"{side.title()} rounded cuff", cuff_start, wrist, 0.145, LACQUER, 28, 0.011)
    band_start = Vector(elbow).lerp(Vector(wrist), 0.78)
    band_end = Vector(elbow).lerp(Vector(wrist), 0.88)
    cylinder_between(f"{side.title()} cuff red band", band_start, band_end, 0.151, CINNABAR, 28, 0.006)
    sphere(
        f"{side.title()} mitten hand",
        wrist,
        (0.15, 0.115, 0.155),
        PORTRAIT,
        30,
        20,
    )

# Sparse, oversized rounded panels read clearly at collectible-toy scale.
loft(
    "Smooth lacquer cuirass shell",
    ((1.02, 0.68, 0.43, 0.0), (1.38, 0.68, 0.43, 0.0), (1.68, 0.56, 0.37, 0.0)),
    LACQUER,
    52,
    0.012,
)
for row, z in enumerate((1.22, 1.46)):
    for column, x in enumerate((-0.43, 0.0, 0.43)):
        armour_panel(
            f"Large front armour panel {row}-{column}",
            (x, -0.445 + 0.045 * abs(x), z),
            (0.185, 0.035, 0.125),
            LACQUER,
        )
for row, z in enumerate((1.22, 1.46)):
    for column, x in enumerate((-0.30, 0.30)):
        panel = rounded_box(
            f"Large back armour panel {row}-{column}",
            (x, 0.425, z),
            (0.27, 0.035, 0.125),
            LACQUER,
            0.025,
        )
        for sign in (-1, 1):
            sphere(
                f"{panel.name} stud {sign:+d}",
                (x + sign * 0.13, 0.468, z + 0.045),
                (0.026, 0.018, 0.026),
                JADE,
                18,
                10,
            )
for side_name, sign in (("left", -1), ("right", 1)):
    sphere(f"{side_name.title()} shoulder underpad", (sign * 0.56, -0.01, 1.54), (0.18, 0.17, 0.15), TERRACOTTA, 28, 18)
    for level, z in enumerate((1.60, 1.44)):
        armour_panel(
            f"{side_name.title()} large shoulder panel {level}",
            (sign * (0.62 + level * 0.025), -0.205, z),
            (0.19, 0.035, 0.105),
            LACQUER,
            rotation=(0, -sign * math.radians(12), sign * math.radians(5)),
        )
for row, z in enumerate((0.72, 0.91)):
    for column, x in enumerate((-0.45, 0.0, 0.45)):
        armour_panel(
            f"Large rounded skirt panel {row}-{column}",
            (x, -0.435 + 0.035 * abs(x), z),
            (0.19, 0.035, 0.145),
            LACQUER,
        )

# Short command sword, centered between both mitten hands.
cylinder_between("Short sword scabbard", (0, -0.65, 0.50), (0, -0.65, 1.26), 0.072, DEEP_BROWN, 32, 0.012)
cylinder_between("Jade sword grip", (0, -0.66, 1.23), (0, -0.66, 1.57), 0.052, JADE, 28, 0.009)
rounded_box("Simple sword guard", (0, -0.66, 1.25), (0.22, 0.052, 0.035), CINNABAR, 0.014)
sphere("Round jade sword pommel", (0, -0.66, 1.61), (0.075, 0.065, 0.075), JADE, 24, 14)
for z in (1.34, 1.44):
    torus(f"Sword grip red binding {z:.2f}", (0, -0.66, z), 0.055, 0.007, CINNABAR)

# Huge primitive-built head and soft cheeks: no imported human mesh is used.
sphere("Huge round portrait head", (0, -0.06, 2.35), (0.72, 0.62, 0.68), PORTRAIT, 52, 34)
sphere("Rounded dark hair halo", (0, 0.15, 2.48), (0.70, 0.55, 0.62), DEEP_BROWN, 48, 30)
sphere("Left round ear", (-0.70, -0.07, 2.34), (0.15, 0.095, 0.18), PORTRAIT, 28, 18)
sphere("Right round ear", (0.70, -0.07, 2.34), (0.15, 0.095, 0.18), PORTRAIT, 28, 18)
sphere("Left soft cheek", (-0.42, -0.682, 2.23), (0.115, 0.014, 0.068), TERRACOTTA, 26, 16)
sphere("Right soft cheek", (0.42, -0.682, 2.23), (0.115, 0.014, 0.068), TERRACOTTA, 26, 16)
sphere(
    "Soft rounded front hair cap",
    (0, -0.575, 2.79),
    (0.45, 0.035, 0.105),
    DEEP_BROWN,
    36,
    20,
)
sphere(
    "Small center hair point",
    (0, -0.606, 2.71),
    (0.13, 0.022, 0.09),
    DEEP_BROWN,
    28,
    16,
)
sphere("Rear round hair knot", (0, 0.63, 2.62), (0.19, 0.14, 0.18), DEEP_BROWN, 30, 18)
rounded_box("Rear knot ribbon", (0, 0.66, 2.43), (0.075, 0.035, 0.18), DEEP_BROWN, 0.025)

# Large bright eyes include separate brown irises, dark pupils, and two catchlights each.
for side_name, sign in (("left", -1), ("right", 1)):
    x = sign * 0.255
    sphere(f"{side_name.title()} large eye white", (x, -0.625, 2.48), (0.18, 0.06, 0.16), EYE_IVORY, 34, 22)
    sphere(f"{side_name.title()} brown iris", (x, -0.682, 2.47), (0.095, 0.027, 0.105), IRIS, 28, 18)
    sphere(f"{side_name.title()} dark pupil", (x, -0.708, 2.47), (0.049, 0.018, 0.062), DEEP_BROWN, 24, 14)
    sphere(f"{side_name.title()} large catchlight", (x - sign * 0.028, -0.727, 2.515), (0.021, 0.009, 0.024), EYE_IVORY, 18, 10)
    sphere(f"{side_name.title()} tiny catchlight", (x + sign * 0.025, -0.725, 2.445), (0.011, 0.007, 0.013), EYE_IVORY, 16, 8)

sphere("Tiny rounded nose", (0, -0.705, 2.29), (0.072, 0.052, 0.06), PORTRAIT, 24, 14)
sphere("Left soft curved brow", (-0.285, -0.655, 2.67), (0.145, 0.022, 0.032), DEEP_BROWN, 24, 14, rotation=(0, 0, -0.10))
sphere("Right soft curved brow", (0.285, -0.655, 2.67), (0.145, 0.022, 0.032), DEEP_BROWN, 24, 14, rotation=(0, 0, 0.10))
sphere("Left tiny moustache", (-0.085, -0.703, 2.22), (0.082, 0.016, 0.022), DEEP_BROWN, 22, 12, rotation=(0, 0, -0.18))
sphere("Right tiny moustache", (0.085, -0.703, 2.22), (0.082, 0.016, 0.022), DEEP_BROWN, 22, 12, rotation=(0, 0, 0.18))
sphere("Small friendly mouth", (0, -0.695, 2.15), (0.065, 0.012, 0.010), DEEP_BROWN, 20, 10)
sphere("Small rounded goatee", (0, -0.665, 2.075), (0.050, 0.018, 0.060), DEEP_BROWN, 22, 14)

# Simplified Qin double-tail crown with broad rounded shapes and sparse trim.
cylinder("Low round Qin crown band", (0, 0.01, 2.93), 0.50, 0.12, LACQUER, 56, edge=0.018)
cylinder("Cinnabar crown band trim", (0, 0.01, 2.965), 0.515, 0.045, CINNABAR, 56, edge=0.012)
left_tail = [(-0.40, 2.96), (-0.06, 2.96), (-0.08, 3.22), (-0.17, 3.45), (-0.38, 3.42), (-0.48, 3.26)]
right_tail = [(0.06, 2.96), (0.40, 2.96), (0.48, 3.26), (0.38, 3.42), (0.17, 3.45), (0.08, 3.22)]
vertical_slab("Left broad Qin crown tail", left_tail, 0.02, 0.06, LACQUER, 0.025)
vertical_slab("Right broad Qin crown tail", right_tail, 0.02, 0.06, LACQUER, 0.025)
left_trim = [(-0.36, 3.00), (-0.11, 3.00), (-0.13, 3.21), (-0.20, 3.38), (-0.34, 3.36), (-0.41, 3.24)]
right_trim = [(0.11, 3.00), (0.36, 3.00), (0.41, 3.24), (0.34, 3.36), (0.20, 3.38), (0.13, 3.21)]
vertical_slab("Left cinnabar crown inset", left_trim, -0.045, 0.012, CINNABAR, 0.012)
vertical_slab("Right cinnabar crown inset", right_trim, -0.045, 0.012, CINNABAR, 0.012)
sphere("Round jade crown seal", (0, -0.505, 2.96), (0.10, 0.04, 0.10), JADE, 28, 16)
torus("Crown seal cinnabar rim", (0, -0.525, 2.96), 0.105, 0.014, CINNABAR, rotation=(math.pi / 2, 0, 0))

# Explicit mesh strokes spell the correct simplified character 帅; no font object is used.
cylinder("Front 帅 faction medallion", (0, -1.055, 0.225), 0.19, 0.055, CINNABAR, 48, rotation=(math.pi / 2, 0, 0), edge=0.014)
glyph_y = -1.095
glyph_strokes = {
    "left short vertical": ((-0.115, glyph_y, 0.32), (-0.115, glyph_y, 0.245)),
    "left falling sweep": ((-0.115, glyph_y, 0.24), (-0.17, glyph_y, 0.15)),
    "left long vertical": ((-0.035, glyph_y, 0.335), (-0.035, glyph_y, 0.135)),
    "right frame top": ((0.005, glyph_y, 0.30), (0.145, glyph_y, 0.30)),
    "right frame left": ((0.012, glyph_y, 0.30), (0.012, glyph_y, 0.17)),
    "right frame right": ((0.138, glyph_y, 0.30), (0.138, glyph_y, 0.17)),
    "right center vertical": ((0.075, glyph_y, 0.34), (0.075, glyph_y, 0.12)),
}
for stroke_name, points in glyph_strokes.items():
    tube_path(f"帅 glyph {stroke_name}", points, 0.011, EYE_IVORY, 14)

# Duplicate the editable mesh parts and join only those duplicates for rendering/export.
EXPORT = bpy.data.collections.new("Cartoon V2 - Joined Render and GLB Mesh")
bpy.context.scene.collection.children.link(EXPORT)
editable_meshes = [obj for obj in MODEL.objects if obj.type == "MESH"]
export_parts = []
for source in editable_meshes:
    duplicate = source.copy()
    EXPORT.objects.link(duplicate)
    export_parts.append(duplicate)

# Joining mutates only the active object's mesh. Keep the other duplicates linked
# to their editable sources so export does not deep-copy the full model.
export_parts[0].data = export_parts[0].data.copy()

bpy.ops.object.select_all(action="DESELECT")
for obj in export_parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = export_parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = "Red Marshal Qin Terracotta Cartoon V2 - Joined Mesh"
MODEL.hide_render = True

editable_signature, editable_material_signature, editable_triangle_count = (
    canonical_triangle_signature(editable_meshes)
)
joined_signature, joined_material_signature, joined_triangle_count = (
    canonical_triangle_signature([body])
)
if editable_triangle_count != joined_triangle_count:
    raise RuntimeError(
        "Joined source triangle count does not match editable parts: "
        f"editable={editable_triangle_count}, joined={joined_triangle_count}"
    )
body["source_editable_signature_sha256"] = editable_signature
body["source_joined_signature_sha256"] = joined_signature
body["source_editable_material_signature_sha256"] = editable_material_signature
body["source_joined_material_signature_sha256"] = joined_material_signature
body["source_triangle_count"] = joined_triangle_count
body["source_primitive_only"] = True
body["source_character_proportion"] = "2.25-head"

# Premium toy photography: soft warm key, neutral fill, and a dark umber sweep.
studio_ground = simple_material("Matte umber studio floor", (0.018, 0.014, 0.012, 1), 0.96)
studio_back = vinyl_material(
    "Soft charcoal studio backdrop",
    (0.004, 0.004, 0.004, 1),
    (0.028, 0.023, 0.021, 1),
    0.96,
    texture_strength=0.02,
)
bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.015))
ground = bpy.context.object
ground.name = "Studio ground"
ground.data.materials.append(studio_ground)
bpy.ops.mesh.primitive_plane_add(size=15, location=(0, 3.0, 3.1), rotation=(math.pi / 2, 0, 0))
backdrop = bpy.context.object
backdrop.name = "Studio backdrop"
backdrop.data.materials.append(studio_back)

world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.006, 0.005, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.13
area_light("Large warm key", (-4.3, -5.4, 6.2), 1050, 4.3, (1.0, 0.80, 0.64))
area_light("Soft front fill", (3.1, -4.8, 3.6), 340, 3.8, (0.72, 0.79, 0.92))
area_light("Cinnabar rear rim", (3.7, 2.7, 5.1), 900, 3.0, (1.0, 0.48, 0.25))
area_light("Low face bounce", (-1.4, -2.4, 1.0), 180, 2.2, (0.72, 0.48, 0.34))

camera_data = bpy.data.cameras.new("Cartoon V2 studio camera")
camera = bpy.data.objects.new("Cartoon V2 studio camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (4.3, -8.8, 3.25)
camera.data.lens = 76
look_at(camera, (0, 0, 1.68))
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1200
scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False
scene.view_settings.look = "AgX - Medium High Contrast"
HERO_PATH.parent.mkdir(parents=True, exist_ok=True)
RENDER_DIR.mkdir(parents=True, exist_ok=True)
GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(HERO_PATH)
bpy.ops.render.render(write_still=True)

camera.location = (0, -8.5, 1.72)
look_at(camera, (0, 0, 1.72))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 3.72
scene.render.filepath = str(FRONT_PATH)
bpy.ops.render.render(write_still=True)

camera.location = (0, -7, 2.52)
look_at(camera, (0, 0, 2.52))
camera.data.ortho_scale = 1.95
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.filepath = str(HEAD_PATH)
bpy.ops.render.render(write_still=True)

# Six orthographic proofs come from the exact joined render/export mesh.
ground.hide_render = True
backdrop.hide_render = True
area_light("Underside proof fill", (0, 0, -4.5), 680, 4.0, (0.58, 0.69, 1.0))
area_light("Rear proof fill", (0, 6.5, 3.5), 680, 4.0, (0.75, 0.79, 0.86))
area_light("Left proof fill", (-6.0, 0, 3.0), 360, 3.5, (0.75, 0.79, 0.88))
area_light("Right proof fill", (6.0, 0, 3.0), 360, 3.5, (0.75, 0.79, 0.88))
camera.data.ortho_scale = 3.78
scene.render.resolution_x = 760
scene.render.resolution_y = 760
views = {
    "front": ((0, -8, 1.72), (0, 0, 1.72)),
    "back": ((0, 8, 1.72), (0, 0, 1.72)),
    "right": ((8, 0, 1.72), (0, 0, 1.72)),
    "left": ((-8, 0, 1.72), (0, 0, 1.72)),
    "top": ((0, 0, 8), (0, 0, 0)),
    "bottom": ((0, 0, -8), (0, 0, 0)),
}
for view_name, (location, target) in views.items():
    camera.location = location
    look_at(camera, target)
    scene.render.filepath = str(RENDER_DIR / f"{view_name}.png")
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

if len(body.data.materials) != 9:
    raise RuntimeError(f"Expected nine consolidated materials, got {len(body.data.materials)}")
for material_index, source_material in enumerate(tuple(body.data.materials)):
    body.data.materials[material_index] = gltf_material(source_material)

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
    export_extras=True,
)
print(f"EXPORT_GLTF={GLB_PATH}")
print(f"EDITABLE_BLEND={BLEND_PATH}")
print(f"HERO_RENDER={HERO_PATH}")
print(f"FRONT_RENDER={FRONT_PATH}")
print(f"HEAD_RENDER={HEAD_PATH}")
print(f"SIX_VIEW_DIR={RENDER_DIR}")
print(f"EDITABLE_PARTS={len(editable_meshes)}")
print("MESH_OBJECTS=1")
print(f"TRIANGLES={joined_triangle_count}")
print(f"MATERIALS={len(body.data.materials)}")
