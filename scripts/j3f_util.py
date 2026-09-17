"""J3F - helpers compartilhados (log, cor, bbox)."""
import bpy
import mathutils

_STEP = [""]


def step(name):
    _STEP[0] = name
    print("\n" + "=" * 72)
    print("[J3F] " + name)
    print("=" * 72)


def log(msg):
    print("   " + str(msg))


WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)
    print("   !! WARNING: " + str(msg))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_str):
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return tuple(srgb_to_linear(v) for v in (r, g, b))


def evaluated_points(obj, depsgraph):
    """Vertices do objeto ja avaliado, em world space (exato, nao control hull)."""
    ev = obj.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(ev)
    mw = obj.matrix_world
    pts = [mw @ v.co.copy() for v in me.vertices]
    bpy.data.meshes.remove(me)
    return pts


def bbox_of(points):
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    zs = [p.z for p in points]
    lo = mathutils.Vector((min(xs), min(ys), min(zs)))
    hi = mathutils.Vector((max(xs), max(ys), max(zs)))
    return lo, hi


def objects_bbox(objs, depsgraph):
    pts = []
    for o in objs:
        pts.extend(evaluated_points(o, depsgraph))
    return bbox_of(pts)
