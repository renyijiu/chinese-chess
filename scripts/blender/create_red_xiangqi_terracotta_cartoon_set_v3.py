"""Sculpt the Q-version Qin terracotta roster (V3) for all seven Xiangqi roles.

V3 keeps the V1/V2 toy proportions, layouts and nine research materials, and
replaces the stacked primitives with clay masses that are pressed, carved and
shaded. Run through ``build_red_xiangqi_terracotta_cartoon_set_v3.py``.

Environment:
    XIANGQI_SOURCE_ROLES   comma-separated subset of roles to build
    XIANGQI_SCULPT_VOXEL   voxel size in source units (default 0.006)
    XIANGQI_SCULPT_PREVIEW directory for review sheets; skips BLEND/GLB export
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import terracotta_figures as tf
import terracotta_mesh as tm
import terracotta_sdf as sdf
from cjk_font_cmap import font_glyph_ids, validated_text_body
from terracotta_mesh import CINNABAR, DEEP_BROWN, EYE_IVORY, INK, IRIS, JADE, LACQUER, PLINTH, PORTRAIT, TERRACOTTA
from terracotta_sdf import IDENTITY


ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "assets" / "models"
RENDER_DIR = ROOT / "assets" / "renders"
STYLE_FAMILY = "red-xiangqi-qin-terracotta-cartoon-v3"
ROLES = (
    {"role": "marshal", "title": "Marshal", "glyph": "帅", "triangles": 66000},
    {"role": "advisor", "title": "Advisor", "glyph": "仕", "triangles": 52000},
    {"role": "elephant", "title": "Elephant", "glyph": "相", "triangles": 78000},
    {"role": "chariot", "title": "Chariot", "glyph": "车", "triangles": 74000},
    {"role": "horse", "title": "Horse", "glyph": "马", "triangles": 70000},
    {"role": "cannon", "title": "Cannon", "glyph": "炮", "triangles": 60000},
    {"role": "soldier", "title": "Soldier", "glyph": "兵", "triangles": 41000},
)
VOXEL = float(os.environ.get("XIANGQI_SCULPT_VOXEL", "0.006"))
PREVIEW_DIR = os.environ.get("XIANGQI_SCULPT_PREVIEW")
BASE_TOP = 0.415
HEAD_MATERIALS = {"skin": PORTRAIT, "hair": DEEP_BROWN, "eye_white": EYE_IVORY, "iris": IRIS, "ink": INK, "blush": TERRACOTTA, "trim": CINNABAR}


# --------------------------------------------------------------------------
# Shared pieces
# --------------------------------------------------------------------------


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
    raise FileNotFoundError("No CJK font found for the chess glyphs; set TERRACOTTA_FONT_PATH to a Chinese font")


GLYPH_FONT_PATH = glyph_font_path()
GLYPH_FONT_GLYPH_IDS = font_glyph_ids(GLYPH_FONT_PATH, (spec["glyph"] for spec in ROLES))


def add_glyph(glyph: str):
    font = bpy.data.fonts.load(str(GLYPH_FONT_PATH), check_existing=True)
    bpy.ops.object.text_add(location=(0, -1.095, 0.225), rotation=(math.pi / 2, 0, 0))
    label = bpy.context.object
    label.name = f"Front {glyph} standard font glyph"
    label.data.body = glyph
    actual = validated_text_body(glyph, label.data.body)
    label.data.align_x = label.data.align_y = "CENTER"
    label.data.size = 0.285
    label.data.extrude = 0.009
    label.data.bevel_depth = 0.004
    label.data.bevel_resolution = 2
    label.data.fill_mode = "BOTH"
    label.data.font = font
    tm.activate(label)
    bpy.ops.object.convert(target="MESH")
    label = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if not label.data.polygons or len(label.data.vertices) < 20:
        raise RuntimeError(f"Font did not produce a usable outline for glyph {glyph!r}: {GLYPH_FONT_PATH}")
    tm.set_material(label, EYE_IVORY)
    for polygon in label.data.polygons:
        polygon.use_smooth = False
    label["glyph_text"] = actual
    return label


def build_base(sculpt: tf.Sculpt, glyph: str) -> list:
    """Two-step turned plinth with a cinnabar seal; unchanged footprint and height."""
    props = [
        tm.prop_lathe("Thick lower chess base", [(1.035, 0.0), (1.068, 0.012), (1.08, 0.04), (1.08, 0.16), (1.066, 0.19), (1.045, 0.2)], PLINTH),
        tm.prop_lathe("Dark recessed base band", [(1.04, 0.19), (1.046, 0.2), (1.046, 0.245), (1.036, 0.256)], DEEP_BROWN),
        tm.prop_lathe(
            "Rounded upper chess base",
            [(0.975, 0.24), (0.984, 0.252), (0.984, 0.365), (0.972, 0.395), (0.945, 0.412), (0.9, BASE_TOP), (0.78, BASE_TOP), (0.62, BASE_TOP), (0.45, BASE_TOP), (0.28, BASE_TOP), (0.1, BASE_TOP)],
            TERRACOTTA,
        ),
    ]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.935, minor_radius=0.025, major_segments=72, minor_segments=8, location=(0, 0, 0.408))
    rim = bpy.context.object
    rim.name = "Soft upper base rim"
    props.append(tm._finish(rim, PORTRAIT))
    props.append(tm.prop_lathe(f"Front {glyph} faction medallion", [(0.19, -0.0275), (0.19, 0.017), (0.176, 0.0275)], CINNABAR, segments=40, center=(0.0, 0.225), rotation=(90, 0, 0)))
    props[-1].location = (0, -1.055, 0)
    tm.activate(props[-1])
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    props.append(add_glyph(glyph))
    # The plinth shades the clay standing on it.
    sculpt.occlude(sdf.cylinder((0, 0, 0.2), (0, 0, BASE_TOP), 0.985))
    return tagged("static", props)


def tagged(part: str, props: list) -> list:
    for obj in props:
        tm.set_part(obj, part)
    return props


def arm_rig(shoulder, elbow, wrist) -> dict:
    """Arm joints for the viewer's-right arm; the other side mirrors across X."""
    return {"shoulder": list(shoulder), "elbow": list(elbow), "wrist": list(wrist)}


def torso_radius(stations, z: float, angle: float, power: float, grow: float = 0.0):
    """Surface point of a lofted torso at height ``z`` and front angle ``angle``."""
    table = np.asarray(stations, dtype=np.float64)
    rx = float(np.interp(z, table[:, 0], table[:, 1])) + grow
    ry = float(np.interp(z, table[:, 0], table[:, 2])) + grow
    cy = float(np.interp(z, table[:, 0], table[:, 4])) if table.shape[1] > 4 else 0.0
    sx, sy = abs(math.sin(angle)), abs(math.cos(angle))
    radius = 1.0 / ((sx / rx) ** power + (sy / ry) ** power) ** (1.0 / power)
    return (radius * math.sin(angle), cy - radius * math.cos(angle), z)


def add_arm(sculpt: tf.Sculpt, cloth: sdf.Layer, shoulder, elbow, wrist, *, radii=(0.165, 0.15, 0.125), cuff_material=CINNABAR, cuff_name="cuffs", blend=0.05):
    """Short sleeve with a bent elbow, soft creases and a banded cuff."""
    sleeve = sculpt.scratch()
    sleeve.add(sdf.rcone(shoulder, elbow, radii[0], radii[1]))
    sleeve.add(sdf.rcone(elbow, wrist, radii[1], radii[2]), 0.04)
    sleeve.add(sdf.sphere(elbow, radii[1] * 1.03), 0.04)
    arm = tf.Frame(elbow, sdf.aim(sdf.vec(wrist) - sdf.vec(elbow)))
    sleeve.warp(tf.ring_warp(arm, pitch=0.075, depth=0.012, spread=0.11), np.minimum(shoulder, wrist) - 0.3, np.maximum(shoulder, wrist) + 0.3)
    cloth.blend(sleeve, blend)
    axis = sdf.unit(sdf.vec(wrist) - sdf.vec(elbow))
    cuff = sculpt.mass(cuff_name, cuff_material)
    cuff.add(sdf.cylinder(sdf.vec(wrist) - axis * 0.085, sdf.vec(wrist) - axis * 0.005, radii[2] + 0.022, 0.02))
    return axis


def add_shoulder_guard(sculpt: tf.Sculpt, shoulder, elbow, *, radius: float = 0.165, reach: float = 0.74, name: str = "guards") -> None:
    """Two overlapping armour tiers laid over the upper sleeve, edged in cinnabar."""
    a, b = sdf.vec(shoulder), sdf.vec(elbow)
    axis = sdf.unit(b - a)
    length = float(np.linalg.norm(b - a)) * reach
    arm = sculpt.scratch()
    arm.add(sdf.rcone(a, a + axis * length * 1.3, radius * 1.06, radius))
    arm.add(sdf.sphere(a, radius * 1.16), 0.03)

    def tier(start: float, stop: float, thickness: float):
        region = sdf.cylinder(a + axis * (length * start), a + axis * (length * stop), radius * 3.0, 0.012)
        return sculpt.shell(arm, thickness, region, 0.012)

    guards = sculpt.mass(name, LACQUER)
    guards.blend(tier(-1.5, 0.52, 0.066))
    guards.blend(tier(0.40, 1.0, 0.042))
    trim = sculpt.mass(name + "_trim", CINNABAR)
    trim.blend(tier(0.86, 1.025, 0.052))
    trim.blend(tier(0.42, 0.535, 0.076))


