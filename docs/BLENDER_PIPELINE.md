# Pipeline Blender — J3F Símbolo 3D

Documentação técnica da Fase Blender: como o SVG oficial vira geometria 3D,
material metálico e estados de animação exportados.

Ambiente: **Blender 5.2.1 LTS** (build 2026-08-25, hash `9e2066aef7ef`), macOS,
Cycles CPU. Addons nativos `io_curve_svg` e `io_scene_gltf2`.

---

## 1. Visão geral

```
j3f-symbol.svg  (14 paths, viewBox 0 0 307 359)
     │
     ├─ 01_import_svg.py     import → normalização → solda → nomes
     ├─ 02_solidify.py       extrusão → bevel de malha → mesh → shading
     ├─ 03_materials.py      materiais → world → luzes → câmera
     ├─ 04_states.py         root → END → START → easing/stagger
     ├─ 05_export.py         GLB + JSON + verificação
     └─ 06_render_previews.py  7 previews Cycles
     │
     ▼
j3f-symbol-3d.blend + export/j3f-symbol.glb + export/j3f-symbol-states.json
```

Orquestrado por `scripts/build.py`. Determinístico: seed fixa `0x4A3346`.

---

## 2. A fonte: o SVG

Inspeção do `j3f-symbol.svg`:

- `viewBox="0 0 307 359"`, `width=307`, `height=359`
- **14 `<path>`** e nada mais. Sem `<g>`, `<defs>`, `<use>`, `<style>`, `<image>`
- **Sem transforms, masks, clip-paths, gradientes, filtros, stroke ou opacity**
- Atributos usados: apenas `d` e `fill`. Fill único `#00B1CC`
- Comandos: apenas `M V C Z`. Todos os contornos fechados e simples — nenhum path
  com furo, logo não há questão de `fill-rule`

O símbolo é **7 colunas × 2 metades**, com simetria de rotação de 180° em torno
do centro. Cada lâmina é um path independente — ou seja, **as 14 partes da marca
já são exatamente os 14 elementos animáveis**. Nenhuma fragmentação foi necessária.

| Coluna | Largura (px) | Lâmina superior | Lâmina inferior |
|---|---|---|---|
| 1 | 15,4 | `J3F_Bar_T1` | `J3F_Bar_B1` |
| 2 | 21,7 | `J3F_Bar_T2` | `J3F_Bar_B2` |
| 3 | 28,9 | `J3F_Bar_T3` | `J3F_Bar_B3` |
| 4 | 36,1 | `J3F_Bar_T4` | `J3F_Bar_B4` |
| 5 | 28,9 | `J3F_Bar_T5` | `J3F_Bar_B5` |
| 6 | 21,7 | `J3F_Bar_T6` | `J3F_Bar_B6` |
| 7 | 15,4 | `J3F_Bar_T7` | `J3F_Bar_B7` |

As bordas internas são curvas (as únicas `C` do arquivo) e formam o vazio em
lente no centro.

---

## 3. Etapa 01 — Import e normalização

### Import

`bpy.ops.import_curve.svg` produz 14 objetos CURVE, **1 spline fechada cada**,
4–10 pontos de controle. Mapeamento 1:1 com os paths. Bounding box importado:
0,086386 × 0,101145 BU (o importador usa 1 px ≈ 1/1000 m).

### Normalização

Uma **única matriz uniforme** aplicada ao conjunto inteiro:

```
M = Scale(factor) @ Translation(-center)      factor = 2.0 / altura = 19,773603
```

Escala uniforme + translação preservam por construção proporções, distâncias
entre lâminas, curvas internas e alinhamento. Resultado: 1,7082 × 2,0000 BU,
centrado na origem.

### Orientação

O símbolo importa deitado no plano XY. Ele é posto "em pé" no plano XZ, de frente
para −Y (onde fica a câmera). Assim o export glTF (Y-up) entrega o símbolo no
plano XY olhando para +Z — exatamente o que o Three.js espera na câmera default.

**A rotação NÃO entra nos dados da curva**, apenas na matriz do objeto. Curvas 2D
do Blender são achatadas no plano local XY: rotacionar os dados em 90° destrói a
geometria (a silhueta explodiu para ±404 BU quando isso foi tentado). A rotação
só é assada nos dados depois da conversão para mesh, na etapa 02.

