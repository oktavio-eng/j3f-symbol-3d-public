"""
ETAPA 03 - Materiais metalicos (variantes A e B), world, iluminacao e camera.

Tudo autoral: nenhum HDRI, textura, shader ou asset de terceiros.
O acabamento metalico vem de:
  - Metallic 1.0 + roughness baixa com micro-variacao procedural
  - um estudio escuro com gradiente vertical (da o que refletir)
  - uma softbox-faca ("strip") que produz o rolamento de highlight no bevel
"""
import math
import bpy
from mathutils import Vector

import j3f_config as cfg
from j3f_util import step, log, hex_to_linear


def run(ctx):
    step("03 - Materiais, world, luz e camera")

    brand = hex_to_linear(cfg.BRAND_HEX)
    log("#%s -> linear %s" % (cfg.BRAND_HEX, tuple(round(c, 4) for c in brand)))

    mat_a = _metal(cfg.MAT_A,
                   base=(0.125, 0.132, 0.145),   # grafite: le como metal, nao como breu
                   rough=0.155, rough_var=0.009,
                   spec_tint=(0.45, 0.80, 1.0))  # reflexo puxado para o ciano da marca
    mat_b = _metal(cfg.MAT_B,
                   base=brand,
                   rough=0.145, rough_var=0.008,
                   spec_tint=(0.88, 0.97, 1.0))
    log("materiais: %s (A) e %s (B)" % (mat_a.name, mat_b.name))

    # fake user: sem isso, a variante nao aplicada e descartada ao salvar o
    # .blend por ficar com zero usuarios, e o arquivo perde a comparacao.
    mat_a.use_fake_user = True
    mat_b.use_fake_user = True

    # o importador de SVG deixa um material proprio; ele nao e usado por nada
    svgmat = bpy.data.materials.get("SVGMat")
    if svgmat is not None:
        bpy.data.materials.remove(svgmat)
        log("material residual do importador (SVGMat) removido")

    variant = ctx.get("variant", cfg.DEFAULT_VARIANT)
    active = mat_a if variant.upper() == "A" else mat_b
    bars = [o for o in bpy.context.scene.objects if o.name.startswith("J3F_Bar_")]
    for o in bars:
        o.data.materials.clear()
        o.data.materials.append(active)
    log("variante ativa: %s (%s) aplicada em %d pecas" % (variant, active.name, len(bars)))

    _world()
    aim = _aim()
    _lights(aim, brand)
    cam = _camera(aim)

    ctx["materials"] = {"A": mat_a.name, "B": mat_b.name}
    ctx["camera"] = cam.name
    return ctx


# ---------------------------------------------------------------------------


def _set(node, name, value):
    if name in node.inputs:
        node.inputs[name].default_value = value
        return True
    return False


def _metal(name, base, rough, rough_var, spec_tint):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (560, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (240, 0)

    _set(bsdf, "Base Color", (*base, 1.0))
    _set(bsdf, "Metallic", 1.0)
    _set(bsdf, "Roughness", rough)
    _set(bsdf, "IOR", 1.45)
    _set(bsdf, "Specular Tint", (*spec_tint, 1.0))
    _set(bsdf, "Anisotropic", 0.0)      # sem tangentes confiaveis -> evitamos artefato
    _set(bsdf, "Coat Weight", 0.0)
    _set(bsdf, "Sheen Weight", 0.0)

    # micro-variacao de roughness: e o que separa metal real de plastico liso
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-600, -160)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.location = (-420, -160)
    mp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.location = (-240, -160)
    noise.inputs["Scale"].default_value = 7.0    # variacao larga e quase imperceptivel
    noise.inputs["Detail"].default_value = 2.0
    noise.inputs["Roughness"].default_value = 0.35
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.location = (-40, -160)
    rng.inputs["From Min"].default_value = 0.30
    rng.inputs["From Max"].default_value = 0.70
    rng.inputs["To Min"].default_value = max(0.02, rough - rough_var)
    rng.inputs["To Max"].default_value = rough + rough_var
    rng.clamp = True

    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], bsdf.inputs["Roughness"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _world():
    world = bpy.data.worlds.get("J3F_Studio") or bpy.data.worlds.new("J3F_Studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (400, 0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (200, 0)
    bg.inputs["Strength"].default_value = 1.0

    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-420, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-240, 0)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-60, 0)
    cr = ramp.color_ramp
    cr.interpolation = 'EASE'
    cr.elements[0].position = 0.22
    cr.elements[0].color = (0.006, 0.008, 0.011, 1.0)   # chao: quase preto
    cr.elements[1].position = 0.95
    cr.elements[1].color = (0.165, 0.190, 0.225, 1.0)   # topo: cinza-azulado
    mid = cr.elements.new(0.58)
    mid.color = (0.038, 0.048, 0.062, 1.0)

    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    log("world: gradiente vertical de estudio (autoral)")