def robe_core(sculpt: tf.Sculpt, stations, power: float, *, hem: float, folds: int, fold_depth: float, fold_top: float, fold_full: float, hollow=None) -> sdf.Layer:
    """Lofted body whose skirt falls in broad folds to a level hem."""
    core = sculpt.scratch()
    core.add(sdf.loft((0, 0, 0), IDENTITY, stations, power, cap=0.02))
    core.warp(tf.fold_warp(tf.WORLD, count=folds, depth=fold_depth, z_top=fold_top, z_full=fold_full, floor=hem), (-0.9, -0.8, hem - 0.1), (0.9, 0.8, fold_top + 0.05))
    if hollow is not None:
        core.cut(sdf.ellipsoid(*hollow), 0.03)
    return core


def add_boots(sculpt: tf.Sculpt, x: float, *, size=(0.215, 0.285, 0.12), y: float = -0.10, toe_caps: bool = True) -> None:
    """Soft boots with fired-clay toe caps, standing on the plinth."""
    boots = sculpt.mass("boots", DEEP_BROWN, 0.7)
    for side in (-1.0, 1.0):
        turn = sdf.euler(0, 0, 7 * side)
        boot = sculpt.scratch()
        boot.add(sdf.ellipsoid((x * side, y, 0.50), size, turn))
        boot.add(sdf.rcone((x * side, y + 0.09, 0.50), (x * side, y + 0.085, 0.62), size[0] * 0.93, size[0] * 0.95), 0.05)
        boot.clip(tf.slab(BASE_TOP, 2.0), 0.02)
        boots.blend(boot)
        if toe_caps:
            cap = sdf.ellipsoid((x * side * 1.06, y - size[1] * 0.82, 0.53), (size[0] * 0.98, size[1] * 0.36, size[2]), turn)
            sculpt.mass("toes", TERRACOTTA, 0.7).blend(sculpt.shell(boot, 0.014, cap, 0.01))


def add_plate_studs(sculpt: tf.Sculpt, stations, power: float, *, rows, columns: int, grow: float, radius: float = 0.028, pair: float = 0.0, only=None) -> None:
    """Jade studs on lamellar plates; ``pair`` places two per plate, ``only`` limits the columns."""
    studs = sculpt.mass("studs", JADE, 6.0)
    step = 2 * math.pi / columns
    for row_z in rows:
        for column in range(columns):
            if only is not None and column not in only:
                continue
            for offset in ((-pair, pair) if pair else (0.0,)):
                centre = torso_radius(stations, row_z, column * step + offset, power, grow)
                studs.add(sdf.sphere(centre, radius))


def figure_head(sculpt: tf.Sculpt, centre, scale: float, style: dict | None = None) -> tf.Frame:
    head = tf.Frame(centre, IDENTITY, scale)
    tf.build_head(sculpt, head, HEAD_MATERIALS, style)
    return head


# --------------------------------------------------------------------------
# Roles
# --------------------------------------------------------------------------


def build_marshal(sculpt: tf.Sculpt) -> list:
    """Commander: twin-tailed crown, layered lamellar armour, hands on a jade-hilted sword."""
    world = tf.WORLD
    stations = [(0.56, 0.665, 0.445, 0.0, 0.03), (0.70, 0.70, 0.45, 0.0, 0.02), (1.05, 0.72, 0.46, 0.0, 0.01), (1.38, 0.68, 0.43, 0.0, 0.0), (1.66, 0.55, 0.36, 0.0, 0.0), (1.76, 0.44, 0.31, 0.0, 0.0), (1.9, 0.33, 0.26, 0.0, 0.0)]
    power = 2.3
    core = robe_core(sculpt, stations, power, hem=0.56, folds=10, fold_depth=0.022, fold_top=0.98, fold_full=0.66, hollow=((0, 0.03, 0.535), (0.57, 0.36, 0.07)))
    sculpt.mass("robe", TERRACOTTA, 0.7).blend(core)
    legs = sculpt.mass("legs", TERRACOTTA, 0.4)
    for side in (-1.0, 1.0):
        legs.add(sdf.rcone((0.27 * side, -0.02, 0.72), (0.27 * side, -0.03, 0.56), 0.24, 0.23))
    add_boots(sculpt, 0.27, size=(0.25, 0.31, 0.13))

    # Belt, cuirass and two rows of tassets laid over the robe.
    sculpt.mass("belt", DEEP_BROWN).blend(sculpt.shell(core, 0.03, tf.slab(0.985, 1.115), 0.012))
    sculpt.mass("belt_face", CINNABAR).blend(sculpt.shell(core, 0.046, tf.slab(1.022, 1.078), 0.008))
    columns = 9
    column = 2 * math.pi * 0.6 / columns
    cuirass = sculpt.shell(core, 0.05, tf.slab(1.125, 1.74), 0.02)
    cuirass.warp(tf.plate_warp(world, z0=1.125, row=0.295, column=column, radius=0.6, depth=0.028, shingle=0.012, groove=0.12, stagger=0.0), (-0.9, -0.8, 1.05), (0.9, 0.8, 1.72))
    sculpt.mass("cuirass", LACQUER, 1.2).blend(cuirass)
    tassets = sculpt.shell(core, 0.04, tf.slab(0.605, 0.978), 0.03)
    tassets.warp(tf.plate_warp(world, z0=0.605, row=0.1865, column=column, radius=0.6, depth=0.05, shingle=0.014, groove=0.1, stagger=0.5), (-0.9, -0.8, 0.5), (0.9, 0.8, 1.05))
    sculpt.mass("tassets", LACQUER, 1.1).blend(tassets)
    add_plate_studs(sculpt, stations, power, rows=(1.345, 1.64), columns=columns, grow=0.056, pair=0.2)
    sculpt.mass("collar", DEEP_BROWN).blend(sculpt.shell(core, 0.035, tf.slab(1.70, 1.9), 0.015))

    # Sleeves with banded cuffs; both hands rest on the sword grip.
    sleeves = sculpt.mass("sleeves", LACQUER)
    hands = sculpt.mass("hands", PORTRAIT, 2.2)
    for side in (1.0, -1.0):
        shoulder, elbow, wrist = (0.53 * side, -0.02, 1.49), (0.63 * side, -0.30, 1.25), (0.235 * side, -0.575, 1.38)
        forearm = add_arm(sculpt, sleeves, shoulder, elbow, wrist, radii=(0.19, 0.175, 0.14))
        add_shoulder_guard(sculpt, shoulder, elbow, radius=0.19)
        tf.build_fist(hands, (0.078 * side, -0.655, 1.415 + 0.055 * side), 0.135, (0, 0, 1), forearm, (0, 1, 0))

    sword = (0.0, -0.66)
    pommel = sculpt.mass("pommel", JADE, 3.0)
    pommel.add(sdf.sphere((sword[0], sword[1], 1.655), 0.088))
    pommel.add(sdf.cylinder((sword[0], sword[1], 1.30), (sword[0], sword[1], 1.62), 0.055, 0.01))
    guard = sculpt.mass("sword_guard", CINNABAR, 2.0)
    guard.add(sdf.box((sword[0], sword[1], 1.255), (0.225, 0.058, 0.038), IDENTITY, 0.03))
    sculpt.occlude(sdf.cylinder((sword[0], sword[1], BASE_TOP), (sword[0], sword[1], 1.26), 0.074))

    # Head: stern brows, moustache and goatee, hair knotted at the back.
    head = figure_head(sculpt, (0, -0.06, 2.35), 0.68, {"moustache": True, "goatee": True, "brow_tilt": 0.6})
    tf.build_topknot(sculpt, head, HEAD_MATERIALS, axis=(0.0, 1.0, 0.42), distance=1.03, radii=(0.28, 0.25, 0.27), ribbon=(0.0, 0.1, -0.52))
    # Qin crown: low cap, cinnabar band, two tall tails and a jade seal.
    crown = sculpt.mass("crown", LACQUER, 1.3)
    crown.add(sdf.cylinder((0, 0.01, 2.875), (0, 0.01, 3.0), 0.505, 0.03))
    crown.add(sdf.ellipsoid((0, 0.01, 2.98), (0.49, 0.49, 0.145)), 0.02)
    sculpt.mass("crown_band", CINNABAR, 1.5).add(sdf.cylinder((0, 0.01, 2.94), (0, 0.01, 2.992), 0.523, 0.016))
    tail_trim = sculpt.mass("crown_trim", CINNABAR, 2.0)
    for side in (-1.0, 1.0):
        outline = [(0.06 * side, 2.94), (0.40 * side, 2.94), (0.48 * side, 3.26), (0.38 * side, 3.42), (0.17 * side, 3.45), (0.08 * side, 3.22)]
        tail = sculpt.scratch().add(tf.prism(world, outline, -0.04, 0.08, 0.028))
        crown.blend(tail)
        inset = [(0.115 * side, 3.0), (0.355 * side, 3.0), (0.41 * side, 3.24), (0.335 * side, 3.355), (0.205 * side, 3.375), (0.135 * side, 3.21)]
        tail_trim.blend(sculpt.shell(tail, 0.012, tf.prism(world, inset, -0.3, 0.02, 0.012)))
    seal = sculpt.mass("crown_seal", JADE, 4.0)
    seal.add(sdf.ellipsoid((0, -0.508, 2.96), (0.1, 0.045, 0.1)))
    sculpt.mass("crown_seal_rim", CINNABAR, 4.0).add(sdf.torus((0, -0.512, 2.96), 0.108, 0.017, sdf.euler(90, 0, 0)))
    sculpt.parts.update({name: "head" for name in ("crown", "crown_band", "crown_trim", "crown_seal", "crown_seal_rim")})
    sculpt.parts.update({"pommel": "weapon", "sword_guard": "weapon"})
    sculpt.rig = {
        "spine": [0.75, 1.05, 1.4, 1.75],
        "head": [0, -0.06, 2.35],
        "arm": arm_rig((0.53, -0.02, 1.49), (0.63, -0.30, 1.25), (0.235, -0.575, 1.38)),
        "weapon": [[sword[0], sword[1], 1.3], [sword[0], sword[1], BASE_TOP]],
    }
    return tagged("weapon", [
        tm.prop_cylinder("Short sword scabbard", (sword[0], sword[1], BASE_TOP - 0.01), (sword[0], sword[1], 1.26), 0.074, DEEP_BROWN, sides=20),
        tm.prop_cylinder("Scabbard chape", (sword[0], sword[1], BASE_TOP - 0.01), (sword[0], sword[1], 0.55), 0.082, CINNABAR, sides=20),
        tm.prop_cylinder("Scabbard locket", (sword[0], sword[1], 1.12), (sword[0], sword[1], 1.22), 0.082, CINNABAR, sides=20),
    ])