### Reset de `radius` dos pontos de controle

`Curve.transform()` multiplica o `radius` de cada ponto de controle pelo fator de
escala, e o bevel do Blender é multiplicado por esse radius. Sem resetar,
`radius = 19,7736` e o bevel sairia 19,77× maior que o pedido (medido: espessura
1,186 BU em vez de 0,06). Todos os pontos recebem `radius = 1.0` e `tilt = 0.0`
após o transform.

### Solda de pontos degenerados

Ver seção 8.

### Nomenclatura

Colunas detectadas por clustering do centro X (tolerância 0,02 BU), metade pelo
sinal de Z. Nomes `J3F_Bar_{T|B}{1..7}`, estáveis e determinísticos.

---

## 4. Etapa 02 — Espessura, bevel e mesh

### Estratégia de bevel que preserva a silhueta

**O bevel de curva do Blender foi descartado de propósito.**

Um bevel de raio R aplicado à curva engorda a silhueta em R. A compensação
natural seria `curve.offset = -R`, que faz o inset de volta — e funcionou em 13
das 14 lâminas, mas falhou em `J3F_Bar_B3` (erro de 0,005 BU numa borda), porque
o `offset` do Blender não lida com o segmento degenerado daquele path.

A solução adotada é **exata por construção**:

1. A curva é extrudada **sem bevel e sem offset** → prisma reto cuja silhueta é,
   ponto a ponto, o próprio path do SVG.
2. O arredondamento é feito depois, **na malha**, apenas nas arestas do
   **perímetro** — as que separam uma tampa frontal/traseira de uma parede
   lateral. Identificação: aresta com 2 faces adjacentes das quais **exatamente
   uma** tem `|normal.y| > 0.995`.
3. Um bevel de malha **corta material para dentro**: ele nunca empurra a
   silhueta para fora. As paredes laterais continuam exatamente sobre o contorno
   original.
4. As **arestas verticais de quina NÃO são chanfradas** — são elas que definem a
   silhueta nos cantos das lâminas.

Resultado medido: **desvio máximo da silhueta = 0,000e+00 BU** em todas as 14
peças, nas 4 bordas de cada uma (verificado contra o preenchimento 2D da curva
original, antes de qualquer solidez).

### Shading

Só a fita do bevel é suave. Tampas e paredes laterais ficam **chapadas**:

```python
for f in bm.faces:
    f.smooth = f in bevel_faces
for e in bm.edges:
    e.smooth = True
```

Isso é o que separa "metal usinado" de "plástico amassado". Na primeira tentativa
todas as faces foram marcadas smooth com sharp por ângulo de 30°; como o ângulo
entre facetas do bevel é 90°/(3+1) = 22,5°, a transição ficava suave e a normal
do bevel se espalhava pela face inteira, deixando as lâminas com aparência
abaulada/amassada. Com face chapada + bevel suave, aparece o fio de luz rolando
na quina, que é a leitura metálica desejada.

### Origem das peças

A origem de cada peça vai para o centro do seu próprio bounding box, com os dados
da mesh compensados — nada se move no mundo. Isso é o que permite rotacionar cada
lâmina em torno de si mesma no estado START.

### Salvaguarda

Faces de área < 1e-10 são removidas após `remove_doubles`. Na versão final o
contador é **0** (a solda da etapa 01 resolveu a causa raiz).

---

## 5. Etapa 03 — Materiais, luz e câmera

Tudo autoral. Nenhum HDRI, textura, shader ou asset de terceiros.

### Variante A — `J3F_Metal_Graphite` (**escolhida**)

| Parâmetro | Valor |
|---|---|
| Base Color | `(0.125, 0.132, 0.145)` linear — grafite neutro |
| Metallic | `1.0` |
| Roughness | `0.155` ± `0.009` (micro-variação procedural) |
| Specular Tint | `(0.45, 0.80, 1.0)` — puxa o reflexo para o ciano da marca |
| Anisotropic | `0.0` (sem tangentes confiáveis; evita artefato) |

