from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
STYLE_FAMILY = "red-xiangqi-qin-terracotta-cartoon-v1"
ROLE_DATA = {
    "advisor": {
        "title": "Advisor", "glyph": "仕", "parts": (35, 180), "triangles": (12_000, 220_000),
        "zmax": (2.55, 2.90),
        "required_parts": ("Advisor bamboo court tablet", "Advisor left cap wing", "Advisor jade cap seal"),
    },
    "elephant": {
        "title": "Elephant", "glyph": "相", "parts": (35, 200), "triangles": (12_000, 240_000),
        "zmax": (2.05, 2.40),
        "required_parts": ("Elephant oversized head", "Elephant tiny guardian tower", "Elephant forehead jade seal"),
    },
    "chariot": {
        "title": "Chariot", "glyph": "车", "parts": (35, 200), "triangles": (12_000, 240_000),
        "zmax": (2.45, 2.65),
        "required_parts": (
            "Chariot compact cart floor", "Chariot curved front shield", "Chariot driver topknot",
            "Chariot left command standard", "Chariot forward yoke left",
        ),
    },
    "horse": {
        "title": "Horse", "glyph": "马", "parts": (45, 230), "triangles": (15_000, 260_000),
        "zmax": (2.95, 3.18),
        "required_parts": ("Horse compact barrel body", "Horse rider tiny armour torso", "Horse forehead armour"),
    },
    "cannon": {
        "title": "Cannon", "glyph": "炮", "parts": (40, 220), "triangles": (12_000, 250_000),
        "zmax": (2.15, 2.50),
        "required_parts": (
            "Cannon torsion machine bed", "Cannon top torsion crossbeam", "Cannon side winding axle",
            "Cannon heavy bronze bolt shaft", "Cannon left fixed outrigger", "Cannon left bow limb outer",
        ),
        "forbidden_part_prefixes": ("Cannon carriage",),
    },
    "soldier": {
        "title": "Soldier", "glyph": "兵", "parts": (40, 190), "triangles": (12_000, 230_000),
        "zmax": (3.35, 3.58),
        "required_parts": ("Soldier compact topknot", "Soldier tall spear shaft", "Soldier spear point"),
    },
}
REQUIRED_MATERIAL_TOKENS = {
    "terracotta",
    "portrait",
    "brown",
    "lacquer",
    "cinnabar",
    "jade",
    "ivory",
    "iris",
    "plinth",
}


def requested_role() -> str:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(arguments) != 1 or arguments[0] not in ROLE_DATA:
        raise RuntimeError(f"Pass exactly one role after --; expected one of {sorted(ROLE_DATA)}")
    return arguments[0]


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
    # contract copied by the generator and preserved by the GLB round trip.
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


def sample_image_content(image):
    width, height = image.size
    luminances = []
    opaque = 0
    saturated = 0
    grid_size = 12
    for grid_y in range(grid_size):
        y = round((grid_y + 1) * (height - 1) / (grid_size + 1))
        for grid_x in range(grid_size):
            x = round((grid_x + 1) * (width - 1) / (grid_size + 1))
            offset = (y * width + x) * 4
            red, green, blue, alpha = image.pixels[offset : offset + 4]
            luminances.append(0.2126 * red + 0.7152 * green + 0.0722 * blue)
            opaque += alpha > 0.5
            saturated += max(red, green, blue) - min(red, green, blue) > 0.06
    count = len(luminances)
    return max(luminances) - min(luminances), opaque / count, saturated / count


role = requested_role()
spec = ROLE_DATA[role]
name = f"red-{role}-terracotta-cartoon-v1"
blend_path = ROOT / "assets" / "models" / f"{name}.blend"
glb_path = ROOT / "assets" / "models" / f"{name}.glb"
editable_collection_name = f"Qin Terracotta {spec['title']} Cartoon V1 - Editable Parts"
joined_collection_name = f"Red {spec['title']} Cartoon V1 - Joined Render and GLB Mesh"

if Path(bpy.data.filepath).resolve() != blend_path.resolve():
    raise RuntimeError(f"Validator for {role} must open {blend_path}, got {bpy.data.filepath}")
editable_collection = bpy.data.collections.get(editable_collection_name)
if editable_collection is None:
    raise RuntimeError(f"Missing editable source collection: {editable_collection_name}")
editable_parts = [obj for obj in editable_collection.objects if obj.type == "MESH"]
part_range = spec["parts"]
if not part_range[0] <= len(editable_parts) <= part_range[1]:
    raise RuntimeError(f"{role}: editable part count {len(editable_parts)} outside {part_range}")