def build_advisor(sculpt: tf.Sculpt) -> list:
    """Court officer: winged cap, floor-length robe with crossed lapels, bamboo slips in both hands."""
    world = tf.WORLD
    stations = [(0.44, 0.60, 0.425, 0.0, 0.03), (0.60, 0.585, 0.41, 0.0, 0.025), (0.84, 0.58, 0.39, 0.0, 0.01), (1.30, 0.46, 0.34, 0.0, 0.0), (1.55, 0.37, 0.28, 0.0, 0.0), (1.66, 0.29, 0.24, 0.0, 0.0)]
    power = 2.3
    core = robe_core(sculpt, stations, power, hem=0.44, folds=11, fold_depth=0.024, fold_top=0.84, fold_full=0.52)
    sculpt.mass("robe", LACQUER, 0.8).blend(core)
    shoes = sculpt.mass("shoes", DEEP_BROWN, 0.8)
    for side in (-1.0, 1.0):
        tip = sculpt.scratch().add(sdf.ellipsoid((0.23 * side, -0.385, 0.47), (0.175, 0.15, 0.075), sdf.euler(0, 0, 8 * side)))
        tip.clip(tf.slab(BASE_TOP, 2.0), 0.02)
        shoes.blend(tip)

    # Sash with jade clasps, a cinnabar hem and the crossed collar of a Qin robe.
    sculpt.mass("sash", CINNABAR).blend(sculpt.shell(core, 0.024, tf.slab(0.83, 0.93), 0.012))
    clasps = sculpt.mass("clasps", JADE, 5.0)
    for angle in (-0.5, 0.5):
        clasps.add(sdf.ellipsoid(torso_radius(stations, 0.88, angle, power, 0.03), (0.058, 0.05, 0.058)))
    sculpt.mass("hem", CINNABAR).blend(sculpt.shell(core, 0.016, tf.slab(0.44, 0.505), 0.008))
    lapels = sculpt.mass("lapels", CINNABAR, 1.6)
    lapels.blend(sculpt.shell(core, 0.022, tf.path_region(world, [(0.25, 1.6), (0.02, 1.3), (-0.17, 0.96)], 0.042), 0.01))
    lapels.blend(sculpt.shell(core, 0.022, tf.path_region(world, [(-0.25, 1.6), (-0.06, 1.37)], 0.042), 0.01))
    sculpt.mass("collar", DEEP_BROWN).blend(sculpt.shell(core, 0.034, tf.slab(1.52, 1.68), 0.015))

    # Wide court sleeves meet at the chest around a bundle of bamboo slips.
    sleeves = sculpt.mass("sleeves", LACQUER)
    hands = sculpt.mass("hands", PORTRAIT, 2.2)
    slips_y = -0.645
    for side in (1.0, -1.0):
        shoulder, elbow, wrist = (0.42 * side, 0.0, 1.40), (0.585 * side, -0.17, 1.12), (0.275 * side, -0.50, 1.2)
        forearm = add_arm(sculpt, sleeves, shoulder, elbow, wrist, radii=(0.165, 0.17, 0.17))
        pouch = sculpt.scratch().add(sdf.ellipsoid((0.40 * side, -0.37, 1.02), (0.17, 0.2, 0.2), sdf.euler(0, 0, -35 * side)))
        sleeves.blend(pouch, 0.07)
        tf.build_fist(hands, (0.19 * side, slips_y + 0.03, 1.2), 0.125, (0, 0, 1), forearm, (0, 1, 0))
    slips = sculpt.mass("slips", TERRACOTTA, 1.5)
    bundle = sculpt.scratch().add(sdf.box((0, slips_y, 1.31), (0.24, 0.042, 0.36), IDENTITY, 0.03))
    for index in range(4):
        x = -0.144 + index * 0.096
        bundle.cut(sdf.capsule((x, slips_y - 0.055, 0.9), (x, slips_y - 0.055, 1.72), 0.018), 0.012)
        bundle.cut(sdf.capsule((x, slips_y + 0.055, 0.9), (x, slips_y + 0.055, 1.72), 0.018), 0.012)
    slips.blend(bundle)
    cords = sculpt.mass("slip_cords", CINNABAR, 3.0)
    for z in (1.47, 1.08):
        cords.blend(sculpt.shell(bundle, 0.012, tf.slab(z - 0.022, z + 0.022), 0.006))

    head = figure_head(sculpt, (0, -0.03, 2.08), 0.55, {"moustache": True, "brow_tilt": -0.25})
    del head
    # Official cap: banded crown with a raised back and two level wings.
    cap = sculpt.mass("cap", LACQUER, 1.3)
    cap.add(sdf.cylinder((0, 0.0, 2.515), (0, 0.0, 2.66), 0.445, 0.03))
    cap.add(sdf.ellipsoid((0, 0.0, 2.64), (0.43, 0.43, 0.1)), 0.02)
    cap.add(sdf.box((0, 0.1, 2.74), (0.27, 0.2, 0.12), IDENTITY, 0.06), 0.03)
    for side in (-1.0, 1.0):
        cap.add(sdf.box((0.585 * side, 0.03, 2.59), (0.25, 0.085, 0.07), sdf.euler(0, -6 * side, 7 * side), 0.055), 0.02)
    sculpt.mass("cap_band", CINNABAR, 1.5).add(sdf.cylinder((0, 0.0, 2.56), (0, 0.0, 2.61), 0.462, 0.016))
    sculpt.mass("cap_seal", JADE, 4.0).add(sdf.ellipsoid((0, -0.44, 2.6), (0.08, 0.04, 0.08)))
    sculpt.parts.update({"cap": "head", "cap_band": "head", "cap_seal": "head", "slips": "weapon", "slip_cords": "weapon"})
    sculpt.rig = {
        "spine": [0.7, 0.9, 1.25, 1.55],
        "head": [0, -0.03, 2.08],
        "arm": arm_rig((0.42, 0.0, 1.40), (0.585, -0.17, 1.12), (0.275, -0.50, 1.2)),
        "weapon": [[0, slips_y, 0.95], [0, slips_y, 1.67]],
    }
    return []