### Variante B — `J3F_Metal_Cyan`

`#00B1CC` convertido para linear `(0.0, 0.4397, 0.6038)`, `metallic 1.0`,
`roughness 0.145`. Mantida no `.blend` com **fake user** para comparação.

### Micro-variação de roughness

Noise procedural (scale 7.0, detail 2.0) → Map Range → Roughness, com amplitude
de ±0,009. É deliberadamente quase imperceptível: valores mais altos (as
primeiras tentativas usaram ±0,075 com scale 14) produziam manchas tipo camuflagem.

### World

Gradiente vertical de estúdio, autoral: `Texture Coordinate → Separate XYZ → Z →
ColorRamp (EASE) → Background`. Chão quase preto `(0.006, 0.008, 0.011)`, topo
cinza-azulado `(0.165, 0.190, 0.225)`. Metal sem ambiente não existe — é ele que
dá o que refletir.

### Luzes

Como as lâminas ficam no plano XZ olhando para −Y, **todo refletor útil mora em −Y**.

| Luz | Posição | Tamanho | Potência | Papel |
|---|---|---|---|---|
| `J3F_Key` | `(-2.9, -3.6, 2.4)` | 4.0 | 4600 W | key branca, alto-esquerda |
| `J3F_Key_Hi` | `(2.6, -3.4, 2.9)` | 2.4 | 2800 W | levanta a metade superior direita |
| `J3F_Fill_Cyan` | `(-3.4, -3.2, -2.4)` | 4.5 | 2000 W | acento ciano da marca |
| `J3F_Kicker` | `(3.4, -2.6, 1.6)` | 1.2 | 3400 W | highlight duro |
| `J3F_Strip` | `(0.9, -2.4, 3.2)` | 0.16 × 8.0 | 3000 W | softbox-faca → rola na quina |
| `J3F_Strip_Low` | `(-1.4, -2.7, -3.0)` | 0.14 × 7.0 | 850 W | faca ciano inferior |
| `J3F_Ambient` | `(0.2, -6.4, 0.4)` | 11.0 | 260 W | piso de luz, evita preto puro |

Todas com `TRACK_TO` apontando para `J3F_Camera_Target` na origem.

### Câmera

70 mm, f/5.6 com DOF focado no alvo, posição `(1.00, -6.25, 0.60)` (distância
6,36 BU), `TRACK_TO` no alvo. Render 1200×1400, AgX Medium High Contrast.

O símbolo ocupa ~62% da altura do quadro — aberto de propósito, para dar espaço à
coreografia sem jogar peças para fora no início.

---

## 6. Etapa 04 — Root, END e START

### Root

`J3F_Symbol_Root` é um Empty na origem, com identidade. As 14 peças são
parenteadas com `matrix_parent_inverse = Identity`. Como o símbolo já está
centrado na origem, **transform local == transform world** — sem offsets
arbitrários. Todas as peças usam `rotation_mode = 'QUATERNION'`.

### Estado END

**Medido, não escolhido.** É o símbolo oficial montado: posição herdada do SVG,
rotação identidade, escala 1,0 em todas as 14 peças.

### Estado START

Determinístico, seed `0x4A3346` ("J3F" em bytes). Autoral da J3F — sem órbita,
giro circular ou espiral.

Por peça, com `u` = posição horizontal normalizada (−1..1) e `out = 0.45 + 0.55·|u|`:

| Componente | Fórmula / faixa |
|---|---|
| Deslocamento X | `u · 0.42 · out + jitter(±0.18)` |
| Profundidade Y | `layer · amp · (0.40 + 0.60·|u|) + jitter(±0.18)`, `amp = 1.75` (×0.50 se vier para a câmera) |
| Deslocamento Z | `v · 0.34 · out + jitter(±0.18)` |
| Rotação | ±52° por eixo (Y com 75% da amplitude), 3 eixos |
| Escala | uniforme, 0.84 – 1.13 |

`layer` alterna ±1 por coluna/metade, criando camadas à frente e atrás do plano
final. O lado da frente anda metade da distância: em perspectiva a peça cresce e
estouraria o quadro.

