"""Adapt the sculpted Qin-terracotta roster to the runtime contract.

The repository-owned research GLBs under ``assets/models`` are the geometry
and appearance authority. This script scales them uniformly onto the 0.89 m
plinth, simplifies them per LOD, bakes the palette and clay shading into vertex
colours, and rigs each island to the bone its source marks it for.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

import bpy
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = Path(os.environ.get("XIANGQI_ASSET_OUTPUT_ROOT", ROOT)).resolve()
ROLES = ("marshal", "advisor", "elephant", "chariot", "horse", "cannon", "soldier")
DISPLAY_NAMES = {
    "marshal": {"red": "帅", "black": "将"},
    "advisor": {"red": "仕", "black": "士"},
    "elephant": {"red": "相", "black": "象"},
    "chariot": {"red": "俥", "black": "車"},
    "horse": {"red": "傌", "black": "馬"},
    "cannon": {"red": "炮", "black": "砲"},
    "soldier": {"red": "兵", "black": "卒"},
}
SOURCE_LOCK = json.loads((ROOT / "assets/models/authoritative-piece-sources.lock.json").read_text())
STYLE_FAMILY = SOURCE_LOCK["styleFamily"]
AUTHORITATIVE_MODEL_FILES = {role: SOURCE_LOCK["roles"][role]["visual"]["path"] for role in ROLES}
# Every piece is scaled by one factor so its plinth is exactly this wide; the
# figure keeps the proportions it was sculpted with.
BASE_DIAMETER = 0.89
SOURCE_BASE_TOP = 0.415
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
    "marshal": ["Q-version Qin commander", "twin-tailed crown with a jade seal", "both hands on a jade-hilted sword over lamellar armour"],
    "advisor": ["Q-version Qin court officer", "winged cap and crossed-lapel robe", "bamboo slips held in both hands"],
    "elephant": ["Q-version war elephant", "lamellar blanket and command tower", "curled trunk and ivory tusks"],
    "chariot": ["Q-version command chariot", "spoked wheels and shielded cart", "driver at the reins beneath twin pennants"],
    "horse": ["Q-version cavalry", "barded war horse with a jade chamfron", "helmeted rider holding the reins"],
    "cannon": ["Q-version siege crossbow", "torsion bed, heavy bolt and winch", "two kneeling engineers; no gunpowder"],
    "soldier": ["Q-version Qin spearman", "tied topknot and lamellar vest", "tall spear with a cinnabar tassel"],
}
# Rig parts written by the sculpt pipeline into TEXCOORD_0.u, one per island.
PARTS = ("static", "body", "head", "arm", "weapon", "mount")
PART_SLOTS = 16
LODS = ("lod0", "lod1", "lod2")
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


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file_:
        for chunk in iter(lambda: file_.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def smoothstep(edge0, edge1, value):
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------


def material_base_color(material):
    """Colour factor of a source material; its Base Color is multiplied by the baked shade."""
    bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None) if material.use_nodes else None
    if bsdf is None:
        return tuple(material.diffuse_color[:3])
    socket = bsdf.inputs["Base Color"]
    if not socket.is_linked:
        return tuple(socket.default_value[:3])
    for candidate in socket.links[0].from_node.inputs:
        if candidate.type == "RGBA" and not candidate.is_linked and candidate.name != "Factor":
            return tuple(candidate.default_value[:3])
    raise RuntimeError(f"Cannot read the colour factor of source material {material.name}")


def semantic_color_for_material(material):
    name = material.name.lower() if material else ""
    for token, semantic in SEMANTIC_MATERIAL_TOKENS:
        if token in name:
            return SEMANTIC_REFERENCE_COLORS[semantic]
    return None


def import_authoritative_geometry(role):
    """Import the locked source GLB. Returns ``(mesh object, rig hints, base radius)``."""
    relative_path = AUTHORITATIVE_MODEL_FILES[role]
    source_path = ROOT / relative_path
    if not source_path.is_file():
        raise FileNotFoundError(f"{role}: missing authoritative visual source {relative_path}")
    expected_sha256 = SOURCE_LOCK["roles"][role]["visual"]["sha256"]
    if sha256_file(source_path) != expected_sha256:
        raise RuntimeError(f"{role}: authoritative GLB does not match source lock {expected_sha256}")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    meshes = [obj for obj in bpy.context.scene.objects if obj not in before and obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"{role}: expected one sculpted source mesh, found {len(meshes)}")
    character = meshes[0]
    if character.get("source_style_family") != STYLE_FAMILY:
        raise RuntimeError(f"{role}: source GLB is not from the locked style family {STYLE_FAMILY}")
    hints = json.loads(character["rig_hints"])
    base_radius = float(character["source_base_radius"])
    bpy.ops.object.select_all(action="DESELECT")
    character.select_set(True)
    bpy.context.view_layer.objects.active = character
    if character.parent:
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    character.select_set(False)
    character.name = "character_mesh"
    character.data.name = f"{role}_authoritative_geometry"
    for key in list(character.keys()):
        del character[key]
    return character, hints, base_radius


def triangle_count(character):
    character.data.calc_loop_triangles()
    return len(character.data.loop_triangles)


def decimate_to_lod(character, role, lod_name):
    current = triangle_count(character)
    budget = LOD_TRIANGLE_BUDGETS[role][lod_name]
    target = min(current, math.floor(budget * LOD_TARGET_FRACTIONS[lod_name]))
    for label, goal in (("authoritative", target), ("budget safety", budget * 0.96)):
        if current <= goal:
            break
        modifier = character.modifiers.new(f"{lod_name} {label} decimation", "DECIMATE")
        modifier.ratio = max(0.01, goal / current)
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = character
        character.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        character.select_set(False)
        current = triangle_count(character)
        if current <= budget:
            break
    if current > budget:
        raise RuntimeError(f"{role}/{lod_name}: {current} triangles exceeds budget {budget} after decimation")
    return current


def weld_normals(character):
    """Drop the imported per-corner normals; keep creases only where the clay really folds."""
    bpy.ops.object.select_all(action="DESELECT")
    character.select_set(True)
    bpy.context.view_layer.objects.active = character
    if "custom_normal" in character.data.attributes:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    mesh = character.data
    mesh.polygons.foreach_set("use_smooth", np.ones(len(mesh.polygons), dtype=bool))
    mesh.set_sharp_from_angle(angle=math.radians(46))
    mesh.update()
    character.select_set(False)


def scale_to_plinth(character, role, base_radius):
    """One uniform scale puts the plinth at BASE_DIAMETER; the sculpt's proportions are kept."""
    scale = BASE_DIAMETER / (2.0 * base_radius)
    mesh = character.data
    coords = np.zeros(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3) * scale
    if abs(float(coords[:, 2].min())) > 0.01:
        raise RuntimeError(f"{role}: source plinth does not rest on z=0")
    coords[:, 2] -= coords[:, 2].min()
    mesh.vertices.foreach_set("co", coords.ravel())
    mesh.update()
    return scale


