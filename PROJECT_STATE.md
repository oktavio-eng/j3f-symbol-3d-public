# PROJECT_STATE — J3F Símbolo 3D

**Handoff entre sessões. Leia este arquivo primeiro.**

Última atualização: 2026-09-17
Fase atual: **Fase 1 — Organic APROVADA visualmente; camada de microinteração
(idle + pointer) construída, aguardando ajuste visual**
Fase anterior: **Fase Blender CONCLUÍDA e APROVADA** (checkpoint no commit `b82b453`)

---

## 1. O que já foi concluído

A Fase Blender está fechada. O pipeline transforma `j3f-symbol.svg` (símbolo
oficial da J3F, 14 paths) em:

- `j3f-symbol-3d.blend` — cena de trabalho com as 14 lâminas, materiais, world de
  estúdio, 7 luzes e câmera
- `export/j3f-symbol.glb` — 15 nós (root + 14 peças), 14 meshes, 1 material,
  estado END, sem animação — **403,97 KB**
- `export/j3f-symbol-states.json` — estados START/END por peça, delays do
  stagger, convenções e verificações — **30,3 KB**
- 7 previews Cycles em 1200×1400

Resultados verificados no build final:

| | |
|---|---|
| Peças | 14 (as próprias barras da marca) |
| Polycount | 5.296 verts / 5.902 faces / **10.536 tris** |
| Erro de silhueta | **0,000e+00 BU** (zero exato, 4 bordas × 14 peças) |
| Desvio JSON ↔ nós do GLB | 4,98e-07 |
| Material no GLB | metallic 1.000, roughness 0.155 |
| Warnings | **nenhum** |

Documentação técnica completa: `docs/BLENDER_PIPELINE.md`.

---

## 2. Decisões aprovadas

### Material: **variante A — metal grafite com acento ciano `#00B1CC`** ✅

Aplicada no `.blend` e no GLB. `baseColor (0.125, 0.132, 0.145)` linear,
`metallic 1.0`, `roughness 0.155`. O ciano entra pela **luz** e pelo Specular
Tint, não pelo pigmento.

A variante B (`J3F_Metal_Cyan`, metal ciano) fica no `.blend` com fake user para
comparação futura. Não foi escolhida.

### Enquadramento atual: **aprovado como baseline** ✅

Câmera 70 mm, f/5.6, posição `(1.00, -6.25, 0.60)`, distância 6,36 BU. O símbolo
ocupa ~62% da altura do quadro — aberto de propósito, para dar espaço à
coreografia. Referência visual: `export/preview_material-A_grafite.png`.

### Coreografia atual: **aprovada como baseline** ✅

Dispersão em profundidade + rotação 3D + leve variação de escala, convergindo por
`easeOutCubic` com stagger center-out. Original da J3F: sem órbita, giro circular
ou espiral. Referência visual: `export/preview_motion_000|025|050|075|100.png`.

### Ajuste futuro previsto

Possível refinamento do **estágio ~25%** da animação — a ser feito **via
Three.js**, ajustando easing/stagger/curva de scroll no front-end. **Não** exige
regerar GLB nem JSON: os estados START e END continuam válidos; o que muda é a
função de interpolação.

---

## 3. Arquivos importantes

| Arquivo | Papel |
|---|---|
| `j3f-symbol.svg` | símbolo oficial — **fonte da verdade**, não editar |
| `j3f-symbol-prototype.blend` | cena inicial original — **NÃO MODIFICAR** (preservada intacta, MD5 `2587aa933c5a5f8b5a94a6962ff1993f`) |
| `j3f-symbol-3d.blend` | cena de trabalho gerada pelo build |
| `export/j3f-symbol.glb` | **entrada da Fase Three.js** |
| `export/j3f-symbol-states.json` | **entrada da Fase Three.js** |
| `scripts/j3f_config.py` | todos os parâmetros do build |
| `scripts/build.py` | orquestrador |
| `docs/BLENDER_PIPELINE.md` | decisões técnicas e problemas resolvidos |
| `docs/THREEJS_PROTOTYPE.md` | documentação da Fase 1 (Three.js) |
| `web/` | protótipo Three.js standalone (Fase 1) |
| `web/src/j3f-animation.js` | coreografia **baseline** — não alterar |
| `web/src/j3f-organic.js` | coreografia **organic** — aprovada, não alterar |
| `web/src/j3f-interaction.js` | camada aditiva idle + pointer — é aqui que se experimenta |

---

## 4. Como reproduzir o build

Requer Blender 5.2.1 LTS no PATH.