**A dispersão aposta em profundidade + rotação, não em espalhamento lateral.**
Profundidade muda a escala aparente e a leitura de camada sem jogar peça para
fora do enquadramento — que foi exatamente o problema da primeira calibração
(`SPREAD_X = 1.55`, `SPREAD_Z = 0.95`): a 50% do scroll quase nada estava em quadro.

### Easing

**`easeOutCubic`** — `p = 1 − (1 − t)³`. Sai rápido e assenta devagar; é o que faz
a peça parecer "voar e encaixar" em vez de deslizar.

A primeira versão usava `easeInOutCubic`. Com ele, a 50% do scroll o símbolo
ainda lia como caos — lento no começo e no fim. `ease_in_out_cubic` continua
disponível em `04_states.py` como alternativa.

### Stagger

Colunas centrais chegam primeiro; as externas fecham a silhueta.

```
delay = |col − 4| / 3 · 0.88 + (0.12 se metade inferior)
tLocal = clamp((t − delay·0.30) / (1 − delay·0.30), 0, 1)
```

`MAX_DELAY = 0.30` (fração do timeline consumida pelo stagger).

| Peça | delay | | Peça | delay |
|---|---|---|---|---|
| `T4` | 0.0000 | | `B4` | 0.1200 |
| `T3` / `T5` | 0.2933 | | `B3` / `B5` | 0.4133 |
| `T2` / `T6` | 0.5867 | | `B2` / `B6` | 0.7067 |
| `T1` / `T7` | 0.8800 | | `B1` / `B7` | 1.0000 |

Rotação interpolada por **slerp** entre os quaternions START e END.

---

## 7. Etapa 05 — Export GLB + JSON

### GLB

`export_scene.gltf`, formato GLB, apenas a seleção (root + 14 peças), modificadores
aplicados, **sem animação**, `export_yup=True`, sem câmeras nem luzes.

Resultado: **15 nós** (root + 14), **14 meshes**, 1 material, **403,97 KB**.
O nó root sai com `T=[0,0,0] R=[0,0,0,1] S=[1,1,1]` — a conversão Y-up foi
aplicada pelo exportador **nos filhos**, não no root.

### Roughness no GLB

O socket Roughness está ligado ao noise procedural (para o render em Cycles). O
exportador glTF não converte isso e simplesmente **omite `roughnessFactor`** —
cujo default no glTF é `1.0`. O GLB chegaria no Three.js como metal fosco.

O export **desliga o noise temporariamente**, fixa o valor base (média da faixa
do Map Range) e religa depois. O resultado é conferido lendo o GLB de volta:

```
material no GLB 'J3F_Metal_Graphite': metallic=1.000 roughness=0.155
                                      baseColor=[0.125, 0.132, 0.145]
```

Emite warning se `metallicFactor < 0.9` ou `roughnessFactor > 0.6`.

### JSON — convenções

| Convenção | Valor |
|---|---|
| Rotação canônica | **quaternion `[x, y, z, w]`** |
| Euler | apenas `euler_xyz_debug`, radianos, ordem XYZ — auxiliar/debug |
| Transforms | **locais, relativos ao root `J3F_Symbol_Root`** |
| Espaço primário | **`gltf_y_up`** |

Cada peça traz os dois espaços:

- `gltf_y_up` — Y para cima, convenção glTF/Three.js: `(x, z, −y)` do Blender
- `blender_z_up` — Z para cima, espaço nativo do `.blend`

O campo `conventions.glb_node_space` diz **qual dos dois reproduz o TRS local dos
nós do GLB**. Não é assumido: o export lê o chunk JSON do GLB gerado e compara os
dois blocos contra os nós reais.

### Estrutura do JSON

```
meta          projeto, asset, versão do Blender, seed, unidades
conventions   rotação, espaços, glb_node_space + nota
symbol        root, nomes, dimensões, aspect (viewBox / geometria / 3D), bbox
animation     modelo, easing recomendado, stagger (fórmula), slerp
verification  desvios medidos
geometry      verts / faces / tris
materials     nomes das variantes A e B
pieces[14]    name, index, half, column, delay, end{2 espaços}, start{2 espaços}
```

---