def build_soldier(sculpt: tf.Sculpt) -> list:
    """Spearman: topknot with a red tie, lamellar vest, tassets and a tall spear."""
    world = tf.WORLD
    stations = [(0.60, 0.545, 0.405, 0.0, 0.02), (0.74, 0.555, 0.40, 0.0, 0.015), (0.88, 0.555, 0.39, 0.0, 0.01), (1.28, 0.51, 0.36, 0.0, 0.0), (1.50, 0.40, 0.295, 0.0, 0.0), (1.62, 0.30, 0.24, 0.0, 0.0)]
    power = 2.3
    core = robe_core(sculpt, stations, power, hem=0.60, folds=9, fold_depth=0.02, fold_top=0.84, fold_full=0.66, hollow=((0, 0.02, 0.575), (0.46, 0.32, 0.07)))
    sculpt.mass("tunic", TERRACOTTA, 0.7).blend(core)
    legs = sculpt.mass("legs", TERRACOTTA, 0.4)
    for side in (-1.0, 1.0):
        legs.add(sdf.rcone((0.245 * side, -0.02, 0.74), (0.25 * side, -0.03, 0.58), 0.215, 0.2))
    add_boots(sculpt, 0.255)

    # Sash, lamellar vest and tassets are laid over the tunic like real kit.
    sculpt.mass("sash", CINNABAR).blend(sculpt.shell(core, 0.024, tf.slab(0.845, 0.935), 0.012))
    columns = 9
    column = 2 * math.pi * 0.5 / columns
    cuirass = sculpt.shell(core, 0.042, tf.slab(0.955, 1.56), 0.02)
    cuirass.warp(tf.plate_warp(world, z0=0.955, row=0.2675, column=column, radius=0.5, depth=0.024, shingle=0.012, groove=0.13, stagger=0.0), (-0.8, -0.7, 0.9), (0.8, 0.7, 1.49))
    sculpt.mass("vest", LACQUER, 1.2).blend(cuirass)
    tassets = sculpt.shell(core, 0.036, tf.slab(0.665, 0.838), 0.03)
    tassets.warp(tf.plate_warp(world, z0=0.665, row=0.6, column=column, radius=0.5, depth=0.05, groove=0.1, stagger=0.0), (-0.8, -0.7, 0.6), (0.8, 0.7, 0.9))
    sculpt.mass("tassets", LACQUER, 1.1).blend(tassets)
    add_plate_studs(sculpt, stations, power, rows=(1.09, 1.355), columns=columns, grow=0.047, radius=0.034, only=(0, 1, 8))
    sculpt.mass("studs").add(sdf.ellipsoid(torso_radius(stations, 1.222, 0.0, power, 0.05), (0.06, 0.045, 0.06)))

    # Arms: the right hand (viewer's right) grips the spear, the other rests at the hip.
    spear = (0.62, -0.27)
    sleeves = sculpt.mass("sleeves", LACQUER)
    hands = sculpt.mass("hands", PORTRAIT, 2.2)
    forearm = add_arm(sculpt, sleeves, (0.44, -0.02, 1.40), (0.66, 0.02, 1.13), (0.635, -0.14, 1.24))
    tf.build_fist(hands, (spear[0], spear[1], 1.26), 0.135, (0, 0, 1), forearm, (-1, 0, 0))
    rest = add_arm(sculpt, sleeves, (-0.44, -0.02, 1.40), (-0.63, 0.0, 1.12), (-0.60, -0.13, 0.94))
    tf.build_mitten(hands, np.array((-0.60, -0.13, 0.94)) + rest * 0.02, rest, (1, 0, 0), (0, -1, 0), 0.118)
    for side, elbow in ((1.0, (0.66, 0.02, 1.13)), (-1.0, (-0.63, 0.0, 1.12))):
        add_shoulder_guard(sculpt, (0.44 * side, -0.02, 1.40), elbow)

    # Rolled collar, then the head with its tied topknot.
    collar = sculpt.mass("collar", CINNABAR)
    collar.add(sdf.torus((0, 0.0, 1.565), 0.285, 0.062, sdf.euler(10, 0, 0), squash=1.2))
    collar.add(sdf.rcone((0.10, -0.275, 1.56), (-0.05, -0.33, 1.47), 0.06, 0.05), 0.03)
    head = figure_head(sculpt, (0, -0.03, 2.08), 0.55, {"moustache": False})
    tf.build_topknot(sculpt, head, HEAD_MATERIALS)

    # Spear with a leaf blade and a red tassel.
    tassel = sculpt.mass("tassel", CINNABAR, 1.5)
    tassel.add(sdf.ellipsoid((spear[0], spear[1], 3.03), (0.095, 0.095, 0.12)))
    tassel.warp(tf.fold_warp(tf.Frame((spear[0], spear[1], 0)), count=10, depth=0.012, z_top=3.2, z_full=3.0), (spear[0] - 0.2, spear[1] - 0.2, 2.85), (spear[0] + 0.2, spear[1] + 0.2, 3.2))
    sculpt.occlude(sdf.cylinder((spear[0], spear[1], BASE_TOP), (spear[0], spear[1], 3.1), 0.036))
    sculpt.parts["tassel"] = "weapon"
    sculpt.rig = {
        "spine": [0.75, 0.95, 1.25, 1.55],
        "head": [0, -0.03, 2.08],
        "arm": arm_rig((0.44, -0.02, 1.40), (0.66, 0.02, 1.13), (0.635, -0.14, 1.24)),
        "weapon": [[spear[0], spear[1], BASE_TOP], [spear[0], spear[1], 3.45]],
    }
    return tagged("weapon", [
        tm.prop_cylinder("Soldier tall spear shaft", (spear[0], spear[1], BASE_TOP - 0.01), (spear[0], spear[1], 3.14), 0.036, DEEP_BROWN, sides=14),
        tm.prop_cylinder("Soldier spear socket", (spear[0], spear[1], 3.10), (spear[0], spear[1], 3.19), 0.05, EYE_IVORY, radius_end=0.04, sides=14),
        tm.prop_lathe("Soldier spear point", [(0.04, 3.18), (0.092, 3.25), (0.06, 3.36), (0.012, 3.45)], EYE_IVORY, segments=16, center=spear),
    ])


BUST_STATIONS = [(-0.25, 0.555, 0.39, 0.0, 0.01), (0.0, 0.555, 0.39, 0.0, 0.01), (0.38, 0.51, 0.36, 0.0, 0.0), (0.60, 0.40, 0.295, 0.0, 0.0), (0.72, 0.30, 0.24, 0.0, 0.0)]


def add_bust(sculpt: tf.Sculpt, head_centre, head_scale: float, arms, *, style: dict | None = None, bottom: float = -0.25, studs: bool = True, belt: bool = True) -> tf.Frame:
    """Armoured half-figure for drivers, riders and crews, sized from its head.

    ``arms`` maps a side (+1 / -1) to ``(elbow, wrist, fist centre, shaft axis, palm)``
    in world space; a missing side keeps that arm out of the sculpt.
    """
    k = head_scale / 0.55
    origin = (head_centre[0], head_centre[1] + 0.03 * k, head_centre[2] - 1.18 * k)
    f = tf.Frame(origin, IDENTITY, k)
    stations = [(z, *rest) for z, *rest in BUST_STATIONS if z > bottom] 
    stations.insert(0, (bottom, 0.555, 0.39, 0.0, 0.01))
    scaled = [(f.o[2] + z * k, rx * k, ry * k, f.o[0] + cx * k, f.o[1] + cy * k) for z, rx, ry, cx, cy in stations]
    power = 2.3
    core = sculpt.scratch().add(sdf.loft((0, 0, 0), IDENTITY, scaled, power, cap=0.02 * k))
    sculpt.mass("crew_tunic", LACQUER, 0.8).blend(core)
    vest = sculpt.shell(core, 0.042 * k, tf.slab(f.o[2] + 0.06 * k, f.o[2] + 0.66 * k), 0.02 * k)
    column = 2 * math.pi * 0.5 / 9
    vest.warp(tf.plate_warp(f, z0=0.06, row=0.2675, column=column, radius=0.5, depth=0.024, shingle=0.012, groove=0.13, stagger=0.0), *f.box((-0.8, -0.7, 0.0), (0.8, 0.7, 0.6)))
    sculpt.mass("crew_vest", LACQUER, 1.1).blend(vest)
    if belt:
        sculpt.mass("crew_belt", CINNABAR).blend(sculpt.shell(core, 0.024 * k, tf.slab(f.o[2] - 0.05 * k, f.o[2] + 0.045 * k), 0.012 * k))
    if studs:
        jade = sculpt.mass("crew_studs", JADE, 6.0)
        local = [(z - f.o[2], rx, ry, cx - f.o[0], cy - f.o[1]) for z, rx, ry, cx, cy in scaled]
        for row_z in (0.195, 0.46):
            for column_index in (-1, 0, 1):
                x, y, z = torso_radius(local, row_z * k, column_index * column / 0.5, power, 0.047 * k)
                jade.add(sdf.sphere((f.o[0] + x, f.o[1] + y, f.o[2] + z), 0.034 * k))
    collar = sculpt.mass("collar", CINNABAR)
    collar.add(sdf.torus(f.p(0, 0.0, 0.665), 0.285 * k, 0.062 * k, sdf.euler(10, 0, 0), squash=1.2))
    sleeves = sculpt.mass("sleeves", LACQUER)
    hands = sculpt.mass("hands", PORTRAIT, 2.2)
    for side, (elbow, wrist, fist, shaft, palm) in arms.items():
        shoulder = f.p(0.44 * side, -0.02, 0.50)
        forearm = add_arm(sculpt, sleeves, shoulder, elbow, wrist, radii=(0.165 * k, 0.15 * k, 0.125 * k), blend=0.05 * k)
        add_shoulder_guard(sculpt, shoulder, elbow, radius=0.165 * k)
        tf.build_fist(hands, fist, 0.135 * k, shaft, forearm, palm)
    return figure_head(sculpt, head_centre, head_scale, style)


def add_helmet_band(sculpt: tf.Sculpt, head: tf.Frame, *, height: float = 0.78, seal: bool = True) -> None:
    """Low lacquer cap with a cinnabar band, set on the crown of the head."""
    cap = sculpt.mass("helmet", LACQUER, 1.2)
    cap.add(sdf.cylinder(head.p(0, 0.05, height - 0.08), head.p(0, 0.05, height + 0.2), head.l(0.76), head.l(0.06)))
    cap.add(sdf.ellipsoid(head.p(0, 0.05, height + 0.16), head.radii(0.74, 0.74, 0.2)), head.l(0.04))
    sculpt.mass("helmet_band", CINNABAR, 1.5).add(sdf.cylinder(head.p(0, 0.05, height + 0.0), head.p(0, 0.05, height + 0.1), head.l(0.795), head.l(0.03)))
    if seal:
        sculpt.mass("helmet_seal", JADE, 4.0).add(sdf.ellipsoid(head.p(0, -0.745, height + 0.06), head.radii(0.15, 0.075, 0.15)))


