"""Sculpting helpers shared by the Q-version Qin terracotta roster.

The roster keeps its 2.25-head toy proportions. What changes is the making:
heads, hands, cloth and armour are pressed from soft clay masses instead of
being stacked from spheres and boxes. Figures face -Y; +X is the viewer's right.
"""

from __future__ import annotations

import math

import numpy as np

import terracotta_sdf as sdf
from terracotta_sdf import F32, IDENTITY, vec


class Frame:
    """Local sculpting frame: origin, rotation and a uniform scale."""

    def __init__(self, origin, rot=IDENTITY, scale: float = 1.0):
        self.o = vec(origin)
        self.R = np.asarray(rot, dtype=np.float64)
        self.s = float(scale)

    def p(self, x: float, y: float, z: float, side: float = 1.0) -> np.ndarray:
        return self.o + self.R @ (vec((x * side, y, z)) * self.s)

    def l(self, value: float) -> float:
        return float(value) * self.s

    def radii(self, x: float, y: float, z: float):
        return (self.l(x), self.l(y), self.l(z))

    def rot(self, local=IDENTITY, side: float = 1.0) -> np.ndarray:
        if side < 0:
            mirror = np.diag([-1.0, 1.0, 1.0])
            local = mirror @ local @ mirror
        return self.R @ local

    def to_local(self, X, Y, Z):
        """World grid coordinates as local, scale-normalised coordinates."""
        dx, dy, dz = X - F32(self.o[0]), Y - F32(self.o[1]), Z - F32(self.o[2])
        r = (self.R / self.s).astype(np.float32)
        return (
            dx * r[0, 0] + dy * r[1, 0] + dz * r[2, 0],
            dx * r[0, 1] + dy * r[1, 1] + dz * r[2, 1],
            dx * r[0, 2] + dy * r[1, 2] + dz * r[2, 2],
        )

    def box(self, lo, hi):
        """World-space bounding box of a local-space box."""
        corners = [self.p(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        return np.min(corners, axis=0), np.max(corners, axis=0)


WORLD = Frame((0.0, 0.0, 0.0))
HEAD_MASSES = frozenset({"skin", "hair", "eye_white", "iris", "pupil", "sparkle", "lash", "brow", "whisker", "blush", "mouth", "knot_tie"})
ARM_MASSES = frozenset({"sleeves", "cuffs", "guards", "guards_trim", "hands"})


class Sculpt:
    """The named clay masses of one piece, each painted with a single material."""

    def __init__(self, volume: sdf.Volume):
        self.vol = volume
        self.masses: dict[str, tuple[sdf.Layer, int]] = {}
        self.detail: dict[str, float] = {}
        self.parts: dict[str, str] = {}
        self.rig: dict = {}
        self.occluders = volume.layer()
        self._has_occluders = False

    def mass(self, name: str, material: int | None = None, detail: float = 1.0) -> sdf.Layer:
        """Get or create a painted mass. ``detail`` weights its share of the triangle budget."""
        if name not in self.masses:
            if material is None:
                raise KeyError(f"Unknown clay mass {name!r}")
            self.masses[name] = (self.vol.layer(), material)
            self.detail[name] = float(detail)
        return self.masses[name][0]

    def part_of(self, name: str) -> str:
        """Rig part that carries a mass; heads and arms are recognised by name."""
        if name in self.parts:
            return self.parts[name]
        if name in HEAD_MASSES:
            return "head"
        return "arm" if name in ARM_MASSES else "body"

    def scratch(self) -> sdf.Layer:
        return self.vol.layer()

    def shell(self, core: sdf.Layer, thickness: float, region: sdf.Prim | None = None, k: float = 0.0) -> sdf.Layer:
        """A skin of clay laid over ``core``: trims, armour and painted patches."""
        layer = self.vol.layer()
        layer.blend(core)
        layer.inflate(max(thickness, self.vol.h * 1.6))
        if region is not None:
            layer.clip(region, k)
        return layer

    def occlude(self, prim: sdf.Prim) -> None:
        """Hard-surface props shade the clay around them without being sculpted."""
        self.occluders.add(prim)
        self._has_occluders = True

    def items(self):
        return [(name, layer, material) for name, (layer, material) in self.masses.items()]

    def bake_volume(self) -> sdf.Volume:
        for _name, layer, material in self.items():
            layer.merge(material)
        if self._has_occluders:
            self.occluders.merge(0)
        return self.vol


def slab(z0: float, z1: float, reach: float = 4.0) -> sdf.Prim:
    return sdf.box((0.0, 0.0, (z0 + z1) * 0.5), (reach, reach, (z1 - z0) * 0.5))


def fold_warp(frame: Frame, *, count: int, depth: float, z_top: float, z_full: float, phase: float = 0.6, floor: float | None = None):
    """Broad cloth folds around ``frame``'s Z axis, deepening from ``z_top`` to ``z_full``."""

    def fn(d, X, Y, Z):
        x, y, z = frame.to_local(X, Y, Z)
        weight = sdf.smoothstep(z_top, z_full, z).astype(np.float32)
        wave = np.cos(F32(count) * np.arctan2(x, -y) + F32(phase))
        folded = d + F32(depth * frame.s) * weight * wave
        if floor is None:
            return folded
        return sdf.smax(folded, (F32(floor) - z) * F32(frame.s), frame.l(0.012))

    return fn


def plate_warp(frame: Frame, *, z0: float, row: float, column: float, radius: float, depth: float, shingle: float = 0.0, groove: float = 0.12, stagger: float = 0.5):
    """Lamellar relief: rows of pillowed plates wrapped around ``frame``'s Z axis."""

    def fn(d, X, Y, Z):
        x, y, z = frame.to_local(X, Y, Z)
        row_coordinate = (z - F32(z0)) / F32(row)
        row_index = np.floor(row_coordinate)
        row_fraction = row_coordinate - row_index
        column_coordinate = np.arctan2(x, -y) * F32(radius / column) + F32(0.5) + F32(stagger) * (row_index % 2)
        column_fraction = column_coordinate - np.floor(column_coordinate)
        edge = np.maximum(np.abs(row_fraction - F32(0.5)), np.abs(column_fraction - F32(0.5))) * F32(2.0)
        seam = sdf.smoothstep(1.0 - groove * 2.0, 1.0, edge).astype(np.float32)
        return d + F32(depth * frame.s) * seam - F32(shingle * frame.s) * (F32(0.5) - row_fraction)

    return fn


def ring_warp(frame: Frame, *, pitch: float, depth: float, z0: float = 0.0, spread: float | None = None):
    """Bands along ``frame``'s Z axis; ``spread`` fades them away from the origin."""

    def fn(d, X, Y, Z):
        _x, _y, z = frame.to_local(X, Y, Z)
        bands = F32(depth * frame.s * 0.5) * (F32(1.0) - np.cos(F32(2.0 * np.pi / pitch) * (z - F32(z0))))
        if spread is not None:
            bands = bands * np.exp(-((z / F32(spread)) ** 2))
        return d + bands

    return fn


def path_region(frame: Frame, points, radii, *, side: float = 1.0, y0: float = -1.5, y1: float = 0.0) -> sdf.Prim:
    """Region swept along ``frame``'s Y axis from an ``(x, z)`` polyline drawn on the front.

    Clipping a thin shell of skin with it paints a line that hugs the surface.
    """
    pts = [(x * side, z) for x, z in points]
    if np.isscalar(radii):
        radii = [float(radii)] * len(pts)

    def fn(X, Y, Z):
        x, y, z = frame.to_local(X, Y, Z)
        best = None
        for index in range(len(pts) - 1):
            (ax, az), (bx, bz) = pts[index], pts[index + 1]
            dx, dz = bx - ax, bz - az
            t = np.clip(((x - F32(ax)) * F32(dx) + (z - F32(az)) * F32(dz)) / F32(dx * dx + dz * dz), 0.0, 1.0)
            distance = np.sqrt((x - F32(ax) - t * F32(dx)) ** 2 + (z - F32(az) - t * F32(dz)) ** 2)
            distance = distance - (F32(radii[index]) + t * F32(radii[index + 1] - radii[index]))
            best = distance if best is None else np.minimum(best, distance)
        return np.maximum(best, np.maximum(F32(y0) - y, y - F32(y1))) * F32(frame.s)

    reach = max(radii)
    xs, zs = [x for x, _z in pts], [z for _x, z in pts]
    lo, hi = frame.box((min(xs) - reach, y0, min(zs) - reach), (max(xs) + reach, y1, max(zs) + reach))
    return sdf.Prim(lo, hi, fn)


def prism(frame: Frame, polygon, y0: float, y1: float, round_: float = 0.0) -> sdf.Prim:
    """Convex ``(x, z)`` outline extruded along ``frame``'s Y axis, with rounded edges."""
    pts = [(float(x), float(z)) for x, z in polygon]
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts.reverse()

    def fn(X, Y, Z):
        x, y, z = frame.to_local(X, Y, Z)
        best = None
        for index, (ax, az) in enumerate(pts):
            bx, bz = pts[(index + 1) % len(pts)]
            ex, ez = bx - ax, bz - az
            length = math.hypot(ex, ez)
            # Outward normal of a counter-clockwise outline.
            distance = (x - F32(ax)) * F32(ez / length) - (z - F32(az)) * F32(ex / length)
            best = distance if best is None else np.maximum(best, distance)
        slab_distance = np.maximum(F32(y0) - y, y - F32(y1))
        inner = np.maximum(best + F32(round_), slab_distance + F32(round_))
        outer = np.sqrt(np.maximum(best + F32(round_), 0) ** 2 + np.maximum(slab_distance + F32(round_), 0) ** 2)
        return (np.minimum(inner, 0) + outer - F32(round_)) * F32(frame.s)

    xs, zs = [x for x, _z in pts], [z for _x, z in pts]
    lo, hi = frame.box((min(xs), y0, min(zs)), (max(xs), y1, max(zs)))
    return sdf.Prim(lo, hi, fn)


def pennant(origin, width: float, height: float, thickness: float, *, side: float, waves: float = 1.4, amplitude: float = 0.035, swallow: float = 0.34) -> sdf.Prim:
    """Swallow-tailed cloth pennant flying from a pole at ``origin`` towards ``side`` along X."""
    ox, oy, oz = (float(value) for value in origin)

    def fn(X, Y, Z):
        x = (X - F32(ox)) * F32(side)
        z = Z - F32(oz)
        reach = np.clip(x / F32(width), 0.0, 1.0)
        y = (Y - F32(oy)) - F32(amplitude) * reach * np.sin(F32(waves * 2 * math.pi) * reach)
        qx = np.abs(x - F32(width * 0.5)) - F32(width * 0.5)
        qy = np.abs(y) - F32(thickness * 0.5)
        qz = np.abs(z + F32(height * 0.5)) - F32(height * 0.5)
        outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
        cloth = outside + np.minimum(np.maximum(qx, np.maximum(qy, qz)), F32(0.0))
        notch = ((x - F32(width * (1 - swallow))) * F32(height * 0.5 / (width * swallow)) - np.abs(z + F32(height * 0.5))) * F32(0.7)
        return np.maximum(cloth, notch)

    lo = (min(ox, ox + side * width), oy - amplitude - thickness, oz - height)
    hi = (max(ox, ox + side * width), oy + amplitude + thickness, oz)
    return sdf.Prim(lo, hi, fn)


def add_eye(sculpt: Sculpt, frame: Frame, materials: dict[str, int], centre, radii, side: float, *, prefix: str = "", lash: bool = True, iris: float = 0.76, look=(0.0, 0.0)) -> None:
    """One inlaid eye: white, iris, pupil and catch-lights lie flush like glaze."""
    f = frame
    L = f.l
    white = sculpt.mass(prefix + "eye_white", materials["eye_white"], 5.0)
    iris_mass = sculpt.mass(prefix + "iris", materials["iris"], 6.0)
    pupil = sculpt.mass(prefix + "pupil", materials["ink"], 6.0)
    sparkle = sculpt.mass(prefix + "sparkle", materials["eye_white"], 8.0)
    ball = sdf.ellipsoid(f.p(*centre, side), f.radii(*radii), f.rot())
    white.add(ball)
    eye = sculpt.scratch().add(ball)
    rx, rz = radii[0], radii[2]
    gaze_x = centre[0] * side + look[0] * rx - 0.03 * rx * side
    gaze_z = centre[2] + look[1] * rz - 0.05 * rz
    depth = centre[1] - radii[1]
    film = max(L(0.04 * rx), sculpt.vol.h * 1.6)
    step = max(L(0.033 * rx), sculpt.vol.h * 1.1)
    iris_mass.blend(sculpt.shell(eye, film, sdf.ellipsoid(f.p(gaze_x, depth, gaze_z), f.radii(rx * iris, 0.6, rz * iris * 1.1), f.rot())))
    pupil.blend(sculpt.shell(eye, film + step, sdf.ellipsoid(f.p(gaze_x, depth, gaze_z), f.radii(rx * iris * 0.57, 0.6, rz * iris * 0.68), f.rot())))
    sparkle.blend(sculpt.shell(eye, film + step * 2, sdf.sphere(f.p(gaze_x - 0.29 * rx, depth, gaze_z + 0.32 * rz), L(0.185 * rx))))
    sparkle.blend(sculpt.shell(eye, film + step * 2, sdf.sphere(f.p(gaze_x + 0.27 * rx, depth, gaze_z - 0.32 * rz), L(0.105 * rx))))
    if lash:
        # Upper lash line follows the rim of the eye.
        rim = []
        for step_index in range(7):
            angle = math.radians(12 + step_index * 26)
            rim.append(f.p(centre[0] * side + rx * 0.985 * math.cos(angle), centre[1] - 0.2 * radii[1], centre[2] + rz * 0.985 * math.sin(angle)))
        widths = [L(rx * value) for value in (0.057, 0.106, 0.13, 0.135, 0.13, 0.106, 0.057)]
        sculpt.mass(prefix + "lash", materials["ink"], 5.0).add(sdf.tube(rim, widths), L(0.04 * rx))


# --------------------------------------------------------------------------
# Q head
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Q head
# --------------------------------------------------------------------------
#
# Head units: the frame sits at the head centre and its scale is the vertical
# head radius. The face looks along -y.

HEAD_DEFAULT = {
    "moustache": True,
    "goatee": False,
    "smile": 1.0,
    "brow_tilt": 0.0,  # positive drops the inner ends (stern), negative lifts them (gentle)
    "peak": True,  # small centre point in the hairline
}
HEAD_RADII = (1.04, 0.90, 1.0)


def build_head(sculpt: Sculpt, frame: Frame, materials: dict[str, int], style: dict | None = None, *, prefix: str = "") -> dict:
    """Sculpt a Q-version head with large inlaid eyes. Returns hat/knot anchors."""
    opts = {**HEAD_DEFAULT, **(style or {})}
    f = frame
    L = f.l
    skin = sculpt.mass(prefix + "skin", materials["skin"], 2.6)
    hair = sculpt.mass(prefix + "hair", materials["hair"], 0.9)

    # Round skull: the lower face stays as wide as the cheeks, so the jaw closes in
    # one soft arc like the concept sheets instead of tapering to a chin.
    skin.add(sdf.ellipsoid(f.p(0, 0, 0), f.radii(*HEAD_RADII), f.rot()))
    skin.add(sdf.ellipsoid(f.p(0, -0.04, -0.30), f.radii(0.98, 0.84, 0.69), f.rot()), L(0.22))
    skin.add_sym(lambda s: sdf.ellipsoid(f.p(0.47, -0.50, -0.40, s), f.radii(0.36, 0.31, 0.33), f.rot()), L(0.26))
    skin.add(sdf.ellipsoid(f.p(0, -0.40, -0.66), f.radii(0.52, 0.36, 0.27), f.rot()), L(0.3))
    # Shallow bowls seat the eyes so they do not look pasted on.
    skin.cut_sym(lambda s: sdf.ellipsoid(f.p(0.39, -1.04, 0.08, s), f.radii(0.33, 0.20, 0.31), f.rot()), L(0.16))
    # Button nose.
    skin.add(sdf.rcone(f.p(0, -0.85, -0.09), f.p(0, -0.90, -0.16), L(0.04), L(0.06)), L(0.1))
    skin.add(sdf.sphere(f.p(0, -0.915, -0.18), L(0.078)), L(0.07))
    # A carved smile with a small lower lip; the line is inked so it reads at distance.
    smile = 0.075 * opts["smile"]
    mouth_path = [(0.19 * t, -0.425 + smile * t * t) for t in (-1.0, -0.66, -0.33, 0.0, 0.33, 0.66, 1.0)]
    skin.add(sdf.ellipsoid(f.p(0, -0.835, -0.505), f.radii(0.075, 0.04, 0.03), f.rot()), L(0.07))
    skin.cut(sdf.tube([f.p(x, -0.875 + 0.26 * abs(x), z) for x, z in mouth_path], L(0.026)), L(0.02))
    mouth_radii = [0.012, 0.018, 0.02, 0.02, 0.02, 0.018, 0.012]
    sculpt.mass(prefix + "mouth", materials["ink"], 6.0).blend(sculpt.shell(skin, L(0.006), path_region(f, mouth_path, mouth_radii)))
    # Ears with a carved bowl and lobe.
    ear_tilt = sdf.euler(-8.0, 0.0, 24.0)
    skin.add_sym(lambda s: sdf.ellipsoid(f.p(0.985, 0.03, -0.06, s), f.radii(0.115, 0.20, 0.265), f.rot(ear_tilt, s)), L(0.07))
    skin.cut_sym(lambda s: sdf.ellipsoid(f.p(1.085, -0.045, -0.04, s), f.radii(0.07, 0.11, 0.165), f.rot(ear_tilt, s)), L(0.035))
    skin.add_sym(lambda s: sdf.sphere(f.p(1.03, -0.075, -0.08, s), L(0.04)), L(0.03))
    # Short neck, mostly hidden by the collar.
    skin.add(sdf.rcone(f.p(0, 0.03, -0.80), f.p(0, 0.05, -1.22), L(0.40), L(0.42)), L(0.1))

    for side in (-1.0, 1.0):
        add_eye(sculpt, f, materials, (0.39, -0.785, 0.08), (0.245, 0.10, 0.235), side, prefix=prefix)

    # Brows and whiskers are raised clay so they still read at board distance.
    brow = sculpt.mass(prefix + "brow", materials["hair"], 4.0)
    tilt = opts["brow_tilt"]
    for side in (-1.0, 1.0):
        arc = [(0.19, 0.50 - tilt * 0.06), (0.40, 0.565), (0.62, 0.485 + tilt * 0.06)]
        brow.blend(sculpt.shell(skin, L(0.03), path_region(f, arc, [0.036, 0.044, 0.026], side=side), L(0.012)))
    if opts["moustache"] or opts["goatee"]:
        whisker = sculpt.mass(prefix + "whisker", materials["hair"], 4.0)
        if opts["moustache"]:
            for side in (-1.0, 1.0):
                droop = [(0.035, -0.305), (0.13, -0.315), (0.215, -0.36), (0.265, -0.43)]
                whisker.blend(sculpt.shell(skin, L(0.028), path_region(f, droop, [0.024, 0.028, 0.022, 0.01], side=side), L(0.012)))
        if opts["goatee"]:
            whisker.add(sdf.rcone(f.p(0, -0.83, -0.57), f.p(0, -0.775, -0.80), L(0.075), L(0.035)), L(0.012))

    # Rosy cheeks are a film of darker clay over the skin.
    blush = sculpt.mass(prefix + "blush", materials["blush"], 3.0)
    for side in (-1.0, 1.0):
        blush.blend(sculpt.shell(skin, L(0.006), sdf.ellipsoid(f.p(0.62, -0.72, -0.27, side), f.radii(0.16, 0.32, 0.10), f.rot())))

    # Hair: a combed cap cut back along the hairline, strands rising to the crown.
    hair.add(sdf.ellipsoid(f.p(0, 0.06, 0.06), f.radii(1.105, 0.985, 1.035), f.rot()))
    line_y = np.array([-1.2, -0.82, -0.56, -0.38, -0.24, -0.08, 0.12, 0.30, 0.52, 1.2], dtype=np.float32)
    line_z = np.array([0.80, 0.70, 0.52, 0.22, -0.06, 0.20, 0.20, -0.45, -0.80, -0.84], dtype=np.float32)

    def hairline(d, X, Y, Z):
        x, y, z = f.to_local(X, Y, Z)
        limit = np.interp(y, line_y, line_z).astype(np.float32)
        if opts["peak"]:
            limit = limit - F32(0.09) * np.exp(-((x / F32(0.16)) ** 2)) * (y < F32(-0.5))
        d = sdf.smax(d, (limit - z) * F32(f.s), L(0.03))
        strands = np.cos(F32(30.0) * np.arctan2(x, y - F32(0.12)))
        fade = (sdf.smoothstep(0.02, 0.2, z - limit) * sdf.smoothstep(1.02, 0.80, z)).astype(np.float32)
        return d + F32(L(0.011)) * fade * (F32(1.0) - strands)

    hair.warp(hairline, *f.box((-1.25, -1.2, -1.0), (1.25, 1.2, 1.2)))
    return {
        "crown": f.p(0, 0.06, 1.08),
        "brow": f.p(0, -0.9, 0.62),
        "back": f.p(0, 1.02, 0.1),
        "chin": f.p(0, -0.6, -0.98),
    }


def build_topknot(sculpt: Sculpt, frame: Frame, materials: dict[str, int], *, axis=(0.0, 0.09, 1.0), distance: float = 1.31, radii=(0.33, 0.31, 0.31), tie: bool = True, ribbon=(0.0, 0.42, -0.34), prefix: str = "") -> None:
    """Hair knot pushed out of the cap along ``axis`` (head units), tied with a ribbon."""
    hint = (0.0, 1.0, 0.0) if abs(sdf.unit(axis)[2]) > 0.9 else (0.0, 0.0, 1.0)
    f = Frame(frame.o, frame.R @ sdf.aim(axis, hint), frame.s)
    L = f.l
    hair = sculpt.mass(prefix + "hair")
    hair.add(sdf.ellipsoid(f.p(0, 0, distance), f.radii(*radii), f.rot()), L(0.05))

    def swirl(d, X, Y, Z):
        x, y, z = f.to_local(X, Y, Z)
        z = z - F32(distance)
        near = np.exp(-((x * x + y * y + z * z) / F32((max(radii) * 1.15) ** 2)) ** 3)
        return d + F32(L(0.012)) * near * (F32(1.0) - np.cos(F32(9.0) * np.arctan2(x, y) + F32(7.0) * z))

    reach = max(radii) * 1.4
    hair.warp(swirl, *f.box((-reach, -reach, distance - reach), (reach, reach, distance + reach)))
    if tie:
        band = sculpt.mass(prefix + "knot_tie", materials["trim"], 2.0)
        base = distance - radii[2] * 0.66
        band.add(sdf.torus(f.p(0, 0, base), L(radii[0] * 0.78), L(0.07), f.rot(), squash=1.2))
        # Ribbon ends fall away from the knot (``ribbon`` is a head-space offset).
        drop = frame.R @ (vec(ribbon) * frame.s)
        for side in (-1.0, 1.0):
            start = f.p(0.09 * side, radii[1] * 0.7, base)
            band.add(sdf.rcone(start, start + drop + f.R[:, 0] * L(0.09 * side), L(0.05), L(0.04)), L(0.02))


# --------------------------------------------------------------------------
# Q hands
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Q hands
# --------------------------------------------------------------------------


def build_fist(layer: sdf.Layer, centre, radius: float, shaft_axis, knuckle_dir, palm_dir) -> None:
    """A chubby fist around a shaft: stacked finger rolls and a thumb across them."""
    axis = sdf.unit(shaft_axis)
    knuckle = sdf.unit(vec(knuckle_dir) - axis * float(np.dot(knuckle_dir, axis)))
    palm = sdf.unit(vec(palm_dir) - axis * float(np.dot(palm_dir, axis)) - knuckle * float(np.dot(palm_dir, knuckle)))
    hand = Frame(centre, np.stack([palm, knuckle, axis], axis=1), radius)
    fist = layer.vol.layer()
    fist.add(sdf.box(hand.p(0, 0, 0), hand.radii(0.80, 0.92, 0.86), hand.R, hand.l(0.52)))

    def fingers(d, X, Y, Z):
        _x, y, z = hand.to_local(X, Y, Z)
        rolls = F32(1.0) - np.cos(F32(2.0 * np.pi / 0.43) * (z - F32(0.215)))
        return d + F32(hand.l(0.045)) * rolls * sdf.smoothstep(-0.25, 0.25, y).astype(np.float32)

    fist.warp(fingers, *hand.box((-1.1, -1.1, -1.0), (1.1, 1.2, 1.0)))
    fist.add(sdf.rcone(hand.p(0.62, -0.55, 0.30), hand.p(0.20, 0.72, 0.62), hand.l(0.30), hand.l(0.25)), hand.l(0.14))
    layer.blend(fist, hand.l(0.1))


def build_mitten(layer: sdf.Layer, wrist, finger_dir, palm_dir, thumb_hint, radius: float, curl: float = 0.3) -> None:
    """An open toy hand: fingers together with carved gaps, thumb held apart."""
    w = sdf.unit(finger_dir)
    palm = sdf.unit(vec(palm_dir) - w * float(np.dot(palm_dir, w)))
    u = np.cross(w, palm)
    if float(np.dot(u, thumb_hint)) < 0:
        u = -u
    hand = Frame(wrist, np.stack([u, -palm, w], axis=1), radius)
    mitt = layer.vol.layer()
    mitt.add(sdf.ellipsoid(hand.p(0, 0, 0.85), hand.radii(0.78, 0.46, 0.80), hand.R))
    for offset, length in ((-0.48, 0.62), (-0.16, 0.76), (0.16, 0.80), (0.48, 0.70)):
        mitt.add(sdf.rcone(hand.p(offset, 0, 1.25), hand.p(offset * 0.94, -curl * 0.5, 1.25 + length), hand.l(0.2), hand.l(0.17)), hand.l(0.07))
    mitt.add(sdf.rcone(hand.p(0.62, -0.05, 0.55), hand.p(1.0, -0.2, 1.25), hand.l(0.24), hand.l(0.19)), hand.l(0.12))
    layer.blend(mitt, hand.l(0.1))
