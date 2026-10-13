"""Blender-side helpers that turn sculpted distance fields into painted meshes."""

from __future__ import annotations

import math
import os

import bpy
import numpy as np
from mathutils import Vector

import terracotta_sdf as sdf


# Rig parts travel to the runtime adapter in TEXCOORD_0.u, one constant per island.
PARTS = sdf.PARTS
PART_SLOTS = 16


def set_part(obj, part: str):
    """Tag a whole island with the rig part that should carry it."""
    obj["part"] = part
    mesh = obj.data
    for stale in [layer for layer in mesh.uv_layers if layer.name != "rig_hint"]:
        mesh.uv_layers.remove(stale)
    layer = mesh.uv_layers.get("rig_hint") or mesh.uv_layers.new(name="rig_hint")
    uv = np.tile(np.array([(sdf.PART[part] + 0.5) / PART_SLOTS, 0.5], dtype=np.float32), len(mesh.loops))
    layer.data.foreach_set("uv", uv)
    return obj


# The nine research materials of the Q roster keep their names and colours: the
# runtime adapter recognises the four faction masks by name. Ink is new and
# stays dark for both sides (pupils, lash lines, mouth).
TERRACOTTA, PORTRAIT, DEEP_BROWN, LACQUER, CINNABAR, JADE, EYE_IVORY, IRIS, PLINTH, INK = range(1, 11)

PALETTE = {
    TERRACOTTA: ("Warm terracotta vinyl", (0.55, 0.205, 0.085), 0.46, 0.0),
    PORTRAIT: ("Soft portrait terracotta", (0.62, 0.285, 0.12), 0.42, 0.0),
    DEEP_BROWN: ("Deep brown hair and details", (0.105, 0.052, 0.031), 0.50, 0.0),
    LACQUER: ("Deep brown lacquer armour", (0.145, 0.067, 0.038), 0.47, 0.0),
    CINNABAR: ("Cinnabar red trim", (0.55, 0.07, 0.028), 0.43, 0.0),
    JADE: ("Polished jade green", (0.16, 0.43, 0.30), 0.28, 0.12),
    EYE_IVORY: ("Warm ivory eye white", (0.88, 0.76, 0.56), 0.24, 0.0),
    IRIS: ("Chestnut brown iris", (0.29, 0.105, 0.025), 0.22, 0.0),
    PLINTH: ("Thick fired-clay plinth", (0.44, 0.145, 0.055), 0.54, 0.0),
    INK: ("Ink black pupil and lash", (0.014, 0.009, 0.007), 0.30, 0.0),
}
MATERIAL_BY_NAME = {name: material_id for material_id, (name, _color, _rough, _metal) in PALETTE.items()}


# --------------------------------------------------------------------------
# Mesh construction
# --------------------------------------------------------------------------