def build_chariot(sculpt: tf.Sculpt) -> list:
    """Command chariot: spoked wheels, shielded cart, twin standards and a driver at the reins."""
    wheel_radius = 0.5
    wheel_z = BASE_TOP + wheel_radius
    sculpt.mass("cart_floor", TERRACOTTA, 0.6).add(sdf.box((0, 0.10, 0.78), (0.62, 0.52, 0.105), IDENTITY, 0.03))
    cart = sculpt.mass("cart", LACQUER, 1.0)
    rails = sculpt.mass("cart_rails", CINNABAR, 1.3)
    shield = sculpt.scratch().add(sdf.box((0, -0.47, 1.0), (0.66, 0.085, 0.30), IDENTITY, 0.06))
    for x in (-0.22, 0.22):
        shield.cut(sdf.capsule((x, -0.57, 0.6), (x, -0.57, 1.4), 0.02), 0.015)
    cart.blend(shield)
    rails.blend(sculpt.shell(shield, 0.014, tf.slab(1.2, 1.275), 0.006))
    rails.blend(sculpt.shell(shield, 0.014, tf.slab(0.73, 0.79), 0.006))
    for side in (-1.0, 1.0):
        wall = sculpt.scratch().add(sdf.box((0.61 * side, 0.12, 0.98), (0.055, 0.5, 0.19), IDENTITY, 0.04))
        cart.blend(wall)
        rails.blend(sculpt.shell(wall, 0.014, tf.slab(1.105, 1.165), 0.006))
    back = sculpt.scratch().add(sdf.box((0, 0.62, 0.93), (0.6, 0.05, 0.14), IDENTITY, 0.04))
    cart.blend(back)
    studs = sculpt.mass("studs", JADE, 6.0)
    for x in (-0.44, 0.0, 0.44):
        studs.add(sdf.sphere((x, -0.56, 1.0), 0.04))

    # Driver with both hands on the reins above the shield.
    arms = {side: ((0.40 * side, -0.22, 1.16), (0.25 * side, -0.40, 1.30), (0.24 * side, -0.475, 1.375), (1, 0, 0), (0, 0, -1)) for side in (1.0, -1.0)}
    head = add_bust(sculpt, (0, -0.02, 1.82), 0.42, arms, style={"moustache": False}, bottom=-0.5)
    add_helmet_band(sculpt, head)
    tf.build_topknot(sculpt, head, HEAD_MATERIALS, distance=1.25, radii=(0.22, 0.2, 0.3), tie=False)
    reins = sculpt.mass("reins", EYE_IVORY, 2.5)
    for side in (-1.0, 1.0):
        reins.add(sdf.tube(sdf.spline([(0.24 * side, -0.50, 1.37), (0.27 * side, -0.72, 1.27), (0.30 * side, -1.0, 0.86), (0.31 * side, -1.17, 0.67)], 5), 0.021), 0.01)
    reins.add(sdf.capsule((-0.24, -0.475, 1.375), (0.24, -0.475, 1.375), 0.021), 0.01)

    # Twin command standards with swallow-tailed pennants.
    pennants = sculpt.mass("pennants", CINNABAR, 1.6)
    props = []
    for side in (-1.0, 1.0):
        pole = (0.50 * side, 0.44)
        pennants.add(tf.pennant((pole[0] + 0.02 * side, pole[1], 2.38), 0.31, 0.36, 0.04, side=side))
        props.append(tm.prop_cylinder("Chariot command standard", (pole[0], pole[1], 0.88), (pole[0], pole[1], 2.42), 0.03, DEEP_BROWN, sides=12))
        props.append(tm.prop_cylinder("Chariot standard finial", (pole[0], pole[1], 2.40), (pole[0], pole[1], 2.54), 0.065, EYE_IVORY, radius_end=0.008, sides=12))
        sculpt.occlude(sdf.cylinder((pole[0], pole[1], 0.88), (pole[0], pole[1], 2.42), 0.03))
        props.append(tm.prop_cylinder("Chariot forward yoke", (0.34 * side, -0.50, 0.80), (0.25 * side, -1.19, 0.64), 0.038, TERRACOTTA, sides=12))
        centre = (0.75 * side, 0.08, wheel_z)
        props += tm.prop_wheel(f"Chariot wheel {'right' if side > 0 else 'left'}", centre, wheel_radius, DEEP_BROWN, TERRACOTTA, JADE)
        sculpt.occlude(sdf.cylinder((centre[0] - 0.06, centre[1], centre[2]), (centre[0] + 0.06, centre[1], centre[2]), wheel_radius))
    props.append(tm.prop_cylinder("Chariot axle", (-0.72, 0.08, wheel_z), (0.72, 0.08, wheel_z), 0.05, DEEP_BROWN, sides=12))
    props.append(tm.prop_cylinder("Chariot yoke crossbar", (-0.37, -1.18, 0.64), (0.37, -1.18, 0.64), 0.045, JADE, sides=14, bevel=0.012))
    sculpt.parts.update({name: "mount" for name in ("cart_floor", "cart", "cart_rails", "studs", "pennants", "reins")})
    sculpt.parts.update({name: "head" for name in ("helmet", "helmet_band", "helmet_seal")})
    sculpt.rig = {
        "spine": [0.9, 1.05, 1.3, 1.42],
        "head": [0, -0.02, 1.82],
        "arm": arm_rig((0.336, -0.005, 1.30), (0.40, -0.22, 1.16), (0.25, -0.40, 1.30)),
        "weapon": [[0.24, -0.475, 1.375], [0.3, -1.17, 0.67]],
        "mount": [[0, 0.08, wheel_z], [0, -1.2, 0.7]],
    }
    return tagged("mount", props)


def build_horse(sculpt: tf.Sculpt) -> list:
    """Cavalry: a stocky war horse in lamellar barding carrying a helmeted rider."""
    body = sculpt.scratch()
    body.add(sdf.ellipsoid((0, 0.13, 1.14), (0.70, 0.54, 0.48)))
    body.add(sdf.ellipsoid((0, -0.2, 1.17), (0.52, 0.36, 0.43)), 0.12)
    body.add(sdf.ellipsoid((0, 0.44, 1.16), (0.60, 0.36, 0.44)), 0.1)
    hide = sculpt.mass("hide", TERRACOTTA, 0.8)
    hide.blend(body)
    hide.add(sdf.rcone((0, -0.14, 1.38), (0, -0.52, 1.78), 0.30, 0.25), 0.1)
    legs = sculpt.mass("horse_legs", DEEP_BROWN, 0.7)
    hooves = sculpt.mass("hooves", TERRACOTTA, 0.7)
    for side in (-1.0, 1.0):
        for y in (-0.2, 0.37):
            legs.add(sdf.rcone((0.45 * side, y, 1.0), (0.47 * side, y - 0.01, 0.56), 0.15, 0.125))
            hoof = sculpt.scratch().add(sdf.ellipsoid((0.47 * side, y - 0.035, 0.49), (0.165, 0.195, 0.11)))
            hoof.clip(tf.slab(BASE_TOP, 2.0), 0.02)
            hooves.blend(hoof)

    # Head: broad forehead, soft muzzle, alert ears and the same glazed eyes as the riders.
    head = tf.Frame((0, -0.70, 1.84), IDENTITY, 0.39)
    skull = sculpt.scratch()
    skull.add(sdf.ellipsoid(head.p(0, 0, 0), head.radii(0.95, 1.02, 1.0)))
    skull.add(sdf.ellipsoid(head.p(0, -0.82, -0.36), head.radii(0.70, 0.60, 0.55)), head.l(0.25))
    skull.cut(sdf.ellipsoid(head.p(0.2, -1.36, -0.34), head.radii(0.075, 0.06, 0.05)), head.l(0.04))
    skull.cut(sdf.ellipsoid(head.p(-0.2, -1.36, -0.34), head.radii(0.075, 0.06, 0.05)), head.l(0.04))
    face = sculpt.mass("horse_head", PORTRAIT, 2.2)
    face.blend(skull)
    for side in (-1.0, 1.0):
        tf.add_eye(sculpt, head, HEAD_MATERIALS, (0.45, -0.80, 0.30), (0.25, 0.10, 0.24), side, prefix="mount_")
        ear = sculpt.scratch().add(sdf.rcone(head.p(0.46, 0.28, 0.72, side), head.p(0.60, 0.34, 1.36, side), head.l(0.22), head.l(0.07)))
        ear.cut(sdf.rcone(head.p(0.46, 0.12, 0.80, side), head.p(0.585, 0.22, 1.28, side), head.l(0.11), head.l(0.035)), head.l(0.03))
        hide.blend(ear, head.l(0.08))
    mouth = [(0.36 * t, -0.56 + 0.04 * t * t) for t in (-1.0, -0.5, 0.0, 0.5, 1.0)]
    sculpt.mass("mount_mouth", INK, 6.0).blend(sculpt.shell(skull, head.l(0.006), tf.path_region(head, mouth, 0.03, y0=-1.8, y1=-0.9)))
    brow_plate = sculpt.shell(skull, head.l(0.07), sdf.ellipsoid(head.p(0, -0.9, 0.72), head.radii(0.36, 0.5, 0.36)), head.l(0.03))
    sculpt.mass("chamfron", LACQUER, 1.5).blend(brow_plate)
    sculpt.mass("chamfron_seal", JADE, 5.0).add(sdf.ellipsoid(head.p(0, -0.815, 0.74), head.radii(0.12, 0.07, 0.12)))
    bridle = sculpt.mass("bridle", CINNABAR, 1.6)
    bridle.blend(sculpt.shell(skull, head.l(0.05), sdf.box(head.p(0, -1.02, -0.3), head.radii(1.2, 0.07, 1.2)), head.l(0.02)))
    bridle.blend(sculpt.shell(skull, head.l(0.05), sdf.box(head.p(0, -0.3, 0.32), head.radii(1.2, 0.075, 0.9), sdf.euler(-52, 0, 0)), head.l(0.02)))
    mane = sculpt.mass("mane", DEEP_BROWN, 1.0)
    mane.add(sdf.tube(sdf.spline([(0, -0.62, 2.22), (0, -0.36, 2.1), (0, -0.16, 1.82), (0, 0.0, 1.56)], 4), 0.1), 0.05)
    mane.add(sdf.ellipsoid((0, -0.80, 2.2), (0.13, 0.16, 0.11), sdf.euler(-25, 0, 0)), 0.04)
    mane.warp(tf.ring_warp(tf.WORLD, pitch=0.11, depth=0.022), (-0.3, -1.0, 1.4), (0.3, 0.2, 2.4))
    tail = sculpt.mass("tail", DEEP_BROWN, 0.9)
    tail.add(sdf.tube(sdf.spline([(0, 0.66, 1.34), (0, 0.86, 1.2), (0, 0.9, 0.95), (0, 0.86, 0.72)], 4), [0.11] * 5 + [0.105] * 4 + [0.09, 0.08, 0.07, 0.06]), 0.04)

    # Barding: a lamellar caparison over the back, edged in cinnabar.
    trunk = tf.Frame((0, 0.13, 1.14), sdf.aim((0, 1, 0)))
    drape = sdf.box((0, 0.13, 1.66), (0.95, 0.43, 0.6))
    barding = sculpt.shell(body, 0.045, drape, 0.03)
    barding.warp(tf.plate_warp(trunk, z0=-0.43, row=0.2867, column=0.31, radius=0.55, depth=0.026, groove=0.12, stagger=0.5), (-0.9, -0.4, 1.0), (0.9, 0.7, 1.75))
    sculpt.mass("barding", LACQUER, 1.1).blend(barding)
    trim = sculpt.mass("barding_trim", CINNABAR, 1.3)
    trim.blend(sculpt.shell(body, 0.056, sdf.box((0, 0.13, 1.09), (0.95, 0.44, 0.032)), 0.01))
    trim.blend(sculpt.shell(body, 0.056, sdf.box((0, -0.285, 1.66), (0.95, 0.03, 0.6)), 0.01))
    trim.blend(sculpt.shell(body, 0.056, sdf.box((0, 0.545, 1.66), (0.95, 0.03, 0.6)), 0.01))
    studs = sculpt.mass("studs", JADE, 6.0)
    for side in (-1.0, 1.0):
        for y in (-0.14, 0.13, 0.4):
            studs.add(sdf.sphere((0.735 * side * (1 - 0.35 * abs(y - 0.13)), y, 1.2), 0.036))

    # Rider: seated in the saddle with both hands on the reins.
    arms = {side: ((0.37 * side, -0.32, 2.0), (0.24 * side, -0.48, 2.06), (0.215 * side, -0.56, 2.09), (1, 0, 0), (0, 0, -1)) for side in (1.0, -1.0)}
    rider = add_bust(sculpt, (0, -0.16, 2.65), 0.40, arms, style={"moustache": False}, bottom=-0.42)
    add_helmet_band(sculpt, rider, height=0.72)
    crest = sculpt.mass("helmet_crest", CINNABAR, 1.5)
    crest.add(sdf.ellipsoid(rider.p(0, 0.1, 1.07), rider.radii(0.12, 0.3, 0.14)))
    thighs = sculpt.mass("crew_tunic")
    boots = sculpt.mass("boots", DEEP_BROWN, 0.7)
    for side in (-1.0, 1.0):
        thighs.add(sdf.rcone((0.2 * side, -0.12, 1.72), (0.55 * side, -0.2, 1.5), 0.135, 0.11), 0.05)
        boots.add(sdf.ellipsoid((0.63 * side, -0.25, 1.36), (0.1, 0.155, 0.165), sdf.euler(8, 14 * side, 0)))
    reins = sculpt.mass("reins", CINNABAR, 2.5)
    for side in (-1.0, 1.0):
        reins.add(sdf.tube(sdf.spline([(0.215 * side, -0.58, 2.08), (0.34 * side, -0.76, 1.98), (0.33 * side, -0.98, 1.78), (0.27 * side, -1.1, 1.72)], 5), 0.022), 0.01)
    mount = ("hide", "horse_legs", "hooves", "horse_head", "mount_eye_white", "mount_iris", "mount_pupil", "mount_sparkle", "mount_lash", "mount_mouth")
    mount += ("chamfron", "chamfron_seal", "bridle", "mane", "tail", "barding", "barding_trim", "studs", "reins")
    sculpt.parts.update({name: "mount" for name in mount})
    sculpt.parts.update({name: "head" for name in ("helmet", "helmet_band", "helmet_seal", "helmet_crest")})
    sculpt.rig = {
        "spine": [1.7, 1.85, 2.05, 2.3],
        "head": [0, -0.16, 2.65],
        "arm": arm_rig((0.32, -0.15, 2.16), (0.37, -0.32, 2.0), (0.24, -0.48, 2.06)),
        "weapon": [[0.215, -0.56, 2.09], [0.27, -1.1, 1.72]],
        "mount": [[0, 0.13, 1.0], [0, -0.9, 1.6]],
    }
    return []