```bash
# build completo (geometria + materiais + estados + GLB/JSON + 7 previews) — ~130 s
blender -b --factory-startup --python scripts/build.py -- \
  --variant A --engine CYCLES --samples 180

# só geometria/estados/export, sem render — ~0,3 s
blender -b --factory-startup --python scripts/build.py -- --skip-render

# comparar a variante B de material
blender -b --factory-startup --python scripts/build.py -- --variant B
```

O build é determinístico (seed `0x4A3346`). Mesma entrada → mesma saída.

**Não use `--gpu`:** a detecção de dispositivo do Cycles trava em headless nesta
máquina (processo em 0% de CPU). CPU é o padrão.

---

## 5. O que NÃO deve ser refeito

- ❌ **Não regenerar GLB/JSON sem necessidade.** Eles estão aprovados e
  verificados. Regerar só se a geometria ou os estados mudarem de fato.
- ❌ **Não modificar os arquivos Blender durante a fase Three.js** — nem
  `j3f-symbol-3d.blend`, nem `scripts/`, nem os previews.
- ❌ **Nunca tocar `j3f-symbol-prototype.blend`.** O `build.py` verifica o mtime
  dele a cada execução e emite warning se mudar.
- ❌ **Não refazer as decisões de material, enquadramento ou coreografia** — foram
  aprovadas. Ajustes de timing vão para o Three.js.
- ❌ **Não re-derivar o pipeline Blender.** Os problemas já resolvidos estão
  documentados em `docs/BLENDER_PIPELINE.md` seção 8: rotação de curva 2D, radius
  do bevel, pontos degenerados do SVG, `curve.offset`, shading, `roughnessFactor`
  no GLB, fake user dos materiais, GPU headless, calibração da coreografia.
- ❌ **Não fragmentar a marca.** As 14 lâminas do SVG são os 14 elementos
  animáveis. Nada de cell fracture ou subdivisão.
- ❌ **Não copiar geometria, shaders, texturas, assets ou código da Hebbia.** A
  referência serve apenas para qualidade do metal, leitura dos highlights,
  profundidade, suavidade, enquadramento e nível de acabamento.

---

## 6. O que a Fase Three.js precisa saber

### Convenções do JSON

| Convenção | Valor |
|---|---|
| Rotação canônica | **quaternion `[x, y, z, w]`** (mesma ordem do Three.js e do glTF) |
| Euler | só `euler_xyz_debug` — auxiliar/debug, **não usar na animação** |
| Transforms | **locais, relativos ao root `J3F_Symbol_Root`** |
| Espaço a usar | **`gltf_y_up`** — reproduz exatamente o TRS local dos nós do GLB |

Cada peça traz também `blender_z_up`; **ignore-o** no front-end. O campo
`conventions.glb_node_space` confirma qual usar (verificado lendo o GLB gerado,
não assumido).

### Hierarquia no GLB

```
J3F_Symbol_Root            (T=[0,0,0] R=[0,0,0,1] S=[1,1,1])
├── J3F_Bar_T1 … J3F_Bar_T7    (metade superior, colunas 1→7 da esquerda p/ direita)
└── J3F_Bar_B1 … J3F_Bar_B7    (metade inferior)
```

Nomes estáveis e determinísticos. O símbolo fica no plano XY olhando para +Z —
alinhado com a câmera default do Three.js.

### Modelo de animação

```
tLocal = clamp((t - delay * 0.30) / (1 - delay * 0.30), 0, 1)
p      = easeOutCubic(tLocal) = 1 - (1 - tLocal)³

position   = lerp(start.position, end.position, p)
quaternion = slerp(start.quaternion, end.quaternion, p)
scale      = lerp(start.scale, end.scale, p)
```

`t` é o progresso de scroll (0..1). `delay` vem de cada peça no JSON. O estado END
é o símbolo oficial — não deve ser alterado.

### Material

O GLB já carrega `metallic 1.0` / `roughness 0.155` / baseColor grafite. Para o
metal ler bem no Three.js será preciso um **environment map** — metal sem ambiente
renderiza preto. A iluminação do Blender (7 luzes + world gradiente) não é
exportada; terá de ser recriada no front-end como env map + luzes.

---

## 7. Fase 1 — protótipo Three.js (construído, não commitado)

Vive em `web/`, dentro deste repositório. Zero-build: `three` r186 vendorizado em
`web/vendor/`, resolvido por import map, servido por `python3 -m http.server`.
Nenhum `node_modules`, nenhum bundler.

Documentação completa: **`docs/THREEJS_PROTOTYPE.md`**.

```bash
python3 -m http.server 8123 --bind 127.0.0.1    # a partir da raiz do repo
# http://127.0.0.1:8123/web/index.html
```

Duas coreografias convivem, alternáveis no painel `?debug`:

