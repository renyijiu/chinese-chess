from __future__ import annotations

import hashlib
import struct
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
NAME = "red-marshal-terracotta-cartoon-v2"
GLB_PATH = ROOT / "assets" / "models" / f"{NAME}.glb"
BLEND_PATH = ROOT / "assets" / "models" / f"{NAME}.blend"
REFERENCE_PATH = ROOT / "assets" / "renders" / f"{NAME}-reference.png"
EDITABLE_COLLECTION = "Qin Terracotta Marshal Cartoon V2 - Editable Parts"
JOINED_COLLECTION = "Cartoon V2 - Joined Render and GLB Mesh"

# These deliberately broad first-run gates reject missing or runaway geometry while
# allowing the primitive-built silhouette to be tuned without brittle recounting.
EDITABLE_PART_RANGE = (85, 260)
TRIANGLE_RANGE = (35_000, 240_000)
MATERIAL_RANGE = (9, 9)
BOUND_RANGES = {
    "minimum": ((-1.15, -1.04), (-1.15, -1.02), (-0.01, 0.01)),
    "maximum": ((1.04, 1.15), (1.04, 1.15), (3.34, 3.58)),
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
EXPECTED_IMAGES = {
    ROOT / "assets" / "renders" / f"{NAME}.png": (1200, 1400),
    ROOT / "assets" / "renders" / f"{NAME}-front.png": (1200, 1400),
    ROOT / "assets" / "renders" / f"{NAME}-head.png": (1200, 1200),
    ROOT / "assets" / "renders" / f"{NAME}-board.png": (2560, 1600),
    REFERENCE_PATH: (1254, 1254),
    **{
        ROOT / "assets" / "renders" / NAME / f"{view}.png": (760, 760)
        for view in ("front", "back", "right", "left", "top", "bottom")
    },
}


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


def sample_image_content(image):
    width, height = image.size
    luminances = []
    opaque_samples = 0
    saturated_samples = 0
    grid_size = 12
    for grid_y in range(grid_size):
        y = round((grid_y + 1) * (height - 1) / (grid_size + 1))
        for grid_x in range(grid_size):
            x = round((grid_x + 1) * (width - 1) / (grid_size + 1))
            pixel_offset = (y * width + x) * 4
            red, green, blue, alpha = image.pixels[pixel_offset : pixel_offset + 4]
            luminances.append(0.2126 * red + 0.7152 * green + 0.0722 * blue)
            opaque_samples += alpha > 0.5
            saturated_samples += max(red, green, blue) - min(red, green, blue) > 0.06
    sample_count = len(luminances)
    return (
        max(luminances) - min(luminances),
        opaque_samples / sample_count,
        saturated_samples / sample_count,
    )


if Path(bpy.data.filepath).resolve() != BLEND_PATH.resolve():
    raise RuntimeError(f"Validator must open the editable BLEND first: {bpy.data.filepath}")
editable_collection = bpy.data.collections.get(EDITABLE_COLLECTION)
if editable_collection is None:
    raise RuntimeError(f"Missing editable source collection: {EDITABLE_COLLECTION}")
editable_parts = [obj for obj in editable_collection.objects if obj.type == "MESH"]
if not EDITABLE_PART_RANGE[0] <= len(editable_parts) <= EDITABLE_PART_RANGE[1]:
    raise RuntimeError(
        f"Editable mesh part count {len(editable_parts)} is outside {EDITABLE_PART_RANGE}"
    )
non_primitive_parts = [
    obj.name
    for obj in editable_parts
    if obj.get("construction") != "primitive_or_simple_mesh"
]
if non_primitive_parts:
    raise RuntimeError(
        "V2 contains parts without the primitive/simple-mesh source marker: "
        f"{non_primitive_parts[:8]}"
    )

joined_collection = bpy.data.collections.get(JOINED_COLLECTION)
if joined_collection is None:
    raise RuntimeError(f"Missing joined source collection: {JOINED_COLLECTION}")
joined_meshes = [obj for obj in joined_collection.objects if obj.type == "MESH"]
if len(joined_meshes) != 1:
    raise RuntimeError(
        f"Expected exactly one joined mesh in {JOINED_COLLECTION}, found {len(joined_meshes)}"
    )

editable_signature, editable_material_signature, editable_triangles = (
    canonical_triangle_signature(editable_parts)
)
joined_signature, joined_material_signature, joined_triangles = (
    canonical_triangle_signature(joined_meshes)
)
joined_source = joined_meshes[0]
current_manifest = {
    "source_editable_signature_sha256": editable_signature,
    "source_joined_signature_sha256": joined_signature,
    "source_editable_material_signature_sha256": editable_material_signature,
    "source_joined_material_signature_sha256": joined_material_signature,
    "source_triangle_count": joined_triangles,
    "source_primitive_only": True,
    "source_character_proportion": "2.25-head",
}
stored_manifest = {key: joined_source.get(key) for key in current_manifest}
for key, actual in current_manifest.items():
    expected = stored_manifest[key]
    if expected != actual:
        raise RuntimeError(
            f"BLEND source manifest mismatch for {key}: {actual!r}; expected {expected!r}"
        )
if editable_triangles != joined_triangles:
    raise RuntimeError(
        "Joined source triangle count does not match editable parts: "
        f"editable={editable_triangles}, joined={joined_triangles}"
    )

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one GLB mesh object, found {len(meshes)}")

mesh = meshes[0]
glb_signature, glb_material_signature, glb_signature_triangles = (
    canonical_triangle_signature(meshes)
)
triangles = glb_signature_triangles
if glb_signature != joined_signature or glb_material_signature != joined_material_signature:
    raise RuntimeError(
        "GLB geometry or face materials do not match joined BLEND source: "
        f"geometry={glb_signature}, expected_geometry={joined_signature}, "
        f"materials={glb_material_signature}, expected_materials={joined_material_signature}"
    )
for key, expected in stored_manifest.items():
    actual = mesh.get(key)
    if actual != expected:
        raise RuntimeError(f"GLB source manifest mismatch for {key}: {actual!r}; expected {expected!r}")

materials = list(mesh.data.materials)
world_corners = [mesh.matrix_world @ type(mesh.location)(corner) for corner in mesh.bound_box]
minimum = tuple(min(corner[index] for corner in world_corners) for index in range(3))
maximum = tuple(max(corner[index] for corner in world_corners) for index in range(3))

if not TRIANGLE_RANGE[0] <= triangles <= TRIANGLE_RANGE[1]:
    raise RuntimeError(f"Triangle count {triangles} is outside {TRIANGLE_RANGE}")
if not MATERIAL_RANGE[0] <= len(materials) <= MATERIAL_RANGE[1]:
    raise RuntimeError(f"Material count {len(materials)} is outside {MATERIAL_RANGE}")
for label, actual_values in (("minimum", minimum), ("maximum", maximum)):
    for axis, (actual, expected_range) in enumerate(zip(actual_values, BOUND_RANGES[label], strict=True)):
        if not expected_range[0] <= actual <= expected_range[1]:
            raise RuntimeError(
                f"Unexpected {label} axis {axis}: {actual:.6f}; expected in {expected_range}"
            )

base_colors = []
material_names = set()
for material in materials:
    bsdf = material.node_tree.nodes.get("Principled BSDF") if material and material.use_nodes else None
    if not bsdf:
        raise RuntimeError(
            f"Missing glTF-compatible Principled material: {material.name if material else 'None'}"
        )
    color = tuple(round(value, 5) for value in bsdf.inputs["Base Color"].default_value[:3])
    if color == (0.8, 0.8, 0.8) or min(color) >= 0.95:
        raise RuntimeError(f"Material has a default or white base color: {material.name} {color}")
    base_colors.append(color)
    material_names.add(material.name.lower())
if len(set(base_colors)) != len(materials):
    raise RuntimeError(
        f"Expected {len(materials)} distinct GLB base colors, found {len(set(base_colors))}"
    )
missing_material_tokens = {
    token for token in REQUIRED_MATERIAL_TOKENS if not any(token in name for name in material_names)
}
if missing_material_tokens:
    raise RuntimeError(f"Missing semantic GLB materials: {sorted(missing_material_tokens)}")

image_metrics = {}
for image_path, expected_size in EXPECTED_IMAGES.items():
    try:
        image = bpy.data.images.load(str(image_path), check_existing=False)
    except RuntimeError as error:
        raise RuntimeError(f"Missing render artifact: {image_path}") from error
    actual_size = tuple(image.size)
    luminance_range, alpha_coverage, chroma_coverage = sample_image_content(image)
    bpy.data.images.remove(image)
    if actual_size != expected_size:
        raise RuntimeError(f"Unexpected image size for {image_path}: {actual_size}; expected {expected_size}")
    if luminance_range <= 0.04:
        raise RuntimeError(
            f"Render has insufficient luminance variation for {image_path}: {luminance_range:.6f}"
        )
    if alpha_coverage == 0.0:
        raise RuntimeError(f"Render has no visible sampled pixels: {image_path}")
    if chroma_coverage < 0.02:
        raise RuntimeError(
            f"Render has insufficient colored content for {image_path}: {chroma_coverage:.6f}"
        )
    image_metrics[image_path] = (luminance_range, alpha_coverage, chroma_coverage)

print(f"VALIDATED_BLEND={BLEND_PATH}")
print(f"EDITABLE_PARTS={len(editable_parts)}")
print(f"VALIDATED_GLB={GLB_PATH}")
print("MESH_OBJECTS=1")
print(f"TRIANGLES={triangles}")
print(f"EDITABLE_GEOMETRY_SIGNATURE_SHA256={editable_signature}")
print(f"JOINED_GEOMETRY_SIGNATURE_SHA256={joined_signature}")
print(f"GLB_GEOMETRY_SIGNATURE_SHA256={glb_signature}")
print(f"EDITABLE_MATERIAL_SIGNATURE_SHA256={editable_material_signature}")
print(f"JOINED_MATERIAL_SIGNATURE_SHA256={joined_material_signature}")
print(f"GLB_MATERIAL_SIGNATURE_SHA256={glb_material_signature}")
print(f"SOURCE_MANIFEST_TRIANGLES={stored_manifest['source_triangle_count']}")
print(f"MATERIALS={len(materials)}")
print(f"BASE_COLORS={base_colors}")
print(f"BOUNDS_MIN={minimum}")
print(f"BOUNDS_MAX={maximum}")
print(f"MIN_IMAGE_LUMINANCE_RANGE={min(metric[0] for metric in image_metrics.values()):.6f}")
print(f"MIN_IMAGE_CHROMA_COVERAGE={min(metric[2] for metric in image_metrics.values()):.6f}")
