"""
ETAPA 02 - Espessura + bevel + conversao para mesh.

Preservacao da forma oficial (exata por construcao):

  1. A curva e extrudada SEM bevel e SEM offset -> prisma reto cuja silhueta
     e, ponto a ponto, o proprio path do SVG.
  2. O arredondamento e feito depois, na malha, apenas nas arestas do
     PERIMETRO (as que separam uma tampa frontal/traseira de uma parede
     lateral). Um bevel de malha corta material para dentro: ele nunca
     empurra a silhueta para fora, e as paredes laterais continuam
     exatamente sobre o contorno original.
  3. As arestas verticais de quina NAO sao chanfradas - elas e que definem a
     silhueta nos cantos das laminas.

Resultado: highlight rolando na quina (a leitura metalica) com silhueta,
proporcoes, distancias e curvas internas intactas.

Obs.: o bevel de curva do Blender foi descartado de proposito - `Curve.offset`
falha em dois paths do SVG que terminam com um segmento degenerado de 0.015px
(`...V357.077Z`), o que introduzia um erro de 0.005 BU em uma lamina.
"""
import bpy
import bmesh
import mathutils
from mathutils import Matrix

import j3f_config as cfg
from j3f_util import step, log, warn, evaluated_points, bbox_of, objects_bbox


def run(ctx):
    step("02 - Extrusao, bevel e conversao para mesh")

    scene = bpy.context.scene
    curves = sorted([o for o in scene.objects if o.type == 'CURVE'], key=lambda o: o.name)

    extrude = cfg.THICKNESS * 0.5
    log("extrude=%.5f (espessura total %.5f) | bevel de malha=%.5f em %d segmentos"
        % (extrude, cfg.THICKNESS, cfg.BEVEL, cfg.BEVEL_SEGMENTS))

    # Referencia da silhueta oficial: o preenchimento 2D antes de qualquer solidez
    dg = bpy.context.evaluated_depsgraph_get()
    ref = {o.name: bbox_of(evaluated_points(o, dg)) for o in curves}

    for o in curves:
        cu = o.data
        cu.dimensions = '2D'
        cu.fill_mode = 'BOTH'
        cu.resolution_u = cfg.RESOLUTION_U
        cu.extrude = extrude
        cu.bevel_depth = 0.0
        cu.offset = 0.0

    # ------------------------------------------------------------------
    # Curve -> Mesh (via depsgraph, sem operadores: robusto em background)
    # ------------------------------------------------------------------
    meshes = []
    stats = {"verts": 0, "faces": 0, "tris": 0, "beveled_edges": 0, "degenerate_faces": 0,
             "bevel_faces": 0}
    for o in curves:
        name = o.name
        mw = o.matrix_world.copy()
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        me.name = name + "_data"

        bpy.data.objects.remove(o, do_unlink=True)

        # agora que virou mesh, a rotacao "em pe" pode ser assada nos dados
        me.transform(mw)
        new = bpy.data.objects.new(name, me)
        new.matrix_world = Matrix.Identity(4)
        scene.collection.objects.link(new)

        s = _solidify_mesh(me)
        for k in stats:
            stats[k] += s[k]
        meshes.append(new)

    meshes.sort(key=lambda o: o.name)
    log("convertidos: %d meshes | %d verts | %d faces | %d tris | %d arestas chanfradas"
        % (len(meshes), stats["verts"], stats["faces"], stats["tris"], stats["beveled_edges"]))
    log("faces degeneradas removidas: %d" % stats["degenerate_faces"])

    # ------------------------------------------------------------------
    # Origem de cada peca no centro do seu proprio bounding box.
    # Isso nao move nada no mundo: compensamos nos dados da mesh.
    # ------------------------------------------------------------------
    for o in meshes:
        lo, hi = bbox_of([v.co.copy() for v in o.data.vertices])
        c = (lo + hi) * 0.5
        o.data.transform(Matrix.Translation(-c))
        o.matrix_world = Matrix.Translation(c)
        o.rotation_mode = 'QUATERNION'

    # ------------------------------------------------------------------
    # Validacao da silhueta contra a referencia
    # ------------------------------------------------------------------
    dg = bpy.context.evaluated_depsgraph_get()
    max_err, worst = 0.0, ""
    for o in meshes:
        lo, hi = bbox_of(evaluated_points(o, dg))
        rlo, rhi = ref[o.name]
        deltas = (lo.x - rlo.x, hi.x - rhi.x, lo.z - rlo.z, hi.z - rhi.z)
        if ctx.get("verbose_silhouette"):
            log("%-14s dx0=%+.6f dx1=%+.6f dz0=%+.6f dz1=%+.6f" % ((o.name,) + deltas))
        for d in deltas:
            if abs(d) > max_err:
                max_err, worst = abs(d), o.name
    log("desvio maximo da silhueta vs. curva original: %.3e BU (%s) = %.4f px do SVG"
        % (max_err, worst, max_err / cfg.TARGET_HEIGHT * cfg.SVG_VIEWBOX[3]))
    tol = cfg.TARGET_HEIGHT * 5e-4
    if max_err > tol:
        warn("silhueta desviou %.3e BU (tolerancia %.3e)" % (max_err, tol))
    ctx["silhouette_max_error"] = max_err

    lo, hi = objects_bbox(meshes, dg)
    log("bbox solido: X[%+.4f..%+.4f] Y[%+.4f..%+.4f] Z[%+.4f..%+.4f]"
        % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
    log("espessura medida em Y: %.5f BU" % (hi.y - lo.y))

    ctx["poly"] = {"verts": stats["verts"], "faces": stats["faces"], "tris": stats["tris"]}
    ctx["solid_bbox"] = ((lo.x, lo.y, lo.z), (hi.x, hi.y, hi.z))
    return ctx


def _solidify_mesh(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=cfg.MERGE_DISTANCE)
    # salvaguarda: preenchimentos 2D do Blender podem deixar faces de area nula
    dead = [f for f in bm.faces if f.calc_area() < 1e-10]
    n_dead = len(dead)
    if dead:
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=cfg.MERGE_DISTANCE)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # arestas do perimetro: exatamente uma face de tampa (normal ~ +-Y)
    rim = []
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        caps = sum(1 for f in e.link_faces if abs(f.normal.y) > cfg.CAP_NORMAL_TOL)
        if caps == 1:
            rim.append(e)

    bevel_faces = set()
    if rim:
        res = bmesh.ops.bevel(
            bm, geom=rim,
            offset=cfg.BEVEL, offset_type='OFFSET',
            segments=cfg.BEVEL_SEGMENTS, profile=0.5,
            affect='EDGES', clamp_overlap=True, loop_slide=True,
            miter_outer='SHARP', miter_inner='SHARP',
        )
        bevel_faces = {f for f in res.get("faces", []) if f.is_valid}
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # Shading: so a fita do bevel e suave. As tampas e as paredes laterais
    # ficam CHAPADAS - e isso que separa "metal usinado" de "plastico amassado":
    # face lisa, fio de luz rolando na quina.
    for f in bm.faces:
        f.smooth = f in bevel_faces
    for e in bm.edges:
        e.smooth = True

    out = {
        "verts": len(bm.verts),
        "faces": len(bm.faces),
        "tris": sum(len(f.verts) - 2 for f in bm.faces),
        "beveled_edges": len(rim),
        "bevel_faces": len(bevel_faces),
        "degenerate_faces": n_dead,
    }
    bm.to_mesh(me)
    bm.free()
    me.update()
    return out