def build_elephant(sculpt: tf.Sculpt) -> list:
    """War elephant: curled trunk, ivory tusks, lamellar blanket and a command tower."""
    body = sculpt.scratch()
    body.add(sdf.ellipsoid((0, 0.12, 1.14), (0.76, 0.68, 0.58)))
    body.add(sdf.ellipsoid((0, 0.5, 1.1), (0.66, 0.4, 0.5)), 0.12)
    hide = sculpt.mass("hide", TERRACOTTA, 0.8)
    hide.blend(body)
    feet = sculpt.mass("feet", DEEP_BROWN, 0.7)
    nails = sculpt.mass("toenails", EYE_IVORY, 4.0)
    for side in (-1.0, 1.0):
        for y in (-0.3, 0.4):
            hide.add(sdf.rcone((0.5 * side, y, 1.0), (0.52 * side, y, 0.6), 0.21, 0.2), 0.08)
            foot = sculpt.scratch().add(sdf.ellipsoid((0.52 * side, y - 0.03, 0.5), (0.235, 0.26, 0.125)))
            foot.clip(tf.slab(BASE_TOP, 2.0), 0.02)
            feet.blend(foot)
            for toe in (-1, 0, 1):
                nails.add(sdf.ellipsoid((0.52 * side + toe * 0.12, y - 0.265 + 0.035 * abs(toe), 0.475), (0.05, 0.035, 0.05)))
    hide.add(sdf.tube(sdf.spline([(0, 0.78, 1.3), (0, 0.93, 1.16), (0, 0.96, 0.98)], 4), 0.05), 0.04)
    sculpt.mass("tail_tuft", DEEP_BROWN, 1.5).add(sdf.ellipsoid((0, 0.965, 0.9), (0.065, 0.065, 0.11)))

    # Head with domed brow, fan ears, curled trunk and tusks.
    head = tf.Frame((0, -0.60, 1.47), IDENTITY, 0.54)
    skull = sculpt.scratch()
    skull.add(sdf.ellipsoid(head.p(0, 0, 0), head.radii(1.07, 0.93, 1.0)))
    for side in (-1.0, 1.0):
        skull.add(sdf.sphere(head.p(0.36, -0.2, 0.62, side), head.l(0.42)), head.l(0.28))
        skull.add(sdf.ellipsoid(head.p(0.5, -0.52, -0.4, side), head.radii(0.33, 0.3, 0.3)), head.l(0.25))
    trunk_path = sdf.spline([(0, -0.98, 1.38), (0, -1.1, 1.12), (0.05, -1.11, 0.88), (0.16, -1.05, 0.73), (0.27, -0.95, 0.76), (0.3, -0.9, 0.9)], 4)
    trunk_radii = list(np.interp(np.linspace(0, 1, len(trunk_path)), [0, 0.3, 0.6, 1.0], [0.18, 0.135, 0.1, 0.07]))
    skull.add(sdf.tube(trunk_path, trunk_radii), 0.05)
    skull.warp(tf.ring_warp(tf.WORLD, pitch=0.085, depth=0.016), (-0.3, -1.35, 0.78), (0.3, -0.85, 1.3))
    skull.add(sdf.ellipsoid(head.p(0, -0.62, -0.72), head.radii(0.3, 0.26, 0.16)), head.l(0.12))
    face = sculpt.mass("elephant_head", PORTRAIT, 2.0)
    face.blend(skull)
    ears = sculpt.mass("ears", TERRACOTTA, 1.0)
    inner = sculpt.mass("inner_ears", PORTRAIT, 1.2)
    tusks = sculpt.mass("tusks", EYE_IVORY, 2.5)
    for side in (-1.0, 1.0):
        tf.add_eye(sculpt, head, HEAD_MATERIALS, (0.43, -0.75, 0.2), (0.235, 0.1, 0.225), side, prefix="mount_")
        flap = sculpt.scratch().add(sdf.ellipsoid((0.64 * side, -0.4, 1.5), (0.37, 0.085, 0.43), sdf.euler(0, 6 * side, -24 * side)))
        ears.blend(flap)
        inner.blend(sculpt.shell(flap, 0.012, sdf.ellipsoid((0.70 * side, -0.52, 1.49), (0.27, 0.16, 0.33), sdf.euler(0, 6 * side, -24 * side))))
        tusks.add(sdf.tube(sdf.spline([(0.2 * side, -0.94, 1.32), (0.27 * side, -1.08, 1.16), (0.33 * side, -1.17, 1.06)], 3), [0.06, 0.056, 0.05, 0.044, 0.036, 0.028, 0.02]), 0.02)
    cap = sculpt.shell(skull, 0.04, sdf.ellipsoid(head.p(0, -0.3, 0.92), head.radii(0.74, 0.72, 0.4)), 0.03)
    sculpt.mass("head_armour", LACQUER, 1.4).blend(cap)
    sculpt.mass("head_band", CINNABAR, 1.6).blend(sculpt.shell(skull, 0.052, sdf.box(head.p(0, -0.3, 0.60), head.radii(1.2, 1.2, 0.06)), 0.01))
    sculpt.mass("head_seal", JADE, 5.0).add(sdf.ellipsoid(head.p(0, -0.80, 0.74), head.radii(0.14, 0.08, 0.14)))

    # Blanket of lamellar plates over the back, cinnabar border, and the small tower.
    trunk = tf.Frame((0, 0.12, 1.14), sdf.aim((0, 1, 0)))
    drape = sdf.box((0, 0.16, 1.62), (1.0, 0.5, 0.6))
    blanket = sculpt.shell(body, 0.05, drape, 0.03)
    blanket.warp(tf.plate_warp(trunk, z0=-0.46, row=0.25, column=0.33, radius=0.66, depth=0.028, groove=0.12, stagger=0.5), (-1.0, -0.4, 1.0), (1.0, 0.8, 1.85))
    sculpt.mass("blanket", LACQUER, 1.1).blend(blanket)
    border = sculpt.mass("blanket_border", CINNABAR, 1.3)
    border.blend(sculpt.shell(body, 0.062, sdf.box((0, 0.16, 1.05), (1.0, 0.51, 0.034)), 0.01))
    border.blend(sculpt.shell(body, 0.062, sdf.box((0, -0.325, 1.62), (1.0, 0.032, 0.6)), 0.01))
    border.blend(sculpt.shell(body, 0.062, sdf.box((0, 0.645, 1.62), (1.0, 0.032, 0.6)), 0.01))
    studs = sculpt.mass("studs", JADE, 6.0)
    for side in (-1.0, 1.0):
        for y in (-0.17, 0.16, 0.49):
            studs.add(sdf.sphere((0.80 * side * (1 - 0.3 * abs(y - 0.16)), y, 1.18), 0.04))
    tower = sculpt.mass("tower", LACQUER, 1.2)
    drum = sculpt.scratch().add(sdf.cylinder((0, 0.14, 1.6), (0, 0.14, 2.06), 0.31, 0.03))
    drum.cut(sdf.cylinder((0, 0.14, 1.96), (0, 0.14, 2.2), 0.24, 0.02), 0.015)
    for index in range(8):
        angle = math.radians(22.5 + index * 45)
        drum.cut(sdf.box((0.31 * math.sin(angle), 0.14 - 0.31 * math.cos(angle), 2.06), (0.055, 0.1, 0.05), sdf.euler(0, 0, -math.degrees(angle))), 0.01)
    tower.blend(drum)
    sculpt.mass("tower_rail", CINNABAR, 1.5).blend(sculpt.shell(drum, 0.014, tf.slab(1.86, 1.93), 0.006))
    sculpt.parts.update({name: "mount" for name in sculpt.masses})
    sculpt.rig = {
        "spine": [1.0, 1.25, 1.5, 1.75],
        "head": [0, 0.14, 1.95],
        "arm": arm_rig((0.5, -0.3, 1.0), (0.52, -0.3, 0.75), (0.52, -0.3, 0.5)),
        "weapon": [[0, -0.98, 1.38], [0.16, -1.05, 0.73]],
        "mount": [[0, 0.12, 1.0], [0, -1.0, 1.4]],
    }
    return []


