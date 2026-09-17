"""
ETAPA 04 - Root comum + estados START / END.

END  = o simbolo oficial montado. Rotacao identidade, escala 1, posicao exata
       herdada do SVG. Nada aqui e "escolhido": e medido.
START = dispersao autoral J3F, deterministica (seed fixa):
        - deslocamento no plano do simbolo (X/Z) crescente do centro p/ fora
        - deslocamento em profundidade (Y) alternado, para criar camadas
        - rotacao tridimensional nos 3 eixos
        - leve variacao de escala
        Nao ha orbita, giro circular, nem espiral: a convergencia e uma
        reconstrucao em profundidade, nao um movimento circular.
"""
import math
import random

import bpy
import mathutils
from mathutils import Vector, Quaternion, Euler, Matrix

import j3f_config as cfg
from j3f_util import step, log, warn


def run(ctx):
    step("04 - Root, END e START")

    scene = bpy.context.scene
    bars = sorted([o for o in scene.objects if o.name.startswith("J3F_Bar_")],
                  key=lambda o: o.name)
    if len(bars) != cfg.PIECE_COUNT:
        warn("esperadas %d pecas, encontradas %d" % (cfg.PIECE_COUNT, len(bars)))

    # ------------------------------------------------------------------
    # Root na origem, identidade. Como o simbolo ja foi centrado na origem,
    # transform local == transform world, sem offsets arbitrarios.
    # ------------------------------------------------------------------
    root = bpy.data.objects.new(cfg.ROOT_NAME, None)
    root.empty_display_type = 'ARROWS'
    root.empty_display_size = 0.5
    root.rotation_mode = 'QUATERNION'
    scene.collection.objects.link(root)

    for o in bars:
        o.rotation_mode = 'QUATERNION'
        o.parent = root
        o.matrix_parent_inverse = Matrix.Identity(4)
    log("root '%s' na origem; %d pecas parenteadas (matrix_parent_inverse = I)"
        % (root.name, len(bars)))

    order = _ordered(bars)

    # ------------------------------------------------------------------
    # END - medido do estado atual
    # ------------------------------------------------------------------
    end = {}
    for o in bars:
        end[o.name] = {
            "location": tuple(o.location),
            "quaternion": (o.rotation_quaternion.x, o.rotation_quaternion.y,
                           o.rotation_quaternion.z, o.rotation_quaternion.w),
            "scale": tuple(o.scale),
        }
    log("END capturado (rotacao identidade, escala 1 em todas as pecas)")

    # ------------------------------------------------------------------
    # START - deterministico
    # ------------------------------------------------------------------
    rng = random.Random(cfg.SEED)
    start = {}
    for idx, name in enumerate(order):
        o = scene.objects[name]
        col = int(name[-1])                 # 1..7
        half = name[-2]                     # T / B
        u = (col - (cfg.COLUMNS + 1) / 2.0) / ((cfg.COLUMNS - 1) / 2.0)   # -1..1
        v = 1.0 if half == "T" else -1.0
        out = 0.45 + 0.55 * abs(u)          # peca externa viaja mais

        # profundidade alternada: camadas a frente e atras do plano final.
        # O lado de FRENTE (-Y, em direcao a camera) anda menos, senao a peca
        # cresce demais em perspectiva e some do quadro.
        layer = 1.0 if (col + (0 if half == "T" else 1)) % 2 == 0 else -1.0
        amp = cfg.SPREAD_DEPTH * (cfg.FRONT_DEPTH_SCALE if layer < 0 else 1.0)
        depth = layer * amp * (0.40 + 0.60 * abs(u)) \
            + rng.uniform(-1.0, 1.0) * cfg.JITTER

        off = Vector((
            u * cfg.SPREAD_X * out + rng.uniform(-1.0, 1.0) * cfg.JITTER,
            depth,
            v * cfg.SPREAD_Z * out + rng.uniform(-1.0, 1.0) * cfg.JITTER,
        ))

        rot = Euler((
            rng.uniform(-1.0, 1.0) * cfg.ROT_MAX,
            rng.uniform(-1.0, 1.0) * cfg.ROT_MAX * 0.75,
            rng.uniform(-1.0, 1.0) * cfg.ROT_MAX,
        ), 'XYZ').to_quaternion()

        s = rng.uniform(cfg.SCALE_MIN, cfg.SCALE_MAX)
        loc = Vector(end[name]["location"]) + off

        start[name] = {
            "location": tuple(loc),
            "quaternion": (rot.x, rot.y, rot.z, rot.w),
            "scale": (s, s, s),
        }
        log("%-14s off=(%+.3f, %+.3f, %+.3f)  rot=(%+.1f, %+.1f, %+.1f)deg  escala=%.3f"
            % (name, off.x, off.y, off.z,
               *[math.degrees(a) for a in rot.to_euler('XYZ')], s))

    # ------------------------------------------------------------------
    # Stagger: colunas centrais chegam primeiro, externas fecham o simbolo.
    # ------------------------------------------------------------------
    delays = {}
    for name in order:
        col = int(name[-1])
        d = abs(col - (cfg.COLUMNS + 1) / 2.0) / ((cfg.COLUMNS - 1) / 2.0)   # 0..1
        half_bias = 0.0 if name[-2] == "T" else 0.12
        delays[name] = round(min(1.0, d * 0.88 + half_bias), 4)
    log("stagger (0=chega primeiro): %s"
        % {n: delays[n] for n in order[:4]})

    ctx["root"] = root.name
    ctx["order"] = order
    ctx["end"] = end
    ctx["start"] = start
    ctx["delays"] = delays

    apply_state(1.0, ctx)
    return ctx


def _ordered(bars):
    def key(o):
        return (0 if o.name[-2] == "T" else 1, int(o.name[-1]))
    return [o.name for o in sorted(bars, key=key)]


def ease_out_cubic(t):
    """Easing canonico da convergencia J3F: sai rapido e assenta devagar.
    E o que faz a peca parecer "voar e encaixar" em vez de deslizar."""
    return 1.0 - (1.0 - t) ** 3


def ease_in_out_cubic(t):
    """Alternativa mais contida; mantida como opcao para o front-end."""
    return 4 * t * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 3) / 2


EASING = ease_out_cubic
EASING_NAME = "easeOutCubic"


def local_t(t, delay):
    span = 1.0 - delay * cfg.MAX_DELAY
    return max(0.0, min(1.0, (t - delay * cfg.MAX_DELAY) / span)) if span > 1e-6 else 1.0


def apply_state(t, ctx):
    """Coloca a cena no progresso global t (0..1) com stagger + easing."""
    scene = bpy.context.scene
    for name in ctx["order"]:
        o = scene.objects[name]
        s, e = ctx["start"][name], ctx["end"][name]
        p = EASING(local_t(t, ctx["delays"][name]))

        o.location = Vector(s["location"]).lerp(Vector(e["location"]), p)
        qs = Quaternion((s["quaternion"][3], *s["quaternion"][:3]))
        qe = Quaternion((e["quaternion"][3], *e["quaternion"][:3]))
        o.rotation_quaternion = qs.slerp(qe, p)
        o.scale = Vector(s["scale"]).lerp(Vector(e["scale"]), p)
    bpy.context.view_layer.update()