editable_part_names = {obj.name for obj in editable_parts}
missing_required_parts = set(spec["required_parts"]) - editable_part_names
if missing_required_parts:
    raise RuntimeError(f"{role}: missing role-specific editable parts: {sorted(missing_required_parts)}")
for prefix in spec.get("forbidden_part_prefixes", ()):
    forbidden_parts = sorted(name for name in editable_part_names if name.startswith(prefix))
    if forbidden_parts:
        raise RuntimeError(f"{role}: forbidden silhouette parts remain: {forbidden_parts}")
glyph_parts = [obj for obj in editable_parts if obj.get("glyph_source_kind") == "cjk_font_outline"]
if len(glyph_parts) != 1:
    raise RuntimeError(f"{role}: expected one CJK font-outline glyph mesh, found {len(glyph_parts)}")
glyph_part = glyph_parts[0]
if glyph_part.name != f"Front {spec['glyph']} standard font glyph":
    raise RuntimeError(f"{role}: unexpected glyph mesh name: {glyph_part.name!r}")
if glyph_part.get("glyph_text") != spec["glyph"]:
    raise RuntimeError(f"{role}: glyph mesh does not contain {spec['glyph']!r}")
if glyph_part.get("glyph_codepoint") != ord(spec["glyph"]):
    raise RuntimeError(f"{role}: glyph mesh codepoint does not match {spec['glyph']!r}")
if not isinstance(glyph_part.get("glyph_font_glyph_id"), int) or glyph_part["glyph_font_glyph_id"] <= 0:
    raise RuntimeError(f"{role}: glyph mesh lacks a valid font glyph ID")
if len(glyph_part.data.vertices) < 20 or not glyph_part.data.polygons:
    raise RuntimeError(f"{role}: glyph font outline is empty or too simple")
non_primitive_parts = [obj.name for obj in editable_parts if obj.get("construction") != "primitive_or_simple_mesh"]
if non_primitive_parts:
    raise RuntimeError(f"{role}: non-primitive source parts: {non_primitive_parts[:8]}")

joined_collection = bpy.data.collections.get(joined_collection_name)
if joined_collection is None:
    raise RuntimeError(f"Missing joined source collection: {joined_collection_name}")
joined_meshes = [obj for obj in joined_collection.objects if obj.type == "MESH"]
if len(joined_meshes) != 1:
    raise RuntimeError(f"{role}: expected one joined mesh, found {len(joined_meshes)}")

editable_signature, editable_material_signature, editable_triangles = canonical_triangle_signature(editable_parts)
joined_signature, joined_material_signature, joined_triangles = canonical_triangle_signature(joined_meshes)
joined_source = joined_meshes[0]
current_manifest = {
    "source_role": role,
    "source_glyph": spec["glyph"],
    "source_glyph_kind": "cjk_font_outline",
    "source_glyph_codepoint": ord(spec["glyph"]),
    "source_glyph_font_glyph_id": glyph_part["glyph_font_glyph_id"],
    "source_editable_signature_sha256": editable_signature,
    "source_joined_signature_sha256": joined_signature,
    "source_editable_material_signature_sha256": editable_material_signature,
    "source_joined_material_signature_sha256": joined_material_signature,
    "source_triangle_count": joined_triangles,
    "source_primitive_only": True,
    "source_style_family": STYLE_FAMILY,
}
stored_manifest = {key: joined_source.get(key) for key in current_manifest}
for key, actual in current_manifest.items():
    if stored_manifest[key] != actual:
        raise RuntimeError(f"{role}: BLEND manifest mismatch for {key}: {actual!r} != {stored_manifest[key]!r}")
if editable_triangles != joined_triangles:
    raise RuntimeError(f"{role}: editable triangles {editable_triangles} != joined triangles {joined_triangles}")
if editable_signature != joined_signature or editable_material_signature != joined_material_signature:
    raise RuntimeError(f"{role}: editable parts and joined BLEND source differ")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(glb_path))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"{role}: expected one GLB mesh, found {len(meshes)}")
mesh = meshes[0]
glb_signature, glb_material_signature, glb_triangles = canonical_triangle_signature(meshes)
if glb_signature != joined_signature or glb_material_signature != joined_material_signature:
    raise RuntimeError(
        f"{role}: GLB differs from joined BLEND source; geometry={glb_signature}, "
        f"materials={glb_material_signature}"
    )
for key, expected in stored_manifest.items():
    if mesh.get(key) != expected:
        raise RuntimeError(f"{role}: GLB manifest mismatch for {key}: {mesh.get(key)!r} != {expected!r}")

triangle_range = spec["triangles"]
if not triangle_range[0] <= glb_triangles <= triangle_range[1]:
    raise RuntimeError(f"{role}: triangle count {glb_triangles} outside {triangle_range}")
