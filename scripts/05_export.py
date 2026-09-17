"""
ETAPA 05 - Export GLB + JSON de estados.

O JSON e escrito em dois espacos e VERIFICADO contra os nos reais do GLB,
para que o front-end nao precise adivinhar convencao:

  blender_z_up : Z para cima (espaco nativo do .blend)
  gltf_y_up    : Y para cima (x, z, -y) - convencao glTF / Three.js

Depois do export lemos o chunk JSON do proprio GLB, comparamos os dois blocos
com o TRS local de cada no e marcamos em "glb_node_space" qual deles casa.
Rotacao canonica = quaternion [x, y, z, w]. Euler e apenas debug.
"""
import json
import math
import struct
from pathlib import Path

import bpy
import mathutils
from mathutils import Matrix, Quaternion, Vector

import j3f_config as cfg
from j3f_util import step, log, warn, WARNINGS

YUP = Matrix.Rotation(math.radians(-90.0), 4, 'X')
YUP_Q = YUP.to_quaternion()


def to_yup_loc(v):
    return tuple(YUP @ Vector(v))


def to_yup_quat(q_xyzw):
    q = Quaternion((q_xyzw[3], q_xyzw[0], q_xyzw[1], q_xyzw[2]))
    r = YUP_Q @ q @ YUP_Q.inverted()
    return (r.x, r.y, r.z, r.w)


def euler_of(q_xyzw):
    q = Quaternion((q_xyzw[3], q_xyzw[0], q_xyzw[1], q_xyzw[2]))
    return tuple(q.to_euler('XYZ'))