def _aim():
    aim = bpy.data.objects.new(cfg.AIM_NAME, None)
    aim.empty_display_type = 'PLAIN_AXES'
    aim.empty_display_size = 0.25
    bpy.context.scene.collection.objects.link(aim)
    return aim


def _area(name, loc, size, energy, color, aim, size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.color = color
    if size_y is None:
        data.shape = 'SQUARE'
        data.size = size
    else:
        data.shape = 'RECTANGLE'
        data.size = size
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    c = obj.constraints.new('TRACK_TO')
    c.target = aim
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    return obj


def _lights(aim, brand):
    # Em metal, a luz que importa e a que APARECE no reflexo. Como as laminas
    # ficam no plano XZ olhando para -Y, todo refletor util mora em -Y.
    _area("J3F_Key", (-2.9, -3.6, 2.4), 4.0, 4600.0, (1.0, 0.985, 0.960), aim)
    _area("J3F_Key_Hi", (2.6, -3.4, 2.9), 2.4, 2800.0, (0.98, 0.99, 1.0), aim)
    # o ciano da marca entra pela LUZ, nao pelo pigmento: e ele que tinge o
    # reflexo da variante grafite sem transformar a peca em plastico colorido
    _area("J3F_Fill_Cyan", (-3.4, -3.2, -2.4), 4.5, 2000.0,
          (brand[0] + 0.02, brand[1] + 0.16, brand[2] + 0.20), aim)
    _area("J3F_Kicker", (3.4, -2.6, 1.6), 1.2, 3400.0, (0.96, 0.98, 1.0), aim)
    # softbox-faca: estreita e longa -> risco de luz que corre pela quina do bevel
    _area("J3F_Strip", (0.9, -2.4, 3.2), 0.16, 3000.0, (1.0, 1.0, 1.0), aim, size_y=8.0)
    _area("J3F_Strip_Low", (-1.4, -2.7, -3.0), 0.14, 850.0,
          (brand[0] + 0.30, brand[1] + 0.55, brand[2] + 0.62), aim, size_y=7.0)
    # cartao amplo e fraco de frente: impede que o grafite caia para preto puro
    _area("J3F_Ambient", (0.2, -6.4, 0.4), 11.0, 260.0, (0.94, 0.965, 1.0), aim)
    log("luzes: Key, Key_Hi, Fill_Cyan, Kicker, Strip, Strip_Low, Ambient")


def _camera(aim):
    data = bpy.data.cameras.new("J3F_Camera")
    data.lens = cfg.CAM_LENS
    data.sensor_fit = 'AUTO'
    data.dof.use_dof = True
    data.dof.focus_object = aim
    data.dof.aperture_fstop = cfg.CAM_FSTOP
    cam = bpy.data.objects.new("J3F_Camera", data)
    cam.location = cfg.CAM_LOC
    bpy.context.scene.collection.objects.link(cam)
    c = cam.constraints.new('TRACK_TO')
    c.target = aim
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    bpy.context.scene.camera = cam
    log("camera: %.0fmm, f/%.1f, dist=%.2f BU"
        % (cfg.CAM_LENS, cfg.CAM_FSTOP, Vector(cfg.CAM_LOC).length))
    return cam
