# J3F — Símbolo 3D interativo

Protótipo 3D interativo do símbolo oficial da J3F: as 14 lâminas da marca começam
dispersas em posição, profundidade e rotação e convergem até formar exatamente o
símbolo oficial, com movimento ligado ao scroll.

Este repositório contém a **Fase Blender** concluída: o pipeline que transforma o
SVG oficial em geometria 3D, materiais metálicos e os estados de animação
exportados para consumo no front-end.


> **Repositório público — espelho das nossas contribuições.**
> O símbolo oficial da J3F (SVG, `.blend`, `.glb`, renders) e o conteúdo do
> cliente ficam apenas no repositório privado e foram removidos de **todo** o
> histórico desta cópia. Por isso o protótipo de `web/` não roda sozinho daqui
> (falta `export/j3f-symbol.glb`); a versão no ar está em
> <https://j3f-simbolo-3d.vercel.app>.

## Objetivo

- Preservar fielmente o símbolo oficial da J3F: proporções, distâncias entre as
  lâminas, curvas internas, alinhamento e silhueta.
- Usar as **próprias 14 barras da marca** como elementos 3D animáveis, sem
  fragmentação artificial (nada de cell fracture ou subdivisão).
- Entregar um acabamento metálico premium, com iluminação, profundidade e
  suavidade compatíveis com referências de alto nível de acabamento.
- Produzir uma animação **original da J3F**: dispersão em X/Y/Z, rotação
  tridimensional e leve variação de escala convergindo para o símbolo montado.
  Sem movimento circular, órbita ou espiral.

## Estrutura de pastas

```
.
├── README.md                      este arquivo
├── PROJECT_STATE.md               handoff entre sessões — leia primeiro
├── .gitignore
├── docs/
│   ├── BLENDER_PIPELINE.md        documentação técnica do pipeline
│   ├── THREEJS_PROTOTYPE.md       protótipo Three.js (Fases 1 e 2)
│   ├── DEPLOY_VERCEL.md           deploy do protótipo na Vercel
│   ├── FRAMER_SITE.md             site J3F no Framer
│   └── SIZING_REFACTOR_LOG.md      refatoração responsiva do site no Framer
├── web/                           protótipo Three.js (zero-build)
├── scripts/                       pipeline Blender (headless, determinístico)
│   ├── j3f_config.py              todos os parâmetros num só lugar
│   ├── j3f_util.py                helpers (log, cor sRGB→linear, bbox)
│   ├── 01_import_svg.py           import, normalização, solda, renomeação
│   ├── 02_solidify.py             extrusão, bevel de malha, conversão, shading
│   ├── 03_materials.py            materiais A e B, world, luzes, câmera
│   ├── 04_states.py               root, END medido, START determinístico, easing
│   ├── 05_export.py               GLB + JSON + verificação contra o GLB gerado
│   ├── 06_render_previews.py      previews de material e de movimento
│   ├── build.py                   orquestra 01 → 06
│   └── deploy_vercel.sh           publica web/ na Vercel
├── j3f-symbol.svg                 símbolo oficial (fonte da verdade)
├── j3f-symbol-prototype.blend     cena inicial original — NÃO MODIFICAR
├── j3f-symbol-3d.blend            cena de trabalho gerada pelo build
└── export/
    ├── j3f-symbol.glb             geometria + material, estado END
    ├── j3f-symbol-states.json     estados START/END por peça + metadados
    ├── preview_material-A_grafite.png
    ├── preview_material-B_ciano.png
    └── preview_motion_000|025|050|075|100.png
```

## Pipeline Blender

```
j3f-symbol.svg
  → 01  import de curvas + normalização (escala uniforme, centro na origem,
        símbolo "em pé" no plano XZ) + solda de pontos degenerados + nomes estáveis
  → 02  extrusão exata + bevel de malha só no perímetro + conversão para mesh
  → 03  materiais metálicos (A e B), world de estúdio, 7 luzes, câmera
  → 04  root comum, estado END medido, estado START determinístico, easing/stagger
  → 05  export GLB + JSON, com verificação cruzada contra o GLB gerado
  → 06  previews Cycles (2 de material + 5 de movimento)
```

O build é **determinístico**: mesma entrada, mesma saída, byte a byte na geometria.
O estado START usa seed fixa (`0x4A3346`, "J3F" em bytes).

Detalhes técnicos, decisões e problemas resolvidos: **[docs/BLENDER_PIPELINE.md](docs/BLENDER_PIPELINE.md)**.

## Como executar o build

Requer Blender no PATH (`/opt/homebrew/bin/blender` nesta máquina).

