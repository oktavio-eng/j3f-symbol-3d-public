"""
ETAPA 06 - Previews.

  A) duas variantes de material no estado END (comparacao visual)
  B) o movimento em 0%, 25%, 50%, 75% e 100%

Nada aqui altera geometria: so troca material e interpola START->END.
"""
import time
from pathlib import Path

import bpy

import j3f_config as cfg
from j3f_util import step, log, warn

LOOKS = ("AgX - Medium High Contrast", "AgX - Punchy", "Medium High Contrast", "None")


def setup_render(engine, samples, res_scale=1.0, ctx_use_gpu=False):
    scene = bpy.context.scene
    scene.render.engine = engine
    scene.render.resolution_x = int(cfg.RES_X * res_scale)
    scene.render.resolution_y = int(cfg.RES_Y * res_scale)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.compression = 15
    scene.render.film_transparent = False

    scene.view_settings.view_transform = 'AgX'
    for look in LOOKS:
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    scene.view_settings.exposure = 0.0

    if engine == 'CYCLES':
        c = scene.cycles
        c.samples = samples
        c.preview_samples = 32
        c.use_denoising = True
        try:
            c.denoiser = 'OPENIMAGEDENOISE'
        except TypeError:
            pass
        c.use_adaptive_sampling = True
        c.adaptive_threshold = 0.01
        c.max_bounces = 8
        c.glossy_bounces = 6
        c.transmission_bounces = 4
        c.caustics_reflective = False
        _device(ctx_use_gpu)
    else:
        e = scene.eevee
        e.taa_render_samples = max(64, samples)
        for attr, val in (("use_raytracing", True), ("use_shadows", True),
                          ("use_volumetric_shadows", False)):
            if hasattr(e, attr):
                setattr(e, attr, val)
    log("engine=%s samples=%s res=%dx%d look=%s"
        % (engine, samples, scene.render.resolution_x, scene.render.resolution_y,
           scene.view_settings.look))


def _device(use_gpu):
    """A deteccao de GPU do Cycles trava em background nesta maquina, entao
    CPU e o padrao. GPU so com --gpu explicito."""
    if not use_gpu:
        bpy.context.scene.cycles.device = 'CPU'
        log("Cycles: CPU (use --gpu para tentar GPU)")
        return
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for dev_type in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                prefs.compute_device_type = dev_type
            except TypeError:
                continue
            prefs.get_devices()
            usable = [d for d in prefs.devices if d.type == dev_type]
            if usable:
                for d in prefs.devices:
                    d.use = (d.type == dev_type)
                bpy.context.scene.cycles.device = 'GPU'
                log("Cycles GPU: %s (%s)" % (dev_type, ", ".join(d.name for d in usable)))
                return
        bpy.context.scene.cycles.device = 'CPU'
        log("Cycles: CPU")
    except Exception as exc:
        warn("nao consegui configurar GPU (%s); usando CPU" % exc)
        bpy.context.scene.cycles.device = 'CPU'


def _render(path):
    scene = bpy.context.scene
    scene.render.filepath = str(path)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    p = Path(str(path))
    size = p.stat().st_size if p.exists() else 0
    log("  -> %s  (%.1fs, %.0f KB)" % (p.name, dt, size / 1024))
    return dt


def set_variant(ctx, key):
    mat = bpy.data.materials[ctx["materials"][key]]
    for name in ctx["order"]:
        o = bpy.context.scene.objects[name]
        o.data.materials.clear()
        o.data.materials.append(mat)
    return mat


def run(ctx):
    step("06 - Previews (materiais + movimento)")

    import importlib
    states = ctx["modules"]["04_states"]

    out = Path(ctx["project"]) / cfg.EXPORT_DIR
    out.mkdir(parents=True, exist_ok=True)

    setup_render(ctx.get("engine", "CYCLES"), ctx.get("samples", 128),
                 ctx_use_gpu=ctx.get("use_gpu", False))

    produced = []
    total = 0.0

    # --- A) variantes de material, estado END ---------------------------
    states.apply_state(1.0, ctx)
    for key, label in (("A", "material-A_grafite"), ("B", "material-B_ciano")):
        mat = set_variant(ctx, key)
        log("preview material %s (%s)" % (key, mat.name))
        p = out / ("preview_%s.png" % label)
        total += _render(p)
        produced.append(p)

    # --- B) movimento, variante preferida (A) ---------------------------
    set_variant(ctx, ctx.get("variant", cfg.DEFAULT_VARIANT))
    for t in cfg.PREVIEW_STOPS:
        states.apply_state(t, ctx)
        log("preview movimento t=%.0f%%" % (t * 100))
        p = out / ("preview_motion_%03d.png" % round(t * 100))
        total += _render(p)
        produced.append(p)

    states.apply_state(1.0, ctx)
    set_variant(ctx, ctx.get("variant", cfg.DEFAULT_VARIANT))

    log("total de render: %.1fs para %d imagens" % (total, len(produced)))
    ctx["previews"] = [str(p) for p in produced]
    return ctx
