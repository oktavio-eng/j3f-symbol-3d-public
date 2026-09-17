"""
ETAPA 01 - Importa j3f-symbol.svg, normaliza escala/posicao, coloca o simbolo
em pe e renomeia as 14 laminas de forma estavel e deterministica.

Nao fragmenta, nao subdivide, nao altera a forma: apenas transforma o conjunto
inteiro por uma unica matriz uniforme (escala + rotacao + translacao), o que
preserva proporcoes, distancias entre laminas, curvas internas e silhueta.
"""
import bpy
import mathutils
from mathutils import Matrix

import j3f_config as cfg
from j3f_util import step, log, warn, objects_bbox


def run(ctx):
    step("01 - Import SVG + normalizacao")

    # cena limpa
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0

    before = set(bpy.data.objects.keys())
    bpy.ops.import_curve.svg(filepath=str(ctx["svg_path"]))
    curves = [o for o in bpy.data.objects if o.name not in before]
    log("objetos importados: %d" % len(curves))
    if len(curves) != cfg.PIECE_COUNT:
        warn("esperado %d paths, importados %d" % (cfg.PIECE_COUNT, len(curves)))

    # A importacao cria uma colecao propria; movemos tudo para a colecao da cena.
    for o in curves:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        scene.collection.objects.link(o)
    for c in list(bpy.data.collections):
        if not c.objects and not c.children:
            bpy.data.collections.remove(c)

    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = objects_bbox(curves, dg)
    src_w, src_h = hi.x - lo.x, hi.y - lo.y
    log("bbox importado: %.6f x %.6f BU" % (src_w, src_h))

    svg_aspect = cfg.SVG_VIEWBOX[2] / cfg.SVG_VIEWBOX[3]
    imported_aspect = src_w / src_h
    log("aspect SVG=%.6f  importado=%.6f  delta=%.3e" %
        (svg_aspect, imported_aspect, abs(svg_aspect - imported_aspect)))

    factor = cfg.TARGET_HEIGHT / src_h
    center = (lo + hi) * 0.5
    log("fator de escala uniforme: %.6f" % factor)

    # Uma unica matriz uniforme para todo o conjunto: centraliza + escala.
    # ATENCAO: as curvas do SVG sao 2D; o Blender achata dados de curva 2D no
    # plano local XY. Por isso a rotacao "poe em pe" NAO entra nos dados aqui -
    # ela fica na matriz do objeto e so e assada na mesh na etapa 02.
    M = Matrix.Scale(factor, 4) @ Matrix.Translation(-center)
    stand = Matrix.Rotation(cfg.STAND_UP_X, 4, 'X')

    for o in curves:
        o.data.transform(M @ o.matrix_world)
        o.matrix_world = stand
        # Curve.transform() multiplica o 'radius' de cada ponto de controle pelo
        # fator de escala, e o bevel do Blender e multiplicado por esse radius.
        # Sem resetar, o bevel sairia 'factor' vezes maior que o pedido.
        for sp in o.data.splines:
            for pt in (sp.bezier_points if sp.type == 'BEZIER' else sp.points):
                pt.radius = 1.0
                pt.tilt = 0.0

    # solda de pontos de controle coincidentes (artefato do SVG, nao forma)
    welded, shift = 0, 0.0
    for o in curves:
        n, d = _weld_degenerate(o.data, cfg.WELD_TOL)
        if n:
            log("%s: %d ponto(s) de controle degenerado(s) soldado(s) "
                "(deslocamento maximo %.6f BU = %.4f px)"
                % (o.name if o.name.startswith("J3F") else o.name, n, d,
                   d / cfg.TARGET_HEIGHT * cfg.SVG_VIEWBOX[3]))
        welded += n
        shift = max(shift, d)
    log("total soldado: %d ponto(s); deslocamento maximo %.6f BU = %.4f px do SVG"
        % (welded, shift, shift / cfg.TARGET_HEIGHT * cfg.SVG_VIEWBOX[3]))
    ctx["welded_points"] = welded
    ctx["weld_max_shift_bu"] = shift

    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = objects_bbox(curves, dg)
    log("bbox normalizado: X[%.4f..%.4f] Y[%.4f..%.4f] Z[%.4f..%.4f]"
        % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
    log("dimensoes finais: %.4f (larg) x %.4f (alt) BU" % (hi.x - lo.x, hi.z - lo.z))

    # ------------------------------------------------------------------
    # Nomenclatura estavel: coluna 1..7 da esquerda para a direita,
    # metade T (topo, Z>0) / B (base, Z<0).
    # ------------------------------------------------------------------
    info = []
    for o in curves:
        pts = [p for p in _pts(o, dg)]
        blo, bhi = _bbox(pts)
        info.append({"obj": o, "lo": blo, "hi": bhi,
                     "cx": (blo.x + bhi.x) * 0.5, "cz": (blo.z + bhi.z) * 0.5})

    xs = sorted({round(i["cx"], 4) for i in info})
    cols = _cluster(xs, tol=0.02)
    if len(cols) != cfg.COLUMNS:
        warn("esperadas %d colunas, detectadas %d" % (cfg.COLUMNS, len(cols)))
    log("colunas detectadas: %d -> %s" % (len(cols), ["%.4f" % c for c in cols]))

    pieces = []
    for i in info:
        col = min(range(len(cols)), key=lambda k: abs(cols[k] - i["cx"])) + 1
        half = "T" if i["cz"] > 0 else "B"
        i["obj"].name = cfg.NAME_TEMPLATE.format(half=half, col=col)
        i["obj"].data.name = i["obj"].name + "_data"
        i["col"], i["half"] = col, half
        pieces.append(i)

    pieces.sort(key=lambda p: (p["half"], p["col"]))
    names = [p["obj"].name for p in pieces]
    if len(set(names)) != cfg.PIECE_COUNT:
        warn("nomes duplicados apos renomeacao: %s" % names)
    for p in pieces:
        log("%-14s col=%d half=%s  X[%+.4f..%+.4f] Z[%+.4f..%+.4f]  larg=%.4f alt=%.4f"
            % (p["obj"].name, p["col"], p["half"], p["lo"].x, p["hi"].x,
               p["lo"].z, p["hi"].z, p["hi"].x - p["lo"].x, p["hi"].z - p["lo"].z))

    ctx["scale_factor"] = factor
    ctx["source_bbox"] = (src_w, src_h)
    ctx["pieces_meta"] = [{"name": p["obj"].name, "col": p["col"], "half": p["half"]}
                          for p in pieces]
    ctx["symbol_size"] = (hi.x - lo.x, hi.z - lo.z)
    return ctx


def _pts(obj, dg):
    from j3f_util import evaluated_points
    return evaluated_points(obj, dg)


def _bbox(pts):
    from j3f_util import bbox_of
    return bbox_of(pts)


def _cluster(values, tol):
    out = []
    for v in sorted(values):
        if not out or abs(v - out[-1][-1]) > tol:
            out.append([v])
        else:
            out[-1].append(v)
    return [sum(g) / len(g) for g in out]


def _weld_degenerate(cu, tol):
    """Funde pontos de controle consecutivos separados por menos que `tol`.

    O ponto seguinte e removido e o anterior herda o handle_right dele, o que
    preserva exatamente a curva util e descarta apenas o segmento nulo.
    Devolve (quantos_removidos, maior_deslocamento).
    """
    data = []
    removed_total, max_d = 0, 0.0
    for sp in cu.splines:
        if sp.type != 'BEZIER':
            data.append(("OTHER", sp))
            continue
        pts = [[p.co.copy(), p.handle_left.copy(), p.handle_right.copy(),
                p.handle_left_type, p.handle_right_type, p.radius, p.tilt]
               for p in sp.bezier_points]
        cyclic, res = sp.use_cyclic_u, sp.resolution_u
        changed = True
        while changed and len(pts) > 3:
            changed = False
            m = len(pts)
            for a in range(m):
                b = (a + 1) % m
                if b == 0 and not cyclic:
                    continue
                d = (pts[a][0] - pts[b][0]).length
                if d < tol:
                    pts[a][2] = pts[b][2]          # herda o handle de saida
                    pts[a][4] = pts[b][4]
                    pts.pop(b)
                    removed_total += 1
                    max_d = max(max_d, d)
                    changed = True
                    break
        data.append(("BEZIER", pts, cyclic, res))

    if removed_total == 0:
        return 0, 0.0

    cu.splines.clear()
    for item in data:
        if item[0] == 'OTHER':
            continue
        _, pts, cyclic, res = item
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        sp.use_cyclic_u = cyclic
        sp.resolution_u = res
        for bp, (co, hl, hr, hlt, hrt, rad, tilt) in zip(sp.bezier_points, pts):
            bp.co = co
            bp.handle_left_type = 'FREE'
            bp.handle_right_type = 'FREE'
            bp.handle_left = hl
            bp.handle_right = hr
            bp.handle_left_type = hlt
            bp.handle_right_type = hrt
            bp.radius = rad
            bp.tilt = tilt
    return removed_total, max_d