```bash
# build completo: geometria + materiais + estados + GLB/JSON + 7 previews
blender -b --factory-startup --python scripts/build.py -- \
  --variant A --engine CYCLES --samples 180
```

Opções:

| Flag | Efeito |
|---|---|
| `--variant A\|B` | material aplicado no `.blend` e no GLB (default: `A`) |
| `--engine CYCLES\|BLENDER_EEVEE` | motor de render dos previews (default: `CYCLES`) |
| `--samples N` | amostras por preview (default: `128`) |
| `--skip-render` | só geometria/materiais/estados/export — ~0,3 s |
| `--no-save` | não grava o `.blend` |
| `--gpu` | tenta GPU no Cycles (ver aviso abaixo) |

Iterações rápidas de geometria:

```bash
blender -b --factory-startup --python scripts/build.py -- --skip-render
```

**Aviso sobre `--gpu`:** a detecção de dispositivo do Cycles trava em modo
headless nesta máquina (processo parado em 0% de CPU). Por isso o padrão é CPU.
O build completo em CPU leva ~130 s.

O `build.py` verifica o MD5/mtime do `j3f-symbol-prototype.blend` a cada execução
e emite warning se ele for tocado. Ele nunca é aberto nem gravado.

## Saídas

| Arquivo | Conteúdo |
|---|---|
| `export/j3f-symbol.glb` | 15 nós (root + 14 lâminas), 14 meshes, 1 material, estado END, sem animação |
| `export/j3f-symbol-states.json` | START/END por peça, delays do stagger, convenções, verificações |
| `export/preview_material-*.png` | comparação visual das variantes A e B |
| `export/preview_motion_*.png` | movimento em 0%, 25%, 50%, 75% e 100% |

Previews em 1200×1400, Cycles, AgX Medium High Contrast.

## Material escolhido

**Variante A — metal grafite com reflexos/acento ciano `#00B1CC`.** Aprovada.

- `baseColor` grafite neutro `[0.125, 0.132, 0.145]` (linear), `metallic 1.0`,
  `roughness 0.155`.
- O ciano da marca entra pela **luz** e pelo Specular Tint, não pelo pigmento:
  aparece como fio nas quinas e banho nas lâminas inferiores, mantendo a lâmina
  cinza. É o que separa "metal com acento de marca" de "plástico colorido".
- A variante B (metal ciano) permanece no `.blend` com fake user, para comparação
  futura. Trocar com `--variant B`.

## Ambiente

- **Blender 5.2.1 LTS** (build 2026-08-25, hash `9e2066aef7ef`)
- Addons usados: `io_curve_svg` (import), `io_scene_gltf2` (export) — ambos nativos
- macOS (Darwin 27.0.0), Apple Silicon
- Render: Cycles CPU, AgX

## Estado

Fase Blender **concluída e aprovada** (checkpoint no commit `b82b453`).

Fase 1 — protótipo Three.js standalone com scroll interativo — e Fase 2 —
**Circular Flow**, a onda de orientação que percorre o anel das 14 lâminas —
estão em `web/`, **concluídas e aprovadas visualmente**. Zero-build: `three`
vendorizado em `web/vendor/`, sem `node_modules`. Bateria `?selftest`: **47/47**.

```bash
python3 -m http.server 8123 --bind 127.0.0.1
# http://127.0.0.1:8123/web/index.html
# http://127.0.0.1:8123/web/index.html?debug&showFlowPhase
```

O Circular Flow **não** contradiz "sem movimento circular, órbita ou espiral"
acima: os centros das peças ficam praticamente parados (deslocamento radial
máximo de 0,25% da altura do símbolo). O que percorre o anel é a *orientação*,
não a peça.

Detalhes: **[docs/THREEJS_PROTOTYPE.md](docs/THREEJS_PROTOTYPE.md)**.
Handoff entre sessões: **[PROJECT_STATE.md](PROJECT_STATE.md)**.

Publicado na Vercel: **<https://j3f-simbolo-3d.vercel.app>** — republicar com
`scripts/deploy_vercel.sh`. Detalhes em
**[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)**.

### Site J3F no Framer

O site institucional foi implementado no Framer a partir do Figma (home + teste de
elegibilidade + calculadora PIS/COFINS + simulador CBS/IBS). Documentação em
**[docs/FRAMER_SITE.md](docs/FRAMER_SITE.md)**. O código dos componentes e o conteúdo
do cliente ficam no repositório privado.

A estratégia e a validação da refatoração de sizing responsivo estão em
**[docs/SIZING_REFACTOR_LOG.md](docs/SIZING_REFACTOR_LOG.md)**.

O repositório de trabalho é **privado** e contém o símbolo oficial da J3F (SVG
fonte da verdade, `.blend`, GLB e previews). Esta cópia pública não os inclui.
