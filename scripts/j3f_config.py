"""
J3F — configuracao compartilhada do pipeline 3D.
Todos os numeros "magicos" do build vivem aqui.
"""
import math

# ----------------------------------------------------------------------------
# Fonte
# ----------------------------------------------------------------------------
SVG_FILENAME = "j3f-symbol.svg"
SVG_VIEWBOX = (0.0, 0.0, 307.0, 359.0)
PIECE_COUNT = 14
COLUMNS = 7

# ----------------------------------------------------------------------------
# Escala / geometria
# ----------------------------------------------------------------------------
TARGET_HEIGHT = 2.0        # altura final do simbolo em Blender Units
THICKNESS = 0.085          # espessura total da lamina (eixo de profundidade)
                           # o SVG e 2D: a espessura e necessariamente autoral
                           # e nao afeta a silhueta frontal oficial
BEVEL = 0.006              # largura do bevel de malha nas arestas do perimetro
BEVEL_SEGMENTS = 3         # segmentos do arredondamento
CAP_NORMAL_TOL = 0.995     # |n.y| acima disso = face de tampa (frente/verso)
RESOLUTION_U = 12          # subdivisao das curvas
SHARP_ANGLE = math.radians(30.0)   # auto smooth
MERGE_DISTANCE = 1e-5
# Dois paths do SVG terminam com um segmento degenerado (`...V357.077Z`), um
# ponto de controle duplicado a ~0.015px do inicial. Ele nao e visivel, mas
# arrebenta a triangulacao do preenchimento. Soldamos pontos mais proximos que:
WELD_TOL = 1e-4            # BU (~0.018 px do viewBox original)

# O simbolo e importado deitado no plano XY. Rotacionamos +90 em X para
# que fique "em pe" no plano XZ, de frente para -Y (camera).
# Assim o export glTF (Y-up) entrega o simbolo no plano XY olhando para +Z,
# que e exatamente o que o Three.js espera na camera default.
STAND_UP_X = math.radians(90.0)

# ----------------------------------------------------------------------------
# Nomes (estaveis e deterministicos)
# ----------------------------------------------------------------------------
ROOT_NAME = "J3F_Symbol_Root"
AIM_NAME = "J3F_Camera_Target"
NAME_TEMPLATE = "J3F_Bar_{half}{col}"   # half in (T, B), col in 1..7

# ----------------------------------------------------------------------------
# Materiais
# ----------------------------------------------------------------------------
BRAND_HEX = "00B1CC"
MAT_A = "J3F_Metal_Graphite"   # variante A - metal neutro/grafite, reflexo ciano
MAT_B = "J3F_Metal_Cyan"       # variante B - metal ciano
DEFAULT_VARIANT = "A"

# ----------------------------------------------------------------------------
# Estado START (autoral J3F - dispersao + rotacao 3D + variacao de escala)
# ----------------------------------------------------------------------------
SEED = 0x4A3346                # "J3F" em bytes
# A dispersao aposta em PROFUNDIDADE + ROTACAO, nao em espalhamento lateral:
# profundidade muda a escala aparente e a leitura de camada sem jogar peca
# para fora do enquadramento, que e o que quebra a legibilidade no scroll.
SPREAD_X = 0.42                # dispersao lateral (plano do simbolo)
SPREAD_Z = 0.34                # dispersao vertical (plano do simbolo)
SPREAD_DEPTH = 1.75            # dispersao em profundidade (eixo Y no Blender)
FRONT_DEPTH_SCALE = 0.50       # peca que vem PARA a camera anda menos (nao estoura)
JITTER = 0.18                  # ruido isotropico por peca
ROT_MAX = math.radians(52.0)   # rotacao maxima por eixo
SCALE_MIN = 0.84
SCALE_MAX = 1.13
MAX_DELAY = 0.30               # fracao do timeline usada pelo stagger

# ----------------------------------------------------------------------------
# Camera / render
# ----------------------------------------------------------------------------
CAM_LOC = (1.00, -6.25, 0.60)
CAM_LENS = 70.0
CAM_FSTOP = 5.6
RES_X = 1200
RES_Y = 1400
PREVIEW_STOPS = (0.0, 0.25, 0.50, 0.75, 1.0)

# ----------------------------------------------------------------------------
# Saida
# ----------------------------------------------------------------------------
BLEND_OUT = "j3f-symbol-3d.blend"
EXPORT_DIR = "export"
GLB_NAME = "j3f-symbol.glb"
JSON_NAME = "j3f-symbol-states.json"