def mesh_from_polys(name: str, points, polys):
    """Create a mesh object from float points and an (N, 3|4) index array."""
    points = np.asarray(points, dtype=np.float32)
    polys = np.asarray(polys, dtype=np.int32)
    count, corners = polys.shape
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(points))
    mesh.vertices.foreach_set("co", points.ravel())
    mesh.loops.add(count * corners)
    mesh.loops.foreach_set("vertex_index", polys.ravel())
    mesh.polygons.add(count)
    mesh.polygons.foreach_set("loop_start", np.arange(0, count * corners, corners, dtype=np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(count, corners, dtype=np.int32))
    mesh.polygons.foreach_set("use_smooth", np.ones(count, dtype=bool))
    mesh.update()
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def vertex_array(obj) -> np.ndarray:
    out = np.zeros(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", out)
    return out.reshape(-1, 3)


def normal_array(obj) -> np.ndarray:
    out = np.zeros(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertex_normals.foreach_get("vector", out)
    return out.reshape(-1, 3)


def triangle_count(obj) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def activate(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj, modifier) -> None:
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def decimate(obj, target_triangles: int) -> int:
    current = triangle_count(obj)
    if current <= target_triangles:
        return current
    modifier = obj.modifiers.new("terracotta decimation", "DECIMATE")
    modifier.ratio = max(0.002, target_triangles / current)
    modifier.use_collapse_triangulate = True
    apply_modifier(obj, modifier)
    return triangle_count(obj)


def remove_slivers(obj, area: float = 2e-8) -> int:
    """Triangulate, then drop zero-area and coincident faces.

    The glTF exporter discards both silently, which would leave the GLB with
    fewer triangles than the BLEND master records.
    """
    import bmesh

    mesh = obj.data
    work = bmesh.new()
    work.from_mesh(mesh)
    bmesh.ops.triangulate(work, faces=work.faces[:], quad_method="FIXED", ngon_method="BEAUTY")
    slivers = [face for face in work.faces if face.calc_area() < area]
    seen = set()
    for face in work.faces:
        key = (face.material_index, *sorted(tuple(round(value, 6) for value in vertex.co) for vertex in face.verts))
        if key in seen:
            slivers.append(face)
        seen.add(key)
    bmesh.ops.delete(work, geom=list(set(slivers)), context="FACES")
    loose = [vertex for vertex in work.verts if not vertex.link_faces]
    bmesh.ops.delete(work, geom=loose, context="VERTS")
    work.to_mesh(mesh)
    work.free()
    mesh.update()
    return len(slivers)


def material(material_id: int):
    name, color, roughness, metallic = PALETTE[material_id]
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    # glTF reads "Color Attribute x factor" as COLOR_0 times baseColorFactor, so
    # the baked shading shows in any viewer without changing the flat palette.
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "shade"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["A"].default_value = (*color, 1.0)
    links.new(attribute.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def set_material(obj, material_id: int):
    obj.data.materials.clear()
    obj.data.materials.append(material(material_id))
    obj["material_id"] = material_id
    return obj


def mesh_layers(masses, *, bury: float, prefix: str = "sculpt"):
    """Mesh every painted mass separately and drop faces buried inside its neighbours.

    ``masses`` is a list of ``(name, layer, material_id)``. Separate islands keep
    colour borders crisp at every LOD: the border is where two surfaces cross.
    """
    objects = []
    for name, layer, material_id in masses:
        points, quads = sdf.extract_layer(layer)
        if len(quads) == 0:
            continue
        others = np.full(len(points), sdf.FAR, dtype=np.float32)
        for other_name, other, _other_material in masses:
            if other is layer:
                continue
            others = np.minimum(others, sdf.sample_layer(other, points))
        visible = others > -bury
        keep = visible[quads].any(axis=1)
        quads = quads[keep]
        if len(quads) == 0:
            continue
        used = np.unique(quads)
        remap = np.full(len(points), -1, dtype=np.int32)
        remap[used] = np.arange(len(used), dtype=np.int32)
        obj = mesh_from_polys(f"{prefix} {name}", points[used], remap[quads])
        set_material(obj, material_id)
        obj["sculpt_mass"] = name
        objects.append(obj)
    return objects


# --------------------------------------------------------------------------
# Baked shading
# --------------------------------------------------------------------------


def bake_shade(volume: sdf.Volume, points, normals, *, strength: float = 0.72, radii=(0.014, 0.04, 0.1), mottle: float = 0.04, mottle_scale: float = 2.2) -> np.ndarray:
    """Per-vertex clay shading: cavity occlusion, kiln mottling and soft top light."""
    points = np.asarray(points, dtype=np.float64)
    normals = np.asarray(normals, dtype=np.float64)
    occlusion = sdf.ambient_occlusion(volume, points + normals * (volume.h * 0.75), normals, radii=radii)
    shade = 1.0 - strength * np.clip(occlusion * 1.2, 0.0, 1.0)
    # One broad octave only: finer noise aliases into streaks on decimated triangles.
    noise = sdf.value_noise(points, mottle_scale, 3)
    shade = shade * (1.0 + mottle * (noise - 0.5) * 2.0)
    shade = shade * (0.94 + 0.06 * np.clip(normals[:, 2], -1.0, 1.0))
    return np.clip(shade, 0.2, 1.0).astype(np.float32)


def set_point_color(obj, name: str, values) -> None:
    mesh = obj.data
    attribute = mesh.color_attributes.get(name) or mesh.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    values = np.asarray(values, dtype=np.float32)
    if values.ndim == 1:
        values = np.stack([values, values, values, np.ones_like(values)], axis=1)
    attribute.data.foreach_set("color", values.ravel())
    mesh.color_attributes.active_color = attribute
    mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attribute)


def get_point_color(obj, name: str) -> np.ndarray:
    attribute = obj.data.color_attributes[name]
    out = np.zeros(len(attribute.data) * 4, dtype=np.float32)
    attribute.data.foreach_get("color", out)
    return out.reshape(-1, 4)


def shade_object(obj, volume: sdf.Volume, **options) -> None:
    obj.data.update()
    set_point_color(obj, "shade", bake_shade(volume, vertex_array(obj), normal_array(obj), **options))


# --------------------------------------------------------------------------
# Hard-surface props (crisp meshes joined beside the sculpted clay)
# --------------------------------------------------------------------------


def _finish(obj, material_id: int, smooth_shading: bool = True):
    set_material(obj, material_id)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth_shading
    return obj


def _bevel(obj, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new("soft edge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    apply_modifier(obj, modifier)


def prop_cylinder(name, start, end, radius, material_id, *, radius_end=None, sides=16, bevel=0.0):
    a, b = Vector(start), Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cone_add(
        vertices=sides,
        radius1=radius,
        radius2=radius if radius_end is None else radius_end,
        depth=direction.length,
        location=(a + b) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    _bevel(obj, bevel)
    return _finish(obj, material_id)


def prop_lathe(name, profile, material_id, *, segments=72, center=(0.0, 0.0), rotation=None):
    """Revolve an ascending ``(radius, z)`` profile around the vertical axis; ends are capped."""
    rings = len(profile)
    points = []
    for radius, z in profile:
        for step in range(segments):
            angle = 2 * math.pi * step / segments
            points.append((center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle), z))
    faces = []
    for ring in range(rings - 1):
        for step in range(segments):
            nxt = (step + 1) % segments
            a, b = ring * segments + step, ring * segments + nxt
            faces.append((a, b, b + segments, a + segments))
    if profile[0][0] > 1e-6:
        faces.append(tuple(reversed(range(segments))))
    if profile[-1][0] > 1e-6:
        offset = (rings - 1) * segments
        faces.append(tuple(offset + step for step in range(segments)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if rotation is not None:
        obj.rotation_euler = tuple(math.radians(angle) for angle in rotation)
        activate(obj)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return _finish(obj, material_id)


def prop_torus(name, center, major, minor, material_id, *, rotation=(0.0, 0.0, 0.0), major_segments=40, minor_segments=10):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=center,
        rotation=tuple(math.radians(angle) for angle in rotation),
    )
    obj = bpy.context.object
    obj.name = name
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return _finish(obj, material_id)


def prop_wheel(name, center, radius, tyre_material, spoke_material, hub_material, *, tyre=0.06, spokes=8, hub=0.125, hub_width=0.11):
    """Spoked cart wheel turning about the X axis."""
    cx, cy, cz = center
    parts = [
        prop_torus(f"{name} tyre", center, radius - tyre, tyre, tyre_material, rotation=(0, 90, 0)),
        prop_torus(f"{name} felloe", center, radius - tyre * 2.15, tyre * 0.55, spoke_material, rotation=(0, 90, 0), major_segments=32, minor_segments=8),
        prop_cylinder(f"{name} hub", (cx - hub_width, cy, cz), (cx + hub_width, cy, cz), hub, hub_material, sides=20, bevel=0.016),
        prop_cylinder(f"{name} hub cap", (cx - hub_width * 1.35, cy, cz), (cx + hub_width * 1.35, cy, cz), hub * 0.5, tyre_material, sides=14, bevel=0.01),
    ]
    reach = radius - tyre * 1.9
    for index in range(spokes):
        angle = 2 * math.pi * index / spokes
        root = (cx, cy + hub * 0.6 * math.cos(angle), cz + hub * 0.6 * math.sin(angle))
        tip = (cx, cy + reach * math.cos(angle), cz + reach * math.sin(angle))
        parts.append(prop_cylinder(f"{name} spoke {index}", root, tip, 0.034, spoke_material, radius_end=0.024, sides=8))
    return parts


def join(objects, name: str):
    objects = [obj for obj in objects if obj is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name} mesh"
    return joined


# --------------------------------------------------------------------------
# Review renders
# --------------------------------------------------------------------------


def face_material_ids(obj) -> np.ndarray:
    slots = np.array([MATERIAL_BY_NAME[slot.material.name.split(".")[0].removesuffix(" (GLB)")] for slot in obj.material_slots], dtype=np.int32)
    index = np.zeros(len(obj.data.polygons), dtype=np.int32)
    obj.data.polygons.foreach_get("material_index", index)
    return slots[index]


def display_colors(obj, remap=None) -> None:
    """Bake the runtime look (palette x shade) into a corner attribute for previews."""
    mesh = obj.data
    ids = face_material_ids(obj)
    lookup = np.zeros((max(PALETTE) + 1, 3), dtype=np.float32)
    for material_id, (_name, color, _rough, _metal) in PALETTE.items():
        lookup[material_id] = color if remap is None or material_id not in remap else remap[material_id]
    loop_total = np.zeros(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("loop_total", loop_total)
    loop_vertex = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_vertex)
    colors = lookup[np.repeat(ids, loop_total)]
    if "shade" in mesh.color_attributes:
        colors = colors * get_point_color(obj, "shade")[:, 0][loop_vertex][:, None]
    attribute = mesh.color_attributes.get("display") or mesh.color_attributes.new("display", "FLOAT_COLOR", "CORNER")
    attribute.data.foreach_set("color", np.concatenate([colors, np.ones((len(colors), 1), np.float32)], axis=1).ravel())


def preview_material():
    mat = bpy.data.materials.get("terracotta preview") or bpy.data.materials.new("terracotta preview")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "display"
    bsdf.inputs["Roughness"].default_value = 0.94
    bsdf.inputs["Metallic"].default_value = 0.04
    links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat


def look_at(obj, target) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_review_lights(target, shadows: bool = False, scale: float = 1.0) -> None:
    """Board-like lighting: warm key, cool fill, rim. The game casts no piece shadows."""
    for name, location, energy, size, color in (
        ("review key", (-2.4, -3.2, 3.6), 420.0, 2.6, (1.0, 0.86, 0.72)),
        ("review fill", (2.6, -2.6, 1.6), 150.0, 3.0, (0.74, 0.82, 0.96)),
        ("review rim", (1.8, 2.6, 3.0), 260.0, 2.2, (1.0, 0.62, 0.40)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.size, data.color, data.shape = energy * scale * scale, size * scale, color, "DISK"
        data.use_shadow = shadows
        light = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(light)
        light.location = Vector(location) * scale + Vector(target)
        look_at(light, target)
    world = bpy.context.scene.world or bpy.data.worlds.new("review world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.05, 0.043, 0.038, 1.0)
    background.inputs["Strength"].default_value = 1.0


def render_views(path, views, resolution=(720, 960)) -> None:
    """Render ``views`` = [(camera location, target, ortho scale or None)] into one sheet."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    camera_data = bpy.data.cameras.new("review camera")
    camera = bpy.data.objects.new("review camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    tiles = []
    for index, (location, target, ortho) in enumerate(views):
        camera.location = location
        look_at(camera, target)
        if ortho:
            camera_data.type, camera_data.ortho_scale = "ORTHO", ortho
        else:
            camera_data.type, camera_data.lens = "PERSP", 70
        tile_path = f"{path}.view{index}.png"
        scene.render.filepath = tile_path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(tile_path)
        tiles.append(np.array(image.pixels[:], dtype=np.float32).reshape(resolution[1], resolution[0], 4))
        bpy.data.images.remove(image)
        os.remove(tile_path)
    sheet = np.concatenate(tiles, axis=1)
    out = bpy.data.images.new("review sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = str(path)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    bpy.data.objects.remove(camera)