def vertex_parts(character, role):
    """Rig part of every vertex, read from the island-constant rig-hint UV channel."""
    mesh = character.data
    if not mesh.uv_layers:
        raise RuntimeError(f"{role}: source carries no rig-hint UV channel")
    uv = np.zeros(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers[0].data.foreach_get("uv", uv)
    loop_vertex = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_vertex)
    slots = np.clip(np.floor(uv.reshape(-1, 2)[:, 0] * PART_SLOTS).astype(np.int32), 0, len(PARTS) - 1)
    parts = np.zeros(len(mesh.vertices), dtype=np.int32)
    parts[loop_vertex] = slots
    return parts


def bake_vertex_palette(character, role):
    """Collapse the source materials into COLOR_0 and keep the clay shading in _SHADE.

    Natural clay takes its shading straight into COLOR_0. Faction regions must
    stay exact reference colours for the runtime remap, so their shading rides
    in a custom scalar attribute and is multiplied back in after the remap. (A
    second colour set cannot carry it: Blender's glTF exporter blanks every
    colour set but the last one a material is mapped to.)
    """
    mesh = character.data
    source = mesh.color_attributes[0] if mesh.color_attributes else None
    if source is None or source.domain != "CORNER":
        raise RuntimeError(f"{role}: source carries no per-corner baked shade")
    shade = np.zeros(len(mesh.loops) * 4, dtype=np.float32)
    source.data.foreach_get("color", shade)
    # Decimation leaves slightly different values on the corners that meet at a
    # vertex; averaging them keeps the export from splitting every vertex.
    loop_vertex = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_vertex)
    per_vertex = np.bincount(loop_vertex, weights=shade.reshape(-1, 4)[:, 0], minlength=len(mesh.vertices))
    per_vertex /= np.maximum(np.bincount(loop_vertex, minlength=len(mesh.vertices)), 1)
    shade = per_vertex[loop_vertex].astype(np.float32)[:, None]
    slot_colors = np.zeros((len(character.material_slots), 3), dtype=np.float32)
    slot_semantic = np.zeros(len(character.material_slots), dtype=bool)
    for index, slot in enumerate(character.material_slots):
        semantic = semantic_color_for_material(slot.material)
        slot_semantic[index] = semantic is not None
        slot_colors[index] = semantic or material_base_color(slot.material)
    material_index = np.zeros(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("material_index", material_index)
    loop_total = np.zeros(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("loop_total", loop_total)
    loop_slot = np.repeat(material_index, loop_total)
    semantic = slot_semantic[loop_slot][:, None]
    colors = np.where(semantic, slot_colors[loop_slot], slot_colors[loop_slot] * shade)
    mesh.color_attributes.remove(source)
    # Create both attributes before writing: adding one invalidates earlier handles.
    mesh.color_attributes.new(name="faction_palette", type="BYTE_COLOR", domain="CORNER")
    mesh.attributes.new(name="_SHADE", type="FLOAT", domain="POINT")
    mesh.color_attributes["faction_palette"].data.foreach_set("color", np.concatenate([colors, np.ones_like(shade)], axis=1).ravel())
    mesh.attributes["_SHADE"].data.foreach_set("value", per_vertex.astype(np.float32))
    mesh.polygons.foreach_set("material_index", np.zeros(len(mesh.polygons), dtype=np.int32))
    material = pbr_material(f"{role}_terracotta_vertex_palette", (1, 1, 1, 1), 0.94, 0.04)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = "faction_palette"
    links.new(vertex_color.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    mesh.materials.clear()
    mesh.materials.append(material)
    mesh.color_attributes.active_color = mesh.color_attributes["faction_palette"]
    mesh.color_attributes.render_color_index = 0
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    mesh.update()


def create_geometry(role, lod_name):
    character, hints, base_radius = import_authoritative_geometry(role)
    decimate_to_lod(character, role, lod_name)
    weld_normals(character)
    scale = scale_to_plinth(character, role, base_radius)
    parts = vertex_parts(character, role)
    bake_vertex_palette(character, role)
    character.data.calc_loop_triangles()
    return character, hints, scale, parts


# --------------------------------------------------------------------------
# Rig
# --------------------------------------------------------------------------


def rig_joints(hints, scale):
    """Bone layout in runtime metres, built from the joints the sculpt recorded."""

    def point(values):
        return np.array(values, dtype=np.float64) * scale

    pelvis, waist, chest, neck = (float(value) * scale for value in hints["spine"])
    head = point(hints["head"])
    axis = np.array([head[0], head[1], 0.0])
    arm = {name: point(values) for name, values in hints["arm"].items()}
    mirror = np.array([-1.0, 1.0, 1.0])
    weapon = [point(end) for end in hints["weapon"]]
    mount = [point(end) for end in hints.get("mount", [[0.0, 0.1 / scale, 0.5 / scale], [0.0, -0.18 / scale, 0.72 / scale]])]
    hand_reach = (arm["wrist"] - arm["elbow"]) / max(np.linalg.norm(arm["wrist"] - arm["elbow"]), 1e-6) * 0.05
    up = np.array([0.0, 0.0, 1.0])
    return {
        "root": (np.zeros(3), up * SOURCE_BASE_TOP * scale, None),
        "pelvis": (axis + up * pelvis, axis + up * waist, "root"),
        "spine": (axis + up * waist, axis + up * chest, "pelvis"),
        "chest": (axis + up * chest, axis + up * neck, "spine"),
        "neck": (axis + up * neck, axis + up * (neck + 0.04), "chest"),
        "head": (axis + up * (neck + 0.04), head + up * 0.2, "neck"),
        "upper_arm.R": (arm["shoulder"], arm["elbow"], "chest"),
        "forearm.R": (arm["elbow"], arm["wrist"], "upper_arm.R"),
        "hand.R": (arm["wrist"], arm["wrist"] + hand_reach, "forearm.R"),
        "upper_arm.L": (arm["shoulder"] * mirror, arm["elbow"] * mirror, "chest"),
        "forearm.L": (arm["elbow"] * mirror, arm["wrist"] * mirror, "upper_arm.L"),
        "hand.L": (arm["wrist"] * mirror, (arm["wrist"] + hand_reach) * mirror, "forearm.L"),
        "mount": (mount[0], mount[1], "pelvis"),
        "weapon": (weapon[0], weapon[1], "hand.R"),
    }


def create_rig(role, joints):
    armature = bpy.data.armatures.new(f"{role}_skeleton")
    rig = bpy.data.objects.new("rig_root", armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = {}
    for name, (head, tail, parent) in joints.items():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail, bone.use_deform = tuple(head), tuple(tail), True
        if parent:
            bone.parent = bones[parent]
        bones[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return rig


def arm_weights(points, joints, side):
    """Soft upper-arm / forearm / hand weights with a short blend into the chest."""
    shoulder, elbow, wrist = (joints[f"{name}.{side}"][0] for name in ("upper_arm", "forearm", "hand"))
    upper, fore = elbow - shoulder, wrist - elbow
    u = (points - shoulder) @ upper / float(upper @ upper)
    v = (points - elbow) @ fore / float(fore @ fore)
    to_upper = np.linalg.norm(points - (shoulder + np.clip(u, 0, 1)[:, None] * upper), axis=1)
    to_fore = np.linalg.norm(points - (elbow + np.clip(v, 0, 1)[:, None] * fore), axis=1)
    on_fore = to_fore < to_upper
    hand = np.where(on_fore, smoothstep(0.85, 1.1, v), 0.0)
    elbow_from_fore = np.where(on_fore, 0.5 * (1.0 - smoothstep(0.0, 0.3, v)), 0.0)
    elbow_from_upper = np.where(on_fore, 0.0, 0.5 * smoothstep(0.7, 1.0, u))
    chest = np.where(on_fore, 0.0, 0.5 * (1.0 - smoothstep(0.0, 0.35, u)))
    forearm = np.where(on_fore, 1.0 - hand - elbow_from_fore, elbow_from_upper)
    upper_arm = np.where(on_fore, elbow_from_fore, 1.0 - elbow_from_upper - chest)
    return {f"upper_arm.{side}": upper_arm, f"forearm.{side}": forearm, f"hand.{side}": hand, "chest": chest}


def skin_character(character, rig, joints, parts):
    """Bind every island to the bone its part names; only the torso and arms bend."""
    mesh = character.data
    points = np.zeros(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", points)
    points = points.reshape(-1, 3)
    weights = {name: np.zeros(len(points)) for name in joints}
    part = lambda name: parts == PARTS.index(name)  # noqa: E731
    weights["root"][part("static")] = 1.0
    weights["head"][part("head")] = 1.0
    weights["weapon"][part("weapon")] = 1.0
    weights["mount"][part("mount")] = 1.0
    body = part("body")
    z = points[:, 2]
    lower = smoothstep(joints["pelvis"][0][2], joints["pelvis"][1][2], z)
    upper = smoothstep(joints["spine"][0][2], joints["spine"][1][2], z)
    weights["pelvis"][body] = (1.0 - lower)[body]
    weights["spine"][body] = (lower * (1.0 - upper))[body]
    weights["chest"][body] = (lower * upper)[body]
    centre_x = joints["pelvis"][0][0]
    for side, mask in (("R", part("arm") & (points[:, 0] >= centre_x)), ("L", part("arm") & (points[:, 0] < centre_x))):
        if not mask.any():
            continue
        for name, values in arm_weights(points[mask], joints, side).items():
            weights[name][mask] += values
    total = sum(weights.values())
    if (total < 0.999).any():
        raise RuntimeError("Some vertices were left without a bone")
    for name, values in weights.items():
        group = character.vertex_groups.new(name=name)
        solid = np.nonzero(values >= 0.999)[0]
        if len(solid):
            group.add(solid.tolist(), 1.0, "REPLACE")
        for index in np.nonzero((values > 0.001) & (values < 0.999))[0]:
            group.add([int(index)], float(values[index] / total[index]), "REPLACE")
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
    travel_bone = "mount" if mounted else "spine"
    action_frames = {
        "idle_loop": [(1, neutral), (16, {"chest": (0.02, 0, 0.018), "head": (0, 0, -0.018)}), (31, neutral)],
        "move_start": [(1, neutral), (10, {travel_bone: (0.06, 0, 0), "chest": (0.025, 0, 0)})],
        "move_loop": [(1, {travel_bone: (0.05, 0, -0.035)}), (9, {travel_bone: (0.08, 0, 0.04), "chest": (0, 0, 0.025)}), (17, {travel_bone: (0.05, 0, -0.035)})],
        "move_end": [(1, {travel_bone: (0.055, 0, 0.02)}), (10, neutral)],
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


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------


def write_metadata(role, scale):
    directory = OUTPUT_ROOT / "assets" / "characters" / role
    directory.mkdir(parents=True, exist_ok=True)
    locked_source = SOURCE_LOCK["roles"][role]
    authoritative_path = locked_source["visual"]["path"]
    editable_master = locked_source["editableMaster"]["path"]
    if sha256_file(ROOT / authoritative_path) != locked_source["visual"]["sha256"]:
        raise RuntimeError(f"{role}: authoritative GLB digest differs from source lock")
    if sha256_file(ROOT / editable_master) != locked_source["editableMaster"]["sha256"]:
        raise RuntimeError(f"{role}: editable master digest differs from source lock")
    derived_raw_lods = {}
    for lod_name in LODS:
        raw_path = directory / "exports" / f"{role}-{lod_name}-raw.glb"
        if not raw_path.is_file():
            continue
        derived_raw_lods[lod_name] = {
            "path": str(raw_path.relative_to(OUTPUT_ROOT)),
            "sha256": sha256_file(raw_path),
        }
    metadata = {
        "schema": "xiangqi-source-asset/v2", "role": role, "displayNames": DISPLAY_NAMES[role],
        "generator": {"application": "Blender", "version": bpy.app.version_string, "script": "scripts/blender/create_xiangqi_piece_assets.py"},
        "authoritativeVisualSource": {
            "path": authoritative_path,
            "sha256": locked_source["visual"]["sha256"],
            "editableMaster": editable_master,
            "editableMasterSha256": locked_source["editableMaster"]["sha256"],
        },
        "derivedRawLods": derived_raw_lods,
        "styleFamily": STYLE_FAMILY,
        "derivationMode": "authoritative-import",
        "reference": "assets/models/README.md",
        "license": "Repository-owned Qin-terracotta research asset; no third-party geometry or bitmap textures",
        "visualIntent": VISUAL_INTENT[role],
        "periodPolicy": "Qin terracotta visual fantasy: no gunpowder artillery; cannon role is represented by a heavy siege crossbow",
        "scale": {"baseDiameter": BASE_DIAMETER, "uniformScale": round(scale, 6), "policy": "one factor for all axes; the sculpt's proportions are preserved"},
        "derivation": "Sculpted research GLB scaled uniformly onto the plinth, decimated per LOD, then bound island by island to the shared runtime rig, actions, sockets and faction palette contract",
        "knownLimitations": ["each sculpted island follows one bone; only the torso and sleeves blend between bones", "source colours and clay shading are baked to vertex colours; bitmap normal maps are intentionally absent", "canonical runtime actions are adapters and may be iterated without changing the visual source authority"],
        "texturePolicy": {"bitmapTextures": 0, "ktx2": "not-applicable-no-bitmap-textures", "solidColorBake": f"COLOR_0 VEC3 exact RGB reference colors with shading in _SHADE; one {role}_terracotta_vertex_palette material"},
    }
    (directory / f"{role}.asset.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


def build_lod(role, lod_name):
    reset_scene()
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1.0
    piece_root = bpy.data.objects.new("piece_root", None)
    piece_root.empty_display_type, piece_root.empty_display_size = "CIRCLE", 0.445
    bpy.context.scene.collection.objects.link(piece_root)
    character, hints, scale, parts = create_geometry(role, lod_name)
    joints = rig_joints(hints, scale)
    rig = create_rig(role, joints)
    rig.parent = piece_root
    skin_character(character, rig, joints, parts)
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
    bpy.ops.export_scene.gltf(filepath=str(raw_path), export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_materials="EXPORT", export_texcoords=False, export_all_vertex_colors=False, export_attributes=True, export_animations=True, export_animation_mode="ACTIONS", export_reset_pose_bones=True, export_skins=True, export_morph=False, export_cameras=False, export_lights=False)
    character.data.calc_loop_triangles()
    print(f"XIANGQI_ASSET role={role} lod={lod_name} raw={raw_path} triangles={len(character.data.loop_triangles)} bones={len(rig.data.bones)} clips={len(CLIP_NAMES)} scale={scale:.5f}")
    return scale


selected_roles = tuple(role for role in ROLES if role in os.environ.get("XIANGQI_ROLES", ",".join(ROLES)).split(","))
selected_lods = tuple(lod for lod in LODS if lod in os.environ.get("XIANGQI_LODS", ",".join(LODS)).split(","))

for current_role in selected_roles:
    current_scale = None
    for current_lod in selected_lods:
        current_scale = build_lod(current_role, current_lod)
    write_metadata(current_role, current_scale)

print(f"XIANGQI_ASSET generatedRoles={len(selected_roles)} preservedRoles=0 runtimeAssets={len(selected_roles) * len(selected_lods)}")