- **Baseline** — a coreografia aprovada na Fase Blender, **inalterada**
  (`j3f-animation.js`, easeOutCubic, stagger 0.30, START→END direto).
- **Organic** — **aprovada visualmente** (`j3f-organic.js`): estados procedurais
  START→FLOW→PRE-ASSEMBLY→END, campo de movimento por coluna, trajetórias em
  Bézier cúbica, rotação alinhada à tangente, stagger sobreposto 0.165,
  respiração de root e dolly de câmera. **Nenhum estado novo é gravado no JSON.**

Sobre a coreografia roda a **microinteração** (`j3f-interaction.js`), aditiva:

```
scroll → Organic → BASE POSE → ambient idle → pointer → render
```

A base pose é recapturada dos nós a cada frame e os offsets são derivados de novo
a partir dela — nada é acumulado, logo não há drift. Com idle e pointer em zero o
resultado é **numericamente igual** à Organic.

Bateria `?selftest`: **35/35 PASS** em 1440×900, 1280×720 e 390×844, nos dois
modos. Destaques da coreografia:

| | baseline | organic |
|---|---|---|
| Nós associados | **14 / 14** | **14 / 14** |
| END vs. TRS dos nós do GLB | **6,097e-07** BU | **6,097e-07** BU |
| Root / dolly em `t = 1` | n/a | **exatamente** identidade / 1.0 |
| START em `t = 0` | **0,000e+00** | **0,000e+00** |
| Scroll ida e volta (histerese) | **0,000e+00** | **0,000e+00** |
| Δ² máx (descontinuidade) | 5,41e-03 | **3,88e-05** |
| Ordem de convergência de Δ² | 2,00× (C⁰) | **4,00× (C²)** |
| Custo de `apply()` por frame | 1,55 µs | 3,84 µs |
| Console | **sem erros, sem warnings** | idem |

Destaques da microinteração:

| | |
|---|---|
| Interação OFF = Organic | Δ **0,00e+00** |
| Drift em 6000 frames (100 s) | **0,00e+00** — base intacta, idle é função pura do tempo |
| Saída do ponteiro | converge a **exatamente 0** em 1,93 s, sem snap |
| Damping do ponteiro 30/60/120 Hz | Δ **1,11e-16** |
| Amplitudes (teto 0,025 BU / 1,5°) | pointer **0,0235 BU / 0,550°** |
| Base END com idle rodando 20 s | **6,097e-07** BU · root exatamente identidade |
| Custo total por frame | **7,01 µs** = 0,08% de um frame a 120 Hz |

GLB, JSON, `.blend`, `scripts/` e previews **não foram tocados** — `git status`
mostra apenas `web/` como novo, e o MD5 do `j3f-symbol-prototype.blend` continua
`2587aa933c5a5f8b5a94a6962ff1993f`.

---

## 8. Pendências

- [ ] **Ajuste visual da microinteração** (próximo passo — nada é commitado antes disso)
- [x] Avaliação visual A/B Baseline × Organic — **Organic aprovada**
- [ ] Decidir se o Baseline continua no código ou se é removido depois de o
      protótipo fechar
- [ ] Calibrar a dose de ciano: com `envSpread = 1.8` o acento ficou mais presente
      na metade inferior — pode estar forte demais
- [ ] Calibrar `exposure` / `envIntensity`: o AgX do Three.js é aproximação do AgX
      Medium High Contrast do Blender, não reprodução
- [ ] Decidir o enquadramento em retrato de celular: hoje o símbolo cai para ~25%
      da altura porque a dispersão de `t = 0` cabe inteira no quadro; a alternativa
      é permitir corte lateral (`FIT_MARGIN` em `web/src/j3f-framing.js`)
- [ ] Avaliar o estágio ~25% da animação — o painel `?debug` existe para isso
- [ ] Pós-processamento / DOF (fora do escopo da Fase 1, por decisão)
- [ ] Integração com Framer (fase posterior, **não iniciada**)
- [ ] Nenhum remote Git configurado — repositório é **local apenas**, por decisão

---

## 9. Próximo passo

> **Avaliação visual do protótipo pelo Oktavio.**

Abrir `http://127.0.0.1:8123/web/index.html?debug` e usar a seção **Ambient
Motion** para alternar `Idle + Pointer` / `Idle` / `Off`.

Julgar com o scroll parado em t = 1: a dose do idle (não pode virar screensaver),
a velocidade, o raio e a força do campo do ponteiro, e se a identidade da marca
continua intacta numa screenshot isolada.

Nada de commit, Framer ou deploy antes disso.

---

## 10. Estado do repositório

Git **local**, sem remote, por decisão explícita. Nada de push ou deploy.