def build_cannon(sculpt: tf.Sculpt) -> list:
    """Siege crossbow: torsion bed, long bolt, winding winch and two kneeling engineers."""
    bed = sculpt.mass("bed", TERRACOTTA, 0.7)
    bed.add(sdf.box((0, 0.08, 0.62), (0.64, 0.52, 0.135), IDENTITY, 0.04))
    skids = sculpt.mass("outriggers", DEEP_BROWN, 0.7)
    for side in (-1.0, 1.0):
        skid = sculpt.scratch().add(sdf.box((0.63 * side, 0.1, 0.5), (0.2, 0.42, 0.09), IDENTITY, 0.045))
        skid.clip(tf.slab(BASE_TOP, 2.0), 0.02)
        skids.blend(skid)
    stock = sculpt.scratch().add(sdf.box((0, -0.24, 0.92), (0.135, 0.8, 0.1), IDENTITY, 0.035))
    stock.cut(sdf.capsule((0, -1.1, 1.03), (0, 0.5, 1.03), 0.045), 0.012)
    frame = sculpt.mass("frame", LACQUER, 1.0)
    frame.blend(stock)
    beam = sculpt.scratch().add(sdf.box((0, -0.44, 1.08), (0.72, 0.1, 0.1), IDENTITY, 0.04))
    frame.blend(beam)
    bands = sculpt.mass("frame_bands", CINNABAR, 1.4)
    for y in (-0.92, 0.36):
        bands.blend(sculpt.shell(stock, 0.014, sdf.box((0, y, 0.92), (0.3, 0.035, 0.3)), 0.006))
    hubs = sculpt.mass("hubs", JADE, 3.0)
    limbs = sculpt.mass("limbs", TERRACOTTA, 1.0)
    tips = sculpt.mass("limb_tips", EYE_IVORY, 1.2)
    props = []
    for side in (-1.0, 1.0):
        hubs.add(sdf.ellipsoid((0.62 * side, -0.45, 1.08), (0.145, 0.105, 0.145)))
        inner = sdf.spline([(0.1 * side, -0.47, 1.08), (0.36 * side, -0.535, 1.14), (0.6 * side, -0.53, 1.15)], 4)
        limbs.add(sdf.tube(inner, 0.066), 0.02)
        outer = sdf.spline([(0.6 * side, -0.53, 1.15), (0.86 * side, -0.47, 1.1), (1.06 * side, -0.37, 1.02)], 4)
        tips.add(sdf.tube(outer, list(np.linspace(0.06, 0.04, len(outer)))), 0.02)
        props.append(tm.prop_cylinder("Cannon visible bow cord", (1.06 * side, -0.37, 1.02), (0, 0.3, 1.04), 0.016, DEEP_BROWN, sides=6))
    # Heavy bolt on the rail and the winch that draws the cord.
    props.append(tm.prop_cylinder("Cannon heavy bronze bolt shaft", (0, 0.42, 1.1), (0, -1.06, 1.1), 0.036, CINNABAR, sides=12))
    props.append(tm.prop_lathe("Cannon heavy bronze bolt head", [(0.036, -1.27), (0.11, -1.14), (0.085, -1.04), (0.036, -1.0)], EYE_IVORY, segments=16, center=(0.0, 0.0), rotation=None))
    head_prop = props[-1]
    # The lathe is built along Z; lay it along the bolt.
    head_prop.rotation_euler = (math.radians(-90), 0, 0)
    tm.activate(head_prop)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    head_prop.location = (0, 0, 1.1)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    props.append(tm.prop_cylinder("Cannon side winding axle", (-0.5, 0.4, 0.93), (0.5, 0.4, 0.93), 0.075, TERRACOTTA, sides=16, bevel=0.012))
    for side in (-1.0, 1.0):
        props.append(tm.prop_torus("Cannon winding wheel", (0.53 * side, 0.4, 0.93), 0.2, 0.04, CINNABAR, rotation=(0, 90, 0), major_segments=28, minor_segments=8))
        for index in range(4):
            angle = math.radians(45 + index * 90)
            spoke = (math.cos(angle), math.sin(angle))
            props.append(tm.prop_cylinder("Cannon winding spoke", (0.53 * side, 0.4 + 0.05 * spoke[0], 0.93 + 0.05 * spoke[1]), (0.53 * side, 0.4 + 0.2 * spoke[0], 0.93 + 0.2 * spoke[1]), 0.024, DEEP_BROWN, sides=6))
    sculpt.occlude(sdf.box((0, 0.4, 0.93), (0.55, 0.08, 0.08)))

    # Two engineers kneel behind the winch, one hand each on its wheel.
    for side in (-1.0, 1.0):
        centre = (0.44 * side, 0.52, 1.72)
        arms = {side: ((0.63 * side, 0.42, 1.36), (0.57 * side, 0.36, 1.2), (0.53 * side, 0.4, 1.135), (1, 0, 0), (0, 0, -1))}
        arms[-side] = ((0.2 * side, 0.3, 1.34), (0.22 * side, 0.22, 1.2), (0.22 * side, 0.2, 1.13), (1, 0, 0), (0, 0, -1))
        crew = add_bust(sculpt, centre, 0.25, arms, style={"moustache": side > 0}, bottom=-0.75, studs=False)
        add_helmet_band(sculpt, crew, seal=False)
        tf.build_topknot(sculpt, crew, HEAD_MATERIALS, distance=1.26, radii=(0.22, 0.2, 0.28), tie=False)
        knees = sculpt.mass("crew_tunic")
        knees.add(sdf.ellipsoid((centre[0], centre[1] - 0.06, 0.93), (0.26, 0.3, 0.2)), 0.05)
    sculpt.parts.update({name: "mount" for name in ("bed", "outriggers", "frame", "frame_bands", "hubs", "limbs", "limb_tips")})
    sculpt.parts.update({name: "head" for name in ("helmet", "helmet_band")})
    sculpt.rig = {
        "spine": [1.0, 1.15, 1.3, 1.5],
        "head": [0, 0.52, 1.72],
        "arm": arm_rig((0.64, 0.525, 1.41), (0.63, 0.42, 1.36), (0.57, 0.36, 1.2)),
        "weapon": [[0, 0.42, 1.1], [0, -1.27, 1.1]],
        "mount": [[0, 0.0, 0.8], [0, -1.2, 1.1]],
    }
    return tagged("mount", props)