## 8. Problemas encontrados e como foram corrigidos

### 8.1 Rotação de curva 2D destruiu a geometria

**Sintoma:** ao normalizar, a silhueta explodiu para X ±404 BU, espessura 0,298 BU
em vez de 0,06, altura encolhida para ±0,59.

**Causa:** a rotação de +90° em X foi aplicada aos **dados da curva**. Curvas 2D
do Blender são achatadas no plano local XY; pontos com Z ≠ 0 corrompem a
avaliação.

**Correção:** a rotação fica na **matriz do objeto** e só é assada nos dados
depois da conversão para mesh (etapa 02).

### 8.2 Bevel 19,77× maior que o pedido

**Sintoma:** com `extrude=0.025` e `bevel_depth=0.005`, a espessura medida foi
1,18642 BU — exatamente `2·(0.025+0.005)·19,7736`.

**Causa:** `Curve.transform()` multiplica o `radius` de cada ponto de controle
pelo fator de escala (radius virou 19,7736), e o bevel do Blender é multiplicado
por esse radius.

**Correção:** `radius = 1.0` e `tilt = 0.0` em todos os pontos após o transform.

### 8.3 Pontos de controle degenerados no SVG

**Sintoma:** a lâmina `J3F_Bar_B3` renderizava com um rasgo diagonal preto. O
`curve.offset` falhava nela, deixando um erro de 0,005 BU na silhueta.

**Causa:** dois paths do SVG terminam com `...V357.077Z` e `...V1.39412Z` — um
ponto de controle **duplicado a ~0,015 px do inicial**. Invisível, mas arrebenta
a triangulação do preenchimento: o fill de B3 gerava 98 faces, das quais **84 com
área ~0**.

**Correção:** solda de pontos de controle consecutivos separados por menos que
`WELD_TOL = 1e-4 BU` (~0,018 px). O ponto seguinte é removido e o anterior herda
o `handle_right` dele, preservando exatamente a curva útil e descartando só o
segmento nulo. A spline é reconstruída com handles, tipos, radius e tilt copiados.

**Impacto medido:** **2 pontos soldados**, deslocamento máximo **0,015 px** —
0,004% da altura do símbolo. Registrado no JSON em
`verification.welded_control_points` e `verification.weld_max_shift_px`.

### 8.4 `curve.offset` não preserva a silhueta

**Sintoma:** com `bevel_depth=0.005` e `offset=-0.005`, 13 peças ficavam exatas e
`J3F_Bar_B3` desviava +0,005 BU numa borda.

**Correção:** abandono do bevel de curva em favor do bevel de malha no perímetro
(seção 4). Erro foi a zero exato.

### 8.5 Shading suave deixava as lâminas abauladas

**Sintoma:** faces planas com gradiente irregular, aparência de plástico amassado.

**Causa:** todas as faces marcadas smooth; o ângulo entre facetas do bevel (22,5°)
é menor que o limiar de sharp (30°), então a normal do bevel se espalhava pelas
n-gons grandes.

**Correção:** só as faces do bevel são smooth (identificadas pelo retorno de
`bmesh.ops.bevel`); tampas e paredes laterais ficam chapadas.

### 8.6 `roughnessFactor` ausente no GLB

Ver seção 7. Corrigido desligando o noise durante o export e verificando o
resultado no GLB gerado.

### 8.7 Material da variante B descartado ao salvar

**Sintoma:** o `.blend` salvo continha só `J3F_Metal_Graphite` e o residual
`SVGMat`.

**Causa:** o Blender descarta datablocks com zero usuários ao salvar. A variante
não aplicada ficava órfã após o preview.

**Correção:** `use_fake_user = True` nos dois materiais; `SVGMat` (residual do
importador, sem uso) é removido.

### 8.8 Detecção de GPU do Cycles trava em headless

**Sintoma:** processo Blender parado em 0% de CPU por minutos, sem renderizar.

**Causa:** `prefs.get_devices()` / enumeração Metal em modo background.

**Correção:** CPU é o padrão; GPU só com `--gpu` explícito.

### 8.9 Coreografia jogava as peças para fora do quadro