materials = list(mesh.data.materials)
if len(materials) != 9:
    raise RuntimeError(f"{role}: expected nine materials, found {len(materials)}")
material_names = set()
base_colors = []
for material in materials:
    bsdf = material.node_tree.nodes.get("Principled BSDF") if material and material.use_nodes else None
    if bsdf is None:
        raise RuntimeError(f"{role}: material lacks Principled BSDF: {material.name if material else None}")
    color = tuple(round(value, 5) for value in bsdf.inputs["Base Color"].default_value[:3])
    if color == (0.8, 0.8, 0.8) or min(color) >= 0.95:
        raise RuntimeError(f"{role}: default/white material color: {material.name} {color}")
    base_colors.append(color)
    material_names.add(material.name.lower())
if len(set(base_colors)) != 9:
    raise RuntimeError(f"{role}: expected nine distinct material colors, got {len(set(base_colors))}")
missing_tokens = {token for token in REQUIRED_MATERIAL_TOKENS if not any(token in name for name in material_names)}
if missing_tokens:
    raise RuntimeError(f"{role}: missing semantic materials: {sorted(missing_tokens)}")

world_corners = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
minimum = tuple(min(corner[axis] for corner in world_corners) for axis in range(3))
maximum = tuple(max(corner[axis] for corner in world_corners) for axis in range(3))
bound_ranges = {
    "minimum": ((-1.40, -1.00), (-1.55, -1.00), (-0.03, 0.03)),
    "maximum": ((1.00, 1.40), (1.00, 1.40), spec["zmax"]),
}
for label, values in (("minimum", minimum), ("maximum", maximum)):
    for axis, (actual, expected_range) in enumerate(zip(values, bound_ranges[label], strict=True)):
        if not expected_range[0] <= actual <= expected_range[1]:
            raise RuntimeError(f"{role}: unexpected {label} axis {axis}: {actual}, expected {expected_range}")

expected_images = {
    ROOT / "assets" / "renders" / "red-xiangqi-terracotta-cartoon-set-v1-reference.png": (1402, 1122),
    ROOT / "assets" / "renders" / "red-xiangqi-terracotta-cartoon-set-v1-board.png": (3200, 2200),
}
for image_role in ROLE_DATA:
    image_name = f"red-{image_role}-terracotta-cartoon-v1"
    expected_images[ROOT / "assets" / "renders" / f"{image_name}.png"] = (1200, 1400)
    expected_images[ROOT / "assets" / "renders" / f"{image_name}-front.png"] = (1200, 1400)

image_metrics = {}
for image_path, expected_size in expected_images.items():
    try:
        image = bpy.data.images.load(str(image_path), check_existing=False)
    except RuntimeError as error:
        raise RuntimeError(f"Missing render artifact: {image_path}") from error
    actual_size = tuple(image.size)
    metrics = sample_image_content(image)
    bpy.data.images.remove(image)
    if actual_size != expected_size:
        raise RuntimeError(f"Unexpected image size for {image_path}: {actual_size}, expected {expected_size}")
    if metrics[0] <= 0.04 or metrics[1] == 0.0 or metrics[2] < 0.02:
        raise RuntimeError(f"Image is blank or lacks chroma: {image_path}, metrics={metrics}")
    image_metrics[image_path] = metrics

print(f"VALIDATED_ROLE={role}")
print(f"VALIDATED_BLEND={blend_path}")
print(f"VALIDATED_GLB={glb_path}")
print(f"EDITABLE_PARTS={len(editable_parts)}")
print(f"TRIANGLES={glb_triangles}")
print(f"MATERIALS={len(materials)}")
print(f"EDITABLE_GEOMETRY_SIGNATURE_SHA256={editable_signature}")
print(f"JOINED_GEOMETRY_SIGNATURE_SHA256={joined_signature}")
print(f"GLB_GEOMETRY_SIGNATURE_SHA256={glb_signature}")
print(f"EDITABLE_MATERIAL_SIGNATURE_SHA256={editable_material_signature}")
print(f"JOINED_MATERIAL_SIGNATURE_SHA256={joined_material_signature}")
print(f"GLB_MATERIAL_SIGNATURE_SHA256={glb_material_signature}")
print(f"BOUNDS_MIN={minimum}")
print(f"BOUNDS_MAX={maximum}")
print(f"MIN_IMAGE_LUMINANCE_RANGE={min(metric[0] for metric in image_metrics.values()):.6f}")
print(f"MIN_IMAGE_CHROMA_COVERAGE={min(metric[2] for metric in image_metrics.values()):.6f}")