ROLE_BUILDERS = {
    "marshal": build_marshal,
    "advisor": build_advisor,
    "elephant": build_elephant,
    "chariot": build_chariot,
    "horse": build_horse,
    "cannon": build_cannon,
    "soldier": build_soldier,
}
ROLE_BOUNDS = {
    "marshal": ((-1.0, -0.9, 0.36), (1.0, 0.92, 3.52)),
    "advisor": ((-0.98, -0.86, 0.36), (0.98, 0.8, 2.96)),
    "elephant": ((-1.1, -1.36, 0.36), (1.1, 1.12, 2.26)),
    "chariot": ((-1.0, -1.3, 0.36), (1.0, 0.8, 2.62)),
    "horse": ((-1.0, -1.34, 0.36), (1.0, 1.08, 3.2)),
    "cannon": ((-1.2, -1.2, 0.36), (1.2, 1.0, 2.3)),
    "soldier": ((-0.98, -0.82, 0.36), (0.98, 0.86, 3.24)),
}
HEAD_HEIGHTS = {"marshal": 2.35, "advisor": 2.08, "soldier": 2.08, "chariot": 1.82, "horse": 2.2, "elephant": 1.5, "cannon": 1.5}
PREVIOUS_SOURCES = {
    "marshal": "red-marshal-terracotta-cartoon-v2.glb",
    **{role: f"red-{role}-terracotta-cartoon-v1.glb" for role in ("advisor", "elephant", "chariot", "horse", "cannon", "soldier")},
}


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.collections, bpy.data.lights, bpy.data.cameras):
        for item in list(block):
            block.remove(item)


def sculpt_role(spec) -> tuple:
    """Build one role. Returns ``(joined mesh object, stats, rig hints)``."""
    role, started = spec["role"], time.time()
    lo, hi = ROLE_BOUNDS[role]
    sculpt = tf.Sculpt(sdf.Volume(lo, hi, VOXEL, margin=0.12))
    props = build_base(sculpt, spec["glyph"])
    props += ROLE_BUILDERS[role](sculpt)
    clay = tm.mesh_layers(sculpt.items(), bury=0.03)
    volume = sculpt.bake_volume()
    raw_triangles = sum(tm.triangle_count(obj) for obj in clay)
    prop_triangles = sum(tm.triangle_count(obj) for obj in props)
    budget = max(4000, spec["triangles"] - prop_triangles)
    weights = [tm.triangle_count(obj) * sculpt.detail[obj["sculpt_mass"]] for obj in clay]
    for obj, weight in zip(clay, weights, strict=True):
        tm.decimate(obj, max(24, round(budget * weight / sum(weights))))
        tm.shade_object(obj, volume)
        tm.set_part(obj, sculpt.part_of(obj["sculpt_mass"]))
    for obj in props:
        tm.shade_object(obj, volume, mottle=0.0)
    masses = len(clay)
    piece = tm.join([*clay, *props], f"Red {spec['title']} Qin Terracotta Cartoon V3 - Joined Mesh")
    piece.data.uv_layers.active = piece.data.uv_layers["rig_hint"]
    tm.remove_slivers(piece)
    stats = {
        "role": role,
        "masses": masses,
        "props": len(props),
        "raw_triangles": raw_triangles,
        "triangles": tm.triangle_count(piece),
        "seconds": round(time.time() - started, 1),
    }
    return piece, stats, sculpt.rig


def render_preview(piece, spec) -> None:
    """Board-lit review sheets, including a before/after against the stacked-primitive source."""
    tm.display_colors(piece)
    piece.data.materials.clear()
    piece.data.materials.append(tm.preview_material())
    lo, hi = ROLE_BOUNDS[spec["role"]]
    top = hi[2] + 0.25
    centre = (0.0, 0.0, top * 0.5)
    tm.setup_review_lights(centre, scale=2.2)
    out = Path(PREVIEW_DIR) / f"{spec['role']}.png"
    tm.render_views(
        str(out),
        [((0, -12, top * 0.5), centre, top * 1.04), ((6.5, -10, 3.4), centre, top * 1.04), ((-12, 0, top * 0.5), centre, top * 1.04), ((-5, 10.5, 3.6), centre, top * 1.04)],
        resolution=(560, 760),
    )
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(MODEL_DIR / PREVIOUS_SOURCES[spec["role"]]))
    previous = [obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in previous:
        obj.location.x -= 2.5
    pair = (-1.25, 0.0, top * 0.5)
    span = max(top * 1.42, 5.1)
    tm.render_views(str(out).replace(".png", "_compare.png"), [((-1.25, -12, top * 0.5), pair, span), ((5.25, -10, 3.4), pair, span)], resolution=(1040, 760))
    for obj in previous:
        bpy.data.objects.remove(obj, do_unlink=True)
    head_z = HEAD_HEIGHTS.get(spec["role"], top * 0.6)
    tm.render_views(str(out).replace(".png", "_face.png"), [((0, -8, head_z), (0, 0, head_z), 1.7), ((3.4, -7, head_z + 0.5), (0, 0, head_z - 0.05), 1.7), ((1.5, -8, 1.2), (0.3, 0, 1.15), 1.3)], resolution=(640, 640))
    print(f"SCULPT_PREVIEW={out}")


def render_studio(piece, name: str) -> None:
    """Hero and orthographic front renders in the same umber studio as the earlier sets."""
    scene = bpy.context.scene
    floor = bpy.data.materials.new("Matte umber studio floor")
    floor.diffuse_color = (0.018, 0.014, 0.012, 1)
    backdrop = bpy.data.materials.new("Soft charcoal studio backdrop")
    backdrop.diffuse_color = (0.028, 0.023, 0.021, 1)
    studio = []
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.015))
    studio.append(bpy.context.object)
    studio[-1].data.materials.append(floor)
    bpy.ops.mesh.primitive_plane_add(size=15, location=(0, 3.0, 3.1), rotation=(math.pi / 2, 0, 0))
    studio.append(bpy.context.object)
    studio[-1].data.materials.append(backdrop)
    for material in (floor, backdrop):
        material.use_nodes = True
        material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = material.diffuse_color
        material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.96
    world = scene.world or bpy.data.worlds.new("studio world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.006, 0.005, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.13
    for label, location, energy, size, color in (
        ("Large warm key", (-4.3, -5.4, 6.2), 1050, 4.3, (1.0, 0.80, 0.64)),
        ("Soft front fill", (3.1, -4.8, 3.6), 340, 3.8, (0.72, 0.79, 0.92)),
        ("Cinnabar rear rim", (3.7, 2.7, 5.1), 900, 3.0, (1.0, 0.48, 0.25)),
        ("Low face bounce", (-1.4, -2.4, 1.0), 180, 2.2, (0.72, 0.48, 0.34)),
    ):
        data = bpy.data.lights.new(label, "AREA")
        data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
        light = bpy.data.objects.new(label, data)
        scene.collection.objects.link(light)
        light.location = location
        tm.look_at(light, (0, 0, 1.45))
        studio.append(light)
    camera_data = bpy.data.cameras.new("Cartoon set studio camera")
    camera = bpy.data.objects.new("Cartoon set studio camera", camera_data)
    scene.collection.objects.link(camera)
    studio.append(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1200, 1400, 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # Blender would otherwise write the workstation's .blend path into the PNG.
    scene.render.use_stamp_filename = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    top = max(vertex.co.z for vertex in piece.data.vertices)
    camera.location = (4.0, -8.2, 3.0)
    camera_data.type, camera_data.lens = "PERSP", 74
    tm.look_at(camera, (0, 0, max(1.2, top * 0.47)))
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(RENDER_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    camera.location = (0, -8.0, top * 0.5)
    camera_data.type, camera_data.ortho_scale = "ORTHO", max(2.9, top * 1.06)
    tm.look_at(camera, (0, 0, top * 0.5))
    scene.render.filepath = str(RENDER_DIR / f"{name}-front.png")
    bpy.ops.render.render(write_still=True)
    for obj in studio:
        bpy.data.objects.remove(obj, do_unlink=True)


def export_role(piece, spec, stats, rig) -> None:
    name = f"red-{spec['role']}-terracotta-cartoon-v3"
    for stale in ("material_id", "sculpt_mass", "part"):
        if stale in piece:
            del piece[stale]
    piece["source_role"] = spec["role"]
    piece["source_glyph"] = spec["glyph"]
    piece["source_glyph_kind"] = "cjk_font_outline"
    piece["source_glyph_codepoint"] = ord(spec["glyph"])
    piece["source_glyph_font_glyph_id"] = GLYPH_FONT_GLYPH_IDS[spec["glyph"]]
    piece["source_style_family"] = STYLE_FAMILY
    piece["source_construction"] = "sculpted_distance_field_islands"
    piece["source_character_proportion"] = "2.25-head"
    piece["source_sculpt_voxel"] = VOXEL
    piece["source_sculpt_masses"] = stats["masses"]
    piece["source_triangle_count"] = stats["triangles"]
    piece["source_base_radius"] = 1.08
    piece["rig_hints"] = json.dumps(rig, separators=(",", ":"))
    render_studio(piece, name)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(MODEL_DIR / f"{name}.blend"))
    tm.activate(piece)
    bpy.ops.export_scene.gltf(
        filepath=str(MODEL_DIR / f"{name}.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_texcoords=True,
        export_extras=True,
    )
    print(f"ROLE_BUILT={spec['role']} TRIANGLES={stats['triangles']} MASSES={stats['masses']}")


def main() -> None:
    requested = {role.strip() for role in os.environ.get("XIANGQI_SOURCE_ROLES", ",".join(ROLE_BUILDERS)).split(",") if role.strip()}
    unknown = requested - set(ROLE_BUILDERS)
    if unknown:
        raise RuntimeError(f"Unknown XIANGQI_SOURCE_ROLES: {sorted(unknown)}")
    for spec in ROLES:
        if spec["role"] not in requested:
            continue
        reset_scene()
        piece, stats, rig = sculpt_role(spec)
        print(f"SCULPT_STATS={stats}")
        if PREVIEW_DIR:
            render_preview(piece, spec)
        else:
            export_role(piece, spec, stats, rig)
    print(f"SET_BUILT={STYLE_FAMILY} roles={','.join(sorted(requested))}")


main()