def run(ctx):
    step("05 - Export GLB + JSON")

    export_dir = Path(ctx["project"]) / cfg.EXPORT_DIR
    export_dir.mkdir(parents=True, exist_ok=True)
    glb_path = export_dir / cfg.GLB_NAME
    json_path = export_dir / cfg.JSON_NAME

    scene = bpy.context.scene
    root = scene.objects[ctx["root"]]

    for o in scene.objects:
        o.select_set(False)
    root.select_set(True)
    for name in ctx["order"]:
        scene.objects[name].select_set(True)
    bpy.context.view_layer.objects.active = root

    # O Roughness esta ligado a um noise procedural (para o render em Cycles).
    # O exportador glTF nao converte isso e simplesmente OMITE roughnessFactor,
    # cujo default no glTF e 1.0 - ou seja, o GLB chegaria no Three.js como
    # metal fosco. Desligamos o noise so durante o export.
    detached = _detach_procedural_roughness()
    log("roughness procedural desligada em %d material(is) para o export" % len(detached))
    try:
        _export_glb(glb_path)
    finally:
        _reattach(detached)

    size = glb_path.stat().st_size
    log("GLB: %s (%.2f KB / %.3f MB)" % (glb_path.name, size / 1024, size / 1024 / 1024))

    glb_nodes = _read_glb_nodes(glb_path)
    _check_glb_material(glb_path)
    log("nos no GLB: %d -> %s" % (len(glb_nodes), sorted(glb_nodes.keys())[:4] + ["..."]))

    # ------------------------------------------------------------------
    # Monta os dois espacos
    # ------------------------------------------------------------------
    pieces = []
    for idx, name in enumerate(ctx["order"]):
        e, s = ctx["end"][name], ctx["start"][name]
        entry = {
            "name": name,
            "index": idx,
            "half": "top" if name[-2] == "T" else "bottom",
            "column": int(name[-1]),
            "delay": ctx["delays"][name],
            "end": {
                "gltf_y_up": _trs(to_yup_loc(e["location"]), to_yup_quat(e["quaternion"]), e["scale"]),
                "blender_z_up": _trs(e["location"], e["quaternion"], e["scale"]),
            },
            "start": {
                "gltf_y_up": _trs(to_yup_loc(s["location"]), to_yup_quat(s["quaternion"]), s["scale"]),
                "blender_z_up": _trs(s["location"], s["quaternion"], s["scale"]),
            },
        }
        pieces.append(entry)

    # ------------------------------------------------------------------
    # Verificacao: qual espaco casa com o TRS local dos nos do GLB?
    # ------------------------------------------------------------------
    dev = {"gltf_y_up": 0.0, "blender_z_up": 0.0}
    missing = []
    for p in pieces:
        node = glb_nodes.get(p["name"])
        if node is None:
            missing.append(p["name"])
            continue
        for space in dev:
            ref = p["end"][space]
            dev[space] = max(dev[space], _deviation(node, ref))
    if missing:
        warn("pecas ausentes no GLB: %s" % missing)

    node_space = min(dev, key=dev.get)
    log("desvio END vs. nos do GLB -> gltf_y_up=%.3e  blender_z_up=%.3e" %
        (dev["gltf_y_up"], dev["blender_z_up"]))
    log("espaco dos nos do GLB: %s" % node_space)
    if dev[node_space] > 1e-4:
        warn("nenhum espaco casou com o GLB (min desvio %.3e)" % dev[node_space])

    root_node = glb_nodes.get(cfg.ROOT_NAME)
    if root_node:
        log("no root no GLB: T=%s R=%s S=%s" %
            (_r(root_node["t"]), _r(root_node["r"]), _r(root_node["s"])))

    sbb = ctx["solid_bbox"]
    doc = {
        "meta": {
            "project": "J3F",
            "asset": "j3f-symbol",
            "generated_by": "Blender %s" % bpy.app.version_string,
            "pipeline": "svg -> curves -> extrude+bevel -> mesh -> metal -> start/end -> glb+json",
            "source_svg": cfg.SVG_FILENAME,
            "svg_viewBox": list(cfg.SVG_VIEWBOX),
            "seed": cfg.SEED,
            "units": "blender units (1 BU); simbolo normalizado para altura %.1f" % cfg.TARGET_HEIGHT,
        },
        "conventions": {
            "rotation_canonical": "quaternion [x, y, z, w]",
            "rotation_euler": "auxiliar/debug apenas - radianos, ordem XYZ",
            "spaces": {
                "gltf_y_up": "Y para cima, convencao glTF/Three.js (x, z, -y do Blender)",
                "blender_z_up": "Z para cima, espaco nativo do .blend",
            },
            "glb_node_space": node_space,
            "glb_node_space_note":
                "Use o bloco '%s': ele reproduz exatamente o TRS local dos nos "
                "do GLB, relativo ao root '%s'." % (node_space, cfg.ROOT_NAME),
            "transforms_are": "locais, relativos ao root",
        },
        "symbol": {
            "root": cfg.ROOT_NAME,
            "piece_count": len(pieces),
            "piece_names": [p["name"] for p in pieces],
            "height_bu": cfg.TARGET_HEIGHT,
            "width_bu": round(ctx["symbol_size"][0], 6),
            "thickness_bu": cfg.THICKNESS,
            "bevel_bu": cfg.BEVEL,
            "aspect_svg_viewbox": round(cfg.SVG_VIEWBOX[2] / cfg.SVG_VIEWBOX[3], 9),
            "aspect_svg_geometry": round(ctx["source_bbox"][0] / ctx["source_bbox"][1], 9),
            "aspect_3d": round(ctx["symbol_size"][0] / ctx["symbol_size"][1], 9),
            "aspect_note":
                "o 3D preserva o aspecto da GEOMETRIA dos paths, nao o do viewBox: "
                "o viewBox 307x359 tem ~0.9px de folga a direita e ~0.5px embaixo "
                "onde nenhum path chega",
            "bbox_blender_z_up": {"min": list(sbb[0]), "max": list(sbb[1])},
            "silhouette_max_error_bu": ctx["silhouette_max_error"],
        },
        "animation": {
            "model": "interpolacao start->end por peca, dirigida por progresso de scroll (0..1)",
            "recommended_easing": ctx["modules"]["04_states"].EASING_NAME,
            "stagger": {
                "max_delay_fraction": cfg.MAX_DELAY,
                "formula": "tLocal = clamp((t - delay*max_delay_fraction) / (1 - delay*max_delay_fraction), 0, 1)",
                "note": "colunas centrais chegam primeiro; as externas fecham a silhueta",
            },
            "rotation_interpolation": "slerp entre os quaternions start e end",
            "end_state_is_official_symbol": True,
        },
        "verification": {
            "glb_node_deviation": {k: v for k, v in dev.items()},
            "silhouette_max_error_bu": ctx["silhouette_max_error"],
            "aspect_error": round(abs(ctx["symbol_size"][0] / ctx["symbol_size"][1]
                                      - ctx["source_bbox"][0] / ctx["source_bbox"][1]), 12),
            "welded_control_points": ctx.get("welded_points", 0),
            "weld_max_shift_px": round(ctx.get("weld_max_shift_bu", 0.0)
                                       / cfg.TARGET_HEIGHT * cfg.SVG_VIEWBOX[3], 6),
            "pieces_found_in_glb": len(pieces) - len(missing),
        },
        "geometry": ctx["poly"],
        "materials": ctx["materials"],
        "pieces": pieces,
    }

    json_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False))
    log("JSON: %s (%.1f KB)" % (json_path.name, json_path.stat().st_size / 1024))

    ctx["glb_path"] = str(glb_path)
    ctx["glb_size"] = size
    ctx["json_path"] = str(json_path)
    ctx["node_space"] = node_space
    ctx["glb_deviation"] = dev
    return ctx