**Sintoma:** no preview a 0% apenas 5 das 14 peças estavam visíveis; a 50% ainda
quase nada em quadro.

**Causa:** dispersão lateral grande demais (`SPREAD_X = 1.55`, `SPREAD_Z = 0.95`,
`JITTER = 0.34`) combinada com `easeInOutCubic`, que é lento no começo e no fim.

**Correção:** dispersão migrada para profundidade + rotação
(`SPREAD_X = 0.42`, `SPREAD_Z = 0.34`, `SPREAD_DEPTH = 1.75`, `JITTER = 0.18`),
`ROT_MAX` de 62° → 52°, easing trocado para `easeOutCubic`, câmera aberta de
4,85 → 6,36 BU. As 14 peças ficam em quadro a 0%.

---

## 9. Verificações realizadas

Todas rodam a cada build e emitem warning se saírem da tolerância.

| Verificação | Resultado |
|---|---|
| Silhueta de cada peça vs. curva original (4 bordas × 14 peças) | **0,000e+00 BU** |
| Aspect 3D vs. aspect da geometria do SVG | **1,7e-08** |
| END do JSON vs. TRS dos nós do GLB (`gltf_y_up`) | **4,98e-07** |
| END do JSON vs. TRS dos nós do GLB (`blender_z_up`) | 6,55e-01 → espaço correto é `gltf_y_up` |
| Peças encontradas no GLB | **14 / 14** |
| Pontos de controle soldados | **2**, deslocamento máx. **0,015 px** |
| Faces degeneradas removidas | **0** |
| Colunas detectadas | **7 / 7** |
| Nomes duplicados | nenhum |
| `metallicFactor` / `roughnessFactor` no GLB | 1.000 / 0.155 |
| `j3f-symbol-prototype.blend` (mtime) | **intacto** |
| Warnings no build final | **nenhum** |

Verificação de espessura: **0,08500 BU** medido em Y, exatamente o configurado.

Nota sobre aspect: o 3D preserva o aspect da **geometria dos paths**
(0,854084415), não o do viewBox (0,855153203). O viewBox tem ~0,9 px de folga à
direita e ~0,5 px embaixo, onde nenhum path chega. Ambos estão registrados no JSON.

---

## 10. Números finais

| | |
|---|---|
| Peças | **14** (as 14 lâminas originais — sem fracture, sem subdivisão) |
| Vértices | 5.296 |
| Faces | 5.902 |
| **Triângulos** | **10.536** |
| Arestas chanfradas | 1.324 |
| **GLB** | **403,97 KB** (0,395 MB) |
| JSON | 30,3 KB |
| `.blend` | ~245 KB |
| Previews | 7 × 1200×1400 PNG |
| Tempo de build completo | ~130 s (Cycles CPU, 180 spp) |
| Tempo sem render | ~0,3 s |

---

## 11. Parâmetros principais

Todos em `scripts/j3f_config.py`.

```python
TARGET_HEIGHT     = 2.0          # altura final em BU
THICKNESS         = 0.085        # espessura total (autoral — o SVG é 2D)
BEVEL             = 0.006        # largura do bevel de malha
BEVEL_SEGMENTS    = 3
CAP_NORMAL_TOL    = 0.995        # |n.y| acima disso = face de tampa
RESOLUTION_U      = 12
WELD_TOL          = 1e-4         # solda de pontos degenerados (~0,018 px)
MERGE_DISTANCE    = 1e-5

SEED              = 0x4A3346     # "J3F"
SPREAD_X          = 0.42
SPREAD_Z          = 0.34
SPREAD_DEPTH      = 1.75
FRONT_DEPTH_SCALE = 0.50
JITTER            = 0.18
ROT_MAX           = radians(52)
SCALE_MIN/MAX     = 0.84 / 1.13
MAX_DELAY         = 0.30

CAM_LOC           = (1.00, -6.25, 0.60)
CAM_LENS          = 70.0
CAM_FSTOP         = 5.6
RES_X / RES_Y     = 1200 / 1400
```

A espessura (0,085 BU, 4,25% da altura) é **necessariamente autoral**: o SVG é 2D
e não existe espessura oficial a preservar. Não afeta a silhueta frontal.
