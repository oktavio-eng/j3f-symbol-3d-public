"""
J3F - orquestrador do build 3D.

Uso:
  blender -b --factory-startup --python scripts/build.py -- [opcoes]

Opcoes:
  --variant A|B        material aplicado no .blend e no GLB (default: A)
  --engine CYCLES|BLENDER_EEVEE_NEXT|BLENDER_EEVEE
  --samples N
  --skip-render        so geometria/materiais/estados/export
  --no-save            nao grava o .blend

NUNCA abre nem escreve j3f-symbol-prototype.blend.
"""
import importlib.util
import shutil
import sys
import time
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
sys.path.insert(0, str(HERE))

import j3f_config as cfg          # noqa: E402
from j3f_util import step, log, warn, WARNINGS   # noqa: E402

STEPS = ["01_import_svg", "02_solidify", "03_materials", "04_states",
         "05_export", "06_render_previews"]


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def argv():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(args, flag, default=None, cast=str):
    if flag in args:
        i = args.index(flag)
        if i + 1 < len(args):
            return cast(args[i + 1])
    return default


def main():
    args = argv()
    t0 = time.time()

    protect = PROJECT / "j3f-symbol-prototype.blend"
    before_hash = protect.stat().st_mtime_ns if protect.exists() else None

    ctx = {
        "project": str(PROJECT),
        "svg_path": PROJECT / cfg.SVG_FILENAME,
        "variant": opt(args, "--variant", cfg.DEFAULT_VARIANT).upper(),
        "engine": opt(args, "--engine", "CYCLES"),
        "samples": opt(args, "--samples", 128, int),
        "use_gpu": "--gpu" in args,
        "modules": {},
    }
    if not Path(ctx["svg_path"]).exists():
        raise SystemExit("SVG nao encontrado: %s" % ctx["svg_path"])

    run_steps = STEPS[:-1] if "--skip-render" in args else STEPS
    for name in run_steps:
        mod = load(name)
        ctx["modules"][name] = mod
        if hasattr(mod, "run"):
            ctx = mod.run(ctx)
        else:
            ctx["modules"][name] = mod

    # 04 precisa ficar disponivel para o 06 mesmo sem render
    if "04_states" not in ctx["modules"]:
        ctx["modules"]["04_states"] = load("04_states")

    if "--no-save" not in args:
        step("Salvando .blend")
        out = PROJECT / cfg.BLEND_OUT
        if out.resolve() == protect.resolve():
            raise SystemExit("recusado: destino e o arquivo protegido")
        bpy.context.preferences.filepaths.save_version = 0   # sem .blend1
        bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
        log("%s (%.1f KB)" % (out.name, out.stat().st_size / 1024))
        ctx["blend_path"] = str(out)

    if before_hash is not None:
        after = protect.stat().st_mtime_ns
        if after != before_hash:
            warn("j3f-symbol-prototype.blend FOI MODIFICADO - investigar")
        else:
            log("j3f-symbol-prototype.blend intacto (mtime inalterado)")

    step("Resumo")
    poly = ctx.get("poly", {})
    log("pecas:            %d" % len(ctx.get("order", [])))
    log("verts/faces/tris: %s / %s / %s"
        % (poly.get("verts"), poly.get("faces"), poly.get("tris")))
    log("silhueta (erro):  %.3e BU" % ctx.get("silhouette_max_error", -1))
    if "glb_size" in ctx:
        log("GLB:              %.2f KB" % (ctx["glb_size"] / 1024))
        log("espaco dos nos:   %s" % ctx.get("node_space"))
    log("previews:         %d" % len(ctx.get("previews", [])))
    log("tempo total:      %.1fs" % (time.time() - t0))
    if WARNINGS:
        log("WARNINGS (%d):" % len(WARNINGS))
        for w in WARNINGS:
            log("  - " + w)
    else:
        log("WARNINGS:         nenhum")
    shutil.rmtree(HERE / "__pycache__", ignore_errors=True)
    print("\n[J3F] BUILD_OK")


main()