# ---------------------------------------------------------------------------


def _export_glb(glb_path):
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_yup=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )


def _detach_procedural_roughness():
    """Desconecta o noise do socket Roughness e fixa o valor base."""
    detached = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            sock = node.inputs.get("Roughness")
            if sock is None or not sock.is_linked:
                continue
            link = sock.links[0]
            # valor base = meio da faixa do Map Range que alimentava o socket
            src = link.from_node
            if src.type == 'MAP_RANGE':
                base = (src.inputs["To Min"].default_value
                        + src.inputs["To Max"].default_value) * 0.5
            else:
                base = sock.default_value
            detached.append((mat, link.from_socket, sock, sock.default_value))
            mat.node_tree.links.remove(link)
            sock.default_value = base
    return detached


def _reattach(detached):
    for mat, from_socket, to_socket, old_value in detached:
        mat.node_tree.links.new(from_socket, to_socket)
        to_socket.default_value = old_value


def _check_glb_material(glb_path):
    """Confere que o material do GLB carrega metal/roughness utilizaveis."""
    data = Path(glb_path).read_bytes()
    off = 12
    gltf = None
    while off < len(data):
        clen, ctype = struct.unpack("<I4s", data[off:off + 8])
        if ctype == b"JSON":
            gltf = json.loads(data[off + 8: off + 8 + clen].decode("utf-8"))
            break
        off += 8 + clen + (-clen % 4)
    for m in gltf.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        metal = pbr.get("metallicFactor", 1.0)     # default glTF
        rough = pbr.get("roughnessFactor", 1.0)    # default glTF
        log("material no GLB '%s': metallic=%.3f roughness=%.3f baseColor=%s"
            % (m.get("name"), metal, rough,
               [round(c, 4) for c in pbr.get("baseColorFactor", [1, 1, 1, 1])[:3]]))
        if metal < 0.9:
            warn("metallicFactor=%.3f no GLB - o simbolo nao vai ler como metal" % metal)
        if rough > 0.6:
            warn("roughnessFactor=%.3f no GLB - metal fosco demais; era para ser polido"
                 % rough)


def _r(v, n=6):
    return [round(float(x), n) for x in v]


def _trs(loc, quat, scale):
    return {
        "position": _r(loc),
        "quaternion": _r(quat),
        "scale": _r(scale),
        "euler_xyz_debug": _r(euler_of(quat)),
    }


def _deviation(node, ref):
    d = 0.0
    for a, b in zip(node["t"], ref["position"]):
        d = max(d, abs(a - b))
    qa, qb = list(node["r"]), list(ref["quaternion"])
    # quaternion e seu negativo representam a mesma rotacao
    flip = min(max(abs(a - b) for a, b in zip(qa, qb)),
               max(abs(a + b) for a, b in zip(qa, qb)))
    d = max(d, flip)
    for a, b in zip(node["s"], ref["scale"]):
        d = max(d, abs(a - b))
    return d


def _read_glb_nodes(path):
    """Le o chunk JSON do GLB e devolve o TRS local de cada no, por nome."""
    data = Path(path).read_bytes()
    magic, version, _ = struct.unpack("<4sII", data[:12])
    if magic != b"glTF":
        raise ValueError("GLB invalido")
    off = 12
    gltf = None
    while off < len(data):
        clen, ctype = struct.unpack("<I4s", data[off:off + 8])
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            gltf = json.loads(chunk.decode("utf-8"))
            break
        off += 8 + clen + (-clen % 4)
    out = {}
    for n in gltf.get("nodes", []):
        name = n.get("name", "")
        if "matrix" in n:
            m = mathutils.Matrix([n["matrix"][i::4] for i in range(4)])
            t, r, s = m.decompose()
            out[name] = {"t": tuple(t), "r": (r.x, r.y, r.z, r.w), "s": tuple(s)}
        else:
            out[name] = {
                "t": tuple(n.get("translation", (0.0, 0.0, 0.0))),
                "r": tuple(n.get("rotation", (0.0, 0.0, 0.0, 1.0))),
                "s": tuple(n.get("scale", (1.0, 1.0, 1.0))),
            }
    return out
