"""Signed-distance sculpting toolkit for the sculpted Qin terracotta Q roster.

Figures are modelled the way a clay sculptor works: rounded masses are
pressed together with soft joins, then features are carved back out. Every
mass is a signed-distance primitive evaluated with numpy on a regular voxel
grid; OpenVDB (bundled with Blender) turns the final field into a mesh.

The module is deliberately free of ``bpy`` so its numerics stay testable.
"""

from __future__ import annotations

import math

import numpy as np


FAR = np.float32(1.0e3)
F32 = np.float32

# Rig parts an island can be tagged with; the runtime adapter turns them into skin weights.
PARTS = ("static", "body", "head", "arm", "weapon", "mount")
PART = {name: index for index, name in enumerate(PARTS)}


# --------------------------------------------------------------------------
# Small vector helpers
# --------------------------------------------------------------------------


def vec(value) -> np.ndarray:
    return np.asarray(value, dtype=np.float64)


def unit(value) -> np.ndarray:
    vector = vec(value)
    length = float(np.linalg.norm(vector))
    if length < 1e-12:
        raise ValueError("Cannot normalise a zero-length vector")
    return vector / length


def euler(rx: float = 0.0, ry: float = 0.0, rz: float = 0.0) -> np.ndarray:
    """Rotation matrix from XYZ Euler angles in degrees (applied X, then Y, then Z)."""
    ax, ay, az = (math.radians(angle) for angle in (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    rot_x = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    rot_y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rot_z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rot_z @ rot_y @ rot_x


def aim(axis, hint=(0.0, 0.0, 1.0)) -> np.ndarray:
    """Frame whose third column follows ``axis``; ``hint`` steers the second column."""
    w = unit(axis)
    hint_vector = vec(hint)
    if abs(float(np.dot(w, unit(hint_vector)))) > 0.995:
        hint_vector = vec((0.0, 1.0, 0.0)) if abs(w[1]) < 0.9 else vec((1.0, 0.0, 0.0))
    u = unit(np.cross(hint_vector, w))
    v = np.cross(w, u)
    return np.stack([u, v, w], axis=1)


IDENTITY = np.eye(3)


def smin(a, b, k: float):
    """Polynomial smooth minimum: a soft clay join of radius ``k``."""
    if k <= 0.0:
        return np.minimum(a, b)
    blend = np.maximum(F32(k) - np.abs(a - b), F32(0.0)) * F32(1.0 / k)
    return np.minimum(a, b) - blend * blend * F32(k * 0.25)


def smax(a, b, k: float):
    if k <= 0.0:
        return np.maximum(a, b)
    blend = np.maximum(F32(k) - np.abs(a - b), F32(0.0)) * F32(1.0 / k)
    return np.maximum(a, b) + blend * blend * F32(k * 0.25)


def smoothstep(edge0, edge1, value):
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------


class Prim:
    """A distance function with a conservative world-space bounding box."""

    __slots__ = ("lo", "hi", "fn")

    def __init__(self, lo, hi, fn):
        self.lo = vec(lo)
        self.hi = vec(hi)
        self.fn = fn


def _local(X, Y, Z, center, rot):
    """World grid coordinates expressed in a primitive's local frame."""
    dx, dy, dz = X - F32(center[0]), Y - F32(center[1]), Z - F32(center[2])
    if rot is IDENTITY:
        return dx, dy, dz
    r = rot.astype(np.float32)
    u = dx * r[0, 0] + dy * r[1, 0] + dz * r[2, 0]
    v = dx * r[0, 1] + dy * r[1, 1] + dz * r[2, 1]
    w = dx * r[0, 2] + dy * r[1, 2] + dz * r[2, 2]
    return u, v, w


def _rotated_extent(rot, half):
    return np.abs(rot) @ vec(half)


def sphere(center, radius: float) -> Prim:
    c = vec(center)

    def fn(X, Y, Z):
        return np.sqrt((X - F32(c[0])) ** 2 + (Y - F32(c[1])) ** 2 + (Z - F32(c[2])) ** 2) - F32(radius)

    return Prim(c - radius, c + radius, fn)


def ellipsoid(center, radii, rot=IDENTITY) -> Prim:
    c, r = vec(center), vec(radii)

    def fn(X, Y, Z):
        u, v, w = _local(X, Y, Z, c, rot)
        k0 = np.sqrt((u / F32(r[0])) ** 2 + (v / F32(r[1])) ** 2 + (w / F32(r[2])) ** 2)
        k1 = np.sqrt((u / F32(r[0] ** 2)) ** 2 + (v / F32(r[1] ** 2)) ** 2 + (w / F32(r[2] ** 2)) ** 2)
        return k0 * (k0 - F32(1.0)) / np.maximum(k1, F32(1e-9))

    extent = np.sqrt((rot**2) @ (r**2))
    return Prim(c - extent, c + extent, fn)


def rcone(a, b, ra: float, rb: float) -> Prim:
    """Exact round cone: a limb segment with a different radius at each end."""
    pa, pb = vec(a), vec(b)
    ba = pb - pa
    l2 = float(np.dot(ba, ba))
    if l2 < 1e-12:
        return sphere(pa, max(ra, rb))
    rr = ra - rb
    a2 = max(l2 - rr * rr, 0.0)
    il2 = 1.0 / l2

    def fn(X, Y, Z):
        px, py, pz = X - F32(pa[0]), Y - F32(pa[1]), Z - F32(pa[2])
        y = px * F32(ba[0]) + py * F32(ba[1]) + pz * F32(ba[2])
        z = y - F32(l2)
        qx, qy, qz = px * F32(l2) - F32(ba[0]) * y, py * F32(l2) - F32(ba[1]) * y, pz * F32(l2) - F32(ba[2]) * y
        x2 = qx * qx + qy * qy + qz * qz
        y2 = y * y * F32(l2)
        z2 = z * z * F32(l2)
        k = F32(math.copysign(1.0, rr) * rr * rr) * x2
        end_b = np.sqrt(x2 + z2) * F32(il2) - F32(rb)
        end_a = np.sqrt(x2 + y2) * F32(il2) - F32(ra)
        side = (np.sqrt(x2 * F32(a2 * il2)) + y * F32(rr)) * F32(il2) - F32(ra)
        return np.where(np.sign(z) * F32(a2) * z2 > k, end_b, np.where(np.sign(y) * F32(a2) * y2 < k, end_a, side))

    return Prim(np.minimum(pa - ra, pb - rb), np.maximum(pa + ra, pb + rb), fn)


def capsule(a, b, radius: float) -> Prim:
    return rcone(a, b, radius, radius)


def box(center, half, rot=IDENTITY, round_: float = 0.0) -> Prim:
    c, hsize = vec(center), vec(half)
    inner = np.maximum(hsize - round_, 1e-6)

    def fn(X, Y, Z):
        u, v, w = _local(X, Y, Z, c, rot)
        qx, qy, qz = np.abs(u) - F32(inner[0]), np.abs(v) - F32(inner[1]), np.abs(w) - F32(inner[2])
        outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
        inside = np.minimum(np.maximum(qx, np.maximum(qy, qz)), F32(0.0))
        return outside + inside - F32(round_)

    extent = _rotated_extent(rot, hsize)
    return Prim(c - extent, c + extent, fn)


def cylinder(a, b, radius: float, round_: float = 0.0, radius_b: float | None = None) -> Prim:
    """Capped cylinder (or frustum when ``radius_b`` is given) with a rounded rim."""
    pa, pb = vec(a), vec(b)
    axis = pb - pa
    length = float(np.linalg.norm(axis))
    rot = aim(axis)
    center = (pa + pb) * 0.5
    half = length * 0.5
    r1 = radius if radius_b is None else radius_b
    biggest = max(radius, r1)

    def fn(X, Y, Z):
        u, v, w = _local(X, Y, Z, center, rot)
        if radius_b is None:
            local_radius = F32(radius - round_)
        else:
            t = np.clip(w / F32(length) + F32(0.5), 0.0, 1.0)
            local_radius = F32(radius - round_) + t * F32(r1 - radius)
        dr = np.sqrt(u * u + v * v) - local_radius
        dw = np.abs(w) - F32(half - round_)
        outside = np.sqrt(np.maximum(dr, 0) ** 2 + np.maximum(dw, 0) ** 2)
        return outside + np.minimum(np.maximum(dr, dw), F32(0.0)) - F32(round_)

    extent = _rotated_extent(rot, (biggest, biggest, half))
    return Prim(center - extent, center + extent, fn)


def torus(center, major: float, minor: float, rot=IDENTITY, squash: float = 1.0) -> Prim:
    """Ring lying in the local UV plane; ``squash`` flattens the tube along W."""
    c = vec(center)

    def fn(X, Y, Z):
        u, v, w = _local(X, Y, Z, c, rot)
        ring = np.sqrt(u * u + v * v) - F32(major)
        return np.sqrt(ring * ring + (w / F32(squash)) ** 2) - F32(minor)

    extent = _rotated_extent(rot, (major + minor, major + minor, minor * max(1.0, squash)))
    return Prim(c - extent, c + extent, fn)


def _profile_table(stations, samples: int = 96):
    """Resample loft stations with a monotone-friendly smooth interpolation."""
    data = np.asarray(stations, dtype=np.float64)
    order = np.argsort(data[:, 0])
    data = data[order]
    w = data[:, 0]
    dense_w = np.linspace(w[0], w[-1], samples)
    columns = []
    for column in range(1, data.shape[1]):
        values = data[:, column]
        # Catmull-Rom tangents limited to the neighbouring slopes (no overshoot).
        slopes = np.diff(values) / np.maximum(np.diff(w), 1e-9)
        tangents = np.zeros_like(values)
        tangents[1:-1] = np.where(slopes[:-1] * slopes[1:] > 0, 2 * slopes[:-1] * slopes[1:] / (slopes[:-1] + slopes[1:] + 1e-12), 0.0)
        tangents[0], tangents[-1] = slopes[0], slopes[-1]
        index = np.clip(np.searchsorted(w, dense_w, side="right") - 1, 0, len(w) - 2)
        span = w[index + 1] - w[index]
        t = (dense_w - w[index]) / span
        h00, h10 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t
        h01, h11 = -2 * t**3 + 3 * t**2, t**3 - t**2
        columns.append(h00 * values[index] + h10 * span * tangents[index] + h01 * values[index + 1] + h11 * span * tangents[index + 1])
    return dense_w.astype(np.float32), [column.astype(np.float32) for column in columns]


def loft(origin, rot, stations, power: float = 2.0, cap: float = 0.0) -> Prim:
    """Lofted body: super-elliptical sections ``(w, ru, rv[, cu, cv])`` along local W.

    ``power`` 2 is an ellipse; larger values square the section like a ribcage.
    ``cap`` rounds the flat ends. Radii may taper to a small value to dome an end.
    """
    c = vec(origin)
    data = np.asarray(stations, dtype=np.float64)
    if data.shape[1] == 3:
        data = np.concatenate([data, np.zeros((len(data), 2))], axis=1)
    table_w, (table_ru, table_rv, table_cu, table_cv) = _profile_table(data)
    w0, w1 = float(table_w[0]), float(table_w[-1])
    reach_u = float(np.max(np.abs(data[:, 3]) + data[:, 1]))
    reach_v = float(np.max(np.abs(data[:, 4]) + data[:, 2]))

    def fn(X, Y, Z):
        u, v, w = _local(X, Y, Z, c, rot)
        shape = np.broadcast(u, v, w).shape
        wc = np.clip(w, w0, w1)
        ru = np.interp(wc, table_w, table_ru).astype(np.float32)
        rv = np.interp(wc, table_w, table_rv).astype(np.float32)
        cu = np.interp(wc, table_w, table_cu).astype(np.float32)
        cv = np.interp(wc, table_w, table_cv).astype(np.float32)
        pu, pv = np.abs(u - cu) / ru, np.abs(v - cv) / rv
        if power == 2.0:
            rho = np.sqrt(pu * pu + pv * pv)
        else:
            rho = (pu ** F32(power) + pv ** F32(power)) ** F32(1.0 / power)
        radial = (rho - F32(1.0)) * np.minimum(ru, rv)
        axial = np.maximum(F32(w0) - w, w - F32(w1))
        result = smax(radial, axial, cap)
        return np.broadcast_to(result, shape) if result.shape != shape else result

    extent = _rotated_extent(rot, (reach_u, reach_v, 0.0))
    ends = np.stack([c + rot[:, 2] * w0, c + rot[:, 2] * w1])
    return Prim(ends.min(axis=0) - extent, ends.max(axis=0) + extent, fn)


def tube(points, radii) -> list[Prim]:
    """Round-cone chain through ``points``; join the segments with a soft union."""
    pts = [vec(point) for point in points]
    if np.isscalar(radii):
        radii = [float(radii)] * len(pts)
    return [rcone(pts[index], pts[index + 1], radii[index], radii[index + 1]) for index in range(len(pts) - 1)]


def spline(points, samples: int = 12):
    """Catmull-Rom resampling of a polyline into ``samples`` segments per span."""
    pts = [vec(point) for point in points]
    padded = [pts[0] * 2 - pts[1], *pts, pts[-1] * 2 - pts[-2]]
    out = []
    for index in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[index - 1], padded[index], padded[index + 1], padded[index + 2]
        for step in range(samples):
            t = step / samples
            out.append(
                0.5
                * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t**3)
            )
    out.append(pts[-1])
    return out


# --------------------------------------------------------------------------
# Volume and layers
# --------------------------------------------------------------------------


class Volume:
    """Voxel grid holding the sculpted field and the material that owns each voxel."""

    def __init__(self, lo, hi, voxel: float, margin: float = 0.03):
        self.h = float(voxel)
        self.lo = vec(lo)
        counts = np.ceil((vec(hi) - self.lo) / self.h).astype(int) + 1
        self.shape = tuple(int(count) for count in counts)
        self.hi = self.lo + self.h * (counts - 1)
        self.ax = [(self.lo[axis] + self.h * np.arange(self.shape[axis])).astype(np.float32) for axis in range(3)]
        self.d = np.full(self.shape, FAR, dtype=np.float32)
        self.m = np.zeros(self.shape, dtype=np.uint8)
        self.margin = float(margin)

    def window(self, lo, hi):
        start = np.floor((vec(lo) - self.lo) / self.h).astype(int)
        stop = np.ceil((vec(hi) - self.lo) / self.h).astype(int) + 1
        start = np.clip(start, 0, self.shape)
        stop = np.clip(stop, 0, self.shape)
        if np.any(stop - start <= 0):
            return None
        return tuple((int(start[axis]), int(stop[axis])) for axis in range(3))

    def coords(self, win):
        (x0, x1), (y0, y1), (z0, z1) = win
        return self.ax[0][x0:x1][:, None, None], self.ax[1][y0:y1][None, :, None], self.ax[2][z0:z1][None, None, :]

    def layer(self) -> "Layer":
        return Layer(self)

def _view(array, win, base=((0, 0), (0, 0), (0, 0))):
    (x0, x1), (y0, y1), (z0, z1) = win
    bx, by, bz = base[0][0], base[1][0], base[2][0]
    return array[x0 - bx : x1 - bx, y0 - by : y1 - by, z0 - bz : z1 - bz]


def _evaluate(prim: Prim, volume: Volume, win):
    values = prim.fn(*volume.coords(win))
    shape = tuple(stop - start for start, stop in win)
    if values.shape != shape:
        values = np.broadcast_to(values, shape)
    return values.astype(np.float32, copy=False)


def _intersect(win_a, win_b):
    out = tuple((max(a[0], b[0]), min(a[1], b[1])) for a, b in zip(win_a, win_b, strict=True))
    return None if any(stop <= start for start, stop in out) else out


class Layer:
    """One clay mass sculpted in isolation, then pressed into the volume.

    Operations are recorded and replayed once the bounding window is known,
    so every primitive is only evaluated inside its own neighbourhood.
    """

    def __init__(self, volume: Volume):
        self.vol = volume
        self.ops = []
        self.win = None
        self.d = None

    # -- recording ---------------------------------------------------------
    def add(self, prim, k: float = 0.0) -> "Layer":
        for item in prim if isinstance(prim, (list, tuple)) else (prim,):
            self.ops.append(("add", item, float(k)))
        return self

    def add_sym(self, factory, k: float = 0.0) -> "Layer":
        """Add ``factory(side)`` for the right (-1) and left (+1) side of the figure."""
        for side in (-1.0, 1.0):
            self.add(factory(side), k)
        return self

    def cut(self, prim, k: float = 0.0) -> "Layer":
        for item in prim if isinstance(prim, (list, tuple)) else (prim,):
            self.ops.append(("cut", item, float(k)))
        return self

    def cut_sym(self, factory, k: float = 0.0) -> "Layer":
        for side in (-1.0, 1.0):
            self.cut(factory(side), k)
        return self

    def clip(self, prim: Prim, k: float = 0.0) -> "Layer":
        self.ops.append(("clip", prim, float(k)))
        return self

    def warp(self, fn, lo=None, hi=None) -> "Layer":
        """In-place edit ``fn(d, X, Y, Z) -> d`` over a world-space box (or the whole layer)."""
        self.ops.append(("warp", fn, (None if lo is None else vec(lo), None if hi is None else vec(hi))))
        return self

    def inflate(self, amount: float) -> "Layer":
        self.ops.append(("inflate", float(amount), None))
        return self

    def blend(self, other: "Layer", k: float = 0.0) -> "Layer":
        """Smooth-union a separately sculpted layer (kept with its own carving)."""
        self.ops.append(("layer", other, float(k)))
        return self

    # -- evaluation --------------------------------------------------------
    def _bounds(self):
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        for op, item, extra in self.ops:
            if op == "add":
                pad = max(self.vol.margin, extra * 1.5)
                lo, hi = np.minimum(lo, item.lo - pad), np.maximum(hi, item.hi + pad)
            elif op == "layer":
                child_lo, child_hi = item._bounds()
                lo, hi = np.minimum(lo, child_lo), np.maximum(hi, child_hi)
        if not np.all(np.isfinite(lo)):
            raise RuntimeError("Layer has no additive primitives")
        return lo, hi

    def bake(self) -> "Layer":
        if self.d is not None:
            return self
        vol = self.vol
        lo, hi = self._bounds()
        self.win = vol.window(lo, hi)
        if self.win is None:
            raise RuntimeError("Layer lies outside the volume")
        self.d = np.full(tuple(stop - start for start, stop in self.win), FAR, dtype=np.float32)
        for op, item, extra in self.ops:
            if op == "add":
                pad = max(vol.margin, extra * 1.5)
                raw = vol.window(item.lo - pad, item.hi + pad)
                win = _intersect(raw, self.win) if raw else None
                if win is None:
                    continue
                view = _view(self.d, win, self.win)
                view[...] = smin(view, _evaluate(item, vol, win), extra)
            elif op == "cut":
                raw = vol.window(item.lo - extra, item.hi + extra)
                win = _intersect(raw, self.win) if raw else None
                if win is None:
                    continue
                view = _view(self.d, win, self.win)
                view[...] = smax(view, -_evaluate(item, vol, win), extra)
            elif op == "clip":
                self.d[...] = smax(self.d, _evaluate(item, vol, self.win), extra)
            elif op == "inflate":
                self.d -= F32(item)
            elif op == "warp":
                box_lo, box_hi = extra
                win = self.win
                if box_lo is not None:
                    raw = vol.window(box_lo, box_hi)
                    win = _intersect(raw, self.win) if raw else None
                if win is None:
                    continue
                view = _view(self.d, win, self.win)
                view[...] = item(view, *vol.coords(win))
            elif op == "layer":
                item.bake()
                win = _intersect(item.win, self.win)
                if win is None:
                    continue
                view = _view(self.d, win, self.win)
                view[...] = smin(view, _view(item.d, win, item.win), extra)
        return self

    def merge(self, material: int, k: float = 0.0) -> "Layer":
        """Press this mass into the volume; it owns the voxels where it sits proud."""
        self.bake()
        vol = self.vol
        field = _view(vol.d, self.win)
        _view(vol.m, self.win)[self.d < field] = material
        field[...] = smin(field, self.d, k)
        return self


# --------------------------------------------------------------------------
# Meshing and per-vertex sampling
# --------------------------------------------------------------------------


def extract_field(field, origin, voxel: float, band_voxels: float = 3.0):
    """Polygonise the zero level set of ``field`` with OpenVDB. Returns ``(points, quads)``."""
    import openvdb as vdb

    band = float(band_voxels * voxel)
    clipped = np.clip(field, -band, band)
    grid = vdb.FloatGrid(band)
    grid.copyFromArray(clipped, tolerance=0.0)
    points, quads = grid.convertToQuads(isovalue=0.0)
    world = points.astype(np.float64) * voxel + vec(origin)
    return world.astype(np.float32), quads.astype(np.int32)


def extract_layer(layer: "Layer", band_voxels: float = 3.0):
    """Mesh one baked layer on its own, so each painted mass keeps a crisp outline."""
    layer.bake()
    volume = layer.vol
    origin = [volume.ax[axis][layer.win[axis][0]] for axis in range(3)]
    return extract_field(layer.d, origin, volume.h, band_voxels)


def sample_layer(layer: "Layer", points):
    """Trilinear lookup of a baked layer's field; FAR outside its window."""
    layer.bake()
    volume = layer.vol
    start = np.array([layer.win[axis][0] for axis in range(3)], dtype=np.float64)
    p = (np.asarray(points, dtype=np.float64) - volume.lo) / volume.h - start
    limit = np.asarray(layer.d.shape) - 1.001
    inside = np.all((p >= 0.0) & (p <= limit), axis=1)
    out = np.full(len(p), FAR, dtype=np.float32)
    if np.any(inside):
        q = p[inside]
        i = np.floor(q).astype(np.int64)
        f = (q - i).astype(np.float32)
        x0, y0, z0 = i[:, 0], i[:, 1], i[:, 2]
        x1, y1, z1 = x0 + 1, y0 + 1, z0 + 1
        fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
        d = layer.d
        c00 = d[x0, y0, z0] * (1 - fx) + d[x1, y0, z0] * fx
        c10 = d[x0, y1, z0] * (1 - fx) + d[x1, y1, z0] * fx
        c01 = d[x0, y0, z1] * (1 - fx) + d[x1, y0, z1] * fx
        c11 = d[x0, y1, z1] * (1 - fx) + d[x1, y1, z1] * fx
        out[inside] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz
    return out


def sample(volume: Volume, array, points):
    """Trilinear lookup of a voxel array at world-space ``points``."""
    p = (np.asarray(points, dtype=np.float64) - volume.lo) / volume.h
    limit = np.asarray(array.shape) - 1.001
    outside = np.any((p < 0.0) | (p > limit), axis=1)
    p = np.clip(p, 0.0, limit)
    i = np.floor(p).astype(np.int64)
    f = (p - i).astype(np.float32)
    x0, y0, z0 = i[:, 0], i[:, 1], i[:, 2]
    x1, y1, z1 = x0 + 1, y0 + 1, z0 + 1
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    c00 = array[x0, y0, z0] * (1 - fx) + array[x1, y0, z0] * fx
    c10 = array[x0, y1, z0] * (1 - fx) + array[x1, y1, z0] * fx
    c01 = array[x0, y0, z1] * (1 - fx) + array[x1, y0, z1] * fx
    c11 = array[x0, y1, z1] * (1 - fx) + array[x1, y1, z1] * fx
    out = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz
    out[outside] = FAR
    return out


def _tangent_frames(normals):
    helper = np.where(np.abs(normals[:, 2:3]) < 0.9, np.array([[0.0, 0.0, 1.0]]), np.array([[1.0, 0.0, 0.0]]))
    tangent = np.cross(helper, normals)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
    return tangent, np.cross(normals, tangent)


def ambient_occlusion(volume: Volume, points, normals, radii=(0.006, 0.014, 0.03), cone: float = 0.62):
    """Cone-traced occlusion read straight from the distance field (0 = open, 1 = buried)."""
    points = np.asarray(points, dtype=np.float64)
    normals = np.asarray(normals, dtype=np.float64)
    tangent, bitangent = _tangent_frames(normals)
    directions = [normals]
    for step in range(6):
        angle = step * math.pi / 3
        lateral = tangent * math.cos(angle) + bitangent * math.sin(angle)
        directions.append(normals * math.sqrt(1 - cone * cone) + lateral * cone)
    total = np.zeros(len(points), dtype=np.float32)
    weight_sum = 0.0
    for index, radius in enumerate(radii):
        weight = 1.0 / (1.6**index)
        for direction_index, direction in enumerate(directions):
            direction_weight = weight * (1.4 if direction_index == 0 else 1.0)
            distance = sample(volume, volume.d, points + direction * radius)
            # Open space reads back the travelled distance (or FAR outside every margin).
            total += direction_weight * np.clip(1.0 - distance / radius, 0.0, 1.0).astype(np.float32)
            weight_sum += direction_weight
    return total / weight_sum


def value_noise(points, scale: float, seed: int = 0):
    """Deterministic trilinear value noise in [0, 1] for clay mottling."""
    p = np.asarray(points, dtype=np.float64) * scale
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)

    def corner(dx, dy, dz):
        n = (i[:, 0] + dx) * 374761393 + (i[:, 1] + dy) * 668265263 + (i[:, 2] + dz) * 2147483647 + seed * 144269504
        n = (n ^ (n >> 13)) * 1274126177
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

    c00 = corner(0, 0, 0) * (1 - f[:, 0]) + corner(1, 0, 0) * f[:, 0]
    c10 = corner(0, 1, 0) * (1 - f[:, 0]) + corner(1, 1, 0) * f[:, 0]
    c01 = corner(0, 0, 1) * (1 - f[:, 0]) + corner(1, 0, 1) * f[:, 0]
    c11 = corner(0, 1, 1) * (1 - f[:, 0]) + corner(1, 1, 1) * f[:, 0]
    return ((c00 * (1 - f[:, 1]) + c10 * f[:, 1]) * (1 - f[:, 2]) + (c01 * (1 - f[:, 1]) + c11 * f[:, 1]) * f[:, 2]).astype(np.float32)
