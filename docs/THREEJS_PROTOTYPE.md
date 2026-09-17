# Protótipo Three.js — Fase 1

Protótipo standalone que carrega `export/j3f-symbol.glb` + `export/j3f-symbol-states.json`
e amarra a convergência das 14 lâminas ao scroll.

Zero-build: nenhum `node_modules`, nenhum bundler. O `three` r186 está vendorizado
em `web/vendor/` e resolvido por import map.

**Os arquivos da Fase Blender são somente leitura aqui.** GLB, JSON, `.blend`,
`scripts/` e previews não foram tocados — verificado por MD5 e por `git status`.

---

## Como rodar

```bash
cd "/Users/oktavio/Library/Mobile Documents/com~apple~CloudDocs/Projetos/J3F/Blender"
python3 -m http.server 8123 --bind 127.0.0.1
```

Abrir: <http://127.0.0.1:8123/web/index.html>

O servidor precisa subir na **raiz do repositório**, não dentro de `web/`: a página
lê os assets por caminho relativo (`../export/…`), sem cópia.

### Parâmetros de URL

| URL | Efeito |
|---|---|
| `…/web/index.html` | protótipo normal |
| `…/web/index.html?debug` | painel de controle (inclui o seletor Baseline / Organic) |
| `…/web/index.html?mode=baseline` | força a coreografia aprovada, sem abrir o painel |
| `…/web/index.html?mode=organic` | força a variante experimental |
| `…/web/index.html?t=0.25` | congela o progresso em 25% (aceita `?debug` junto) |
| `…/web/index.html?debug&showInfluence` | overlay do campo de influência do ponteiro |
| `…/web/index.html?selftest` | roda a bateria de validação e escreve o relatório em `#j3f-selftest` |
| `…/web/index.html?capture` | preserva o drawing buffer e publica o PNG do canvas no DOM (`&captureAt=ms` atrasa a captura) |

---

## Estrutura

```
web/
├── index.html                 página + import map
├── src/
│   ├── main.js                renderer, scroll, damping, loop, boot
│   ├── j3f-config.js          baseline (vem do Blender), luzes, world, câmera
│   ├── j3f-animation.js       coreografia BASELINE — START→END (puro, sem DOM)
│   ├── j3f-organic.js         coreografia ORGANIC — START→FLOW→PRE-ASSEMBLY→END
│   ├── j3f-interaction.js     camada aditiva — idle + pointer sobre a base pose
│   ├── j3f-environment.js     estúdio autoral + PMREM
│   ├── j3f-framing.js         enquadramento responsivo
│   ├── j3f-debug.js           painel ?debug
│   ├── j3f-selftest.js        bateria ?selftest
│   └── j3f.css
└── vendor/three/              three r186 (build + GLTFLoader + utils + LICENSE)
```

---

## Decisões técnicas

### Modelo de animação

`j3f-animation.js` implementa literalmente o que o JSON descreve:

```
tLocal = clamp((t − delay · maxDelay) / (1 − delay · maxDelay), 0, 1)
p      = 1 − (1 − tLocal)³
position   = lerp(start, end, p)
quaternion = slerp(start, end, p)
scale      = lerp(start, end, p)
```

- Só o bloco **`gltf_y_up`** é lido. `blender_z_up` e `euler_xyz_debug` são ignorados.
- Rotação sempre por **quaternion `[x,y,z,w]` + slerp**.
- **O END é inviolável por construção:** em `t = 1` todo `tLocal` é 1 e todo `p` é 1,
  então o TRS resultante é o END literal. Os multiplicadores do painel de debug
  deslocam apenas o estado **START** — nenhum deles alcança o END.
- O módulo não importa DOM nem renderer: dá para carregá-lo em Node para
  conferir a matemática.

### Damping independente de frame rate

```js
const alpha = 1 - Math.exp(-lambda * dt);
smooth += (target - smooth) * alpha;
```

`dt` vem do `Timer` do three e é limitado a `MAX_DELTA_TIME = 0.25 s` (protege
contra aba em background). `lambda = 6.0 s⁻¹` no baseline.

Medido: integrando 1,0 s a 30 Hz, 60 Hz, 120 Hz e com quedas de FPS no meio, o
resultado fica em `0.997521` nos três regimes fixos — idêntico ao analítico
`1 − e⁻⁶`. Espalhamento total `9.75e-04`.

O painel permite **desligar o damping** para comparar raw vs smooth.

### Scroll

`t` é função pura da posição de scroll:

```
t = clamp(−section.getBoundingClientRect().top / (section.offsetHeight − sticky.offsetHeight), 0, 1)
```

Não há estado acumulado, então ida e volta são **exatamente** reversíveis —
histerese medida de `0.00e+00` num varredura de 41 posições em ambos os sentidos.

A altura do palco mede o elemento sticky (`100svh`), não `window.innerHeight`:
no mobile a barra de endereço faz os dois divergirem.

### Environment autoral

O GLB carrega `metallic 1.0`; sem ambiente o material renderiza preto. A
iluminação do Blender não vai no glTF, então `j3f-environment.js` reconstrói o
estúdio e o assa em PMREM:

- **World**: domo com o mesmo ColorRamp EASE de `03_materials.py` (3 paradas,
  `0.22 / 0.58 / 0.95`, valores lineares), aplicado sobre a componente "para cima"
  da direção de visada — o `Generated.Z` do Blender vira `Y` em Y-up.
- **Luzes**: as 7 area lights viram planos emissivos nas mesmas posições
  (convertidas `(x, z, −y)`), tamanhos e cores. A intensidade relativa vem da
  física do Cycles: `L = P / (A · π)`. Isso preserva a proporção entre as luzes
  sem chutar valores.

Nada de terceiros: nenhum HDRI, textura ou asset externo.

O mesmo domo entra na cena principal como fundo visível, com tone mapping
aplicado — na cena de environment ele é linear (o PMREM desliga tone mapping).

### Tone mapping

`AgXToneMapping` do Three.js. **Não reproduz o "AgX Medium High Contrast" do
Blender** — é uma aproximação. O ajuste visual é feito em `exposure` e
`scene.environmentIntensity`; o material do GLB não é alterado em nenhum momento.

Sem pós-processamento nesta versão (logo, sem o DOF f/5.6 dos previews).

### Enquadramento responsivo

O baseline do Blender foi calibrado num quadro **retrato 1200×1400**. Copiar o FOV
não funciona na web, onde o aspect varia. `j3f-framing.js` preserva a intenção com
duas regras, nesta ordem:

1. a câmera **nunca** chega mais perto que a distância baseline (6,358 BU) — isso
   trava o teto de ~61% de altura do símbolo montado;
2. a câmera recua o quanto for preciso para que a **coreografia inteira** caiba no
   quadro, inclusive a dispersão de `t = 0`.

A regra 2 é resolvida por bisseção sobre os cantos das bounding boxes das 14 peças,
amostradas em `t ∈ {0, 0.08, 0.16, 0.25, 0.4}`. O FOV vertical fica fixo em 28,84°
(70 mm / sensor 36 mm) e a direção da câmera é a do baseline, `(1.00, 0.60, 6.25)`
normalizada.

Resultado medido:

| Viewport | distância | símbolo / altura | ocupação do quadro |
|---|---|---|---|
| 1440×900, 1920×1080, 1024×768, 1600×500 | 6,36 BU (baseline) | 61,2% | 0,961 |
| 900×900 | 7,49 BU | 51,9% | 0,980 |
| 390×844 | 15,44 BU | 25,2% | 0,980 |
| 360×740 | 14,70 BU | 26,4% | 0,980 |

**Pendência de design:** em retrato de celular o símbolo cai para ~25% da altura,
porque a dispersão lateral de `t = 0` é larga para um FOV horizontal estreito.
Nada quebra, mas fica pequeno. Se for preferível, dá para permitir corte lateral
no retrato afrouxando a margem horizontal em `j3f-framing.js` (`FIT_MARGIN`) —
decisão de enquadramento, não de código.

### prefers-reduced-motion

`REDUCED_MOTION_MODE = 'static'` em `j3f-config.js`: trava no estado END (símbolo
oficial montado). A alternativa `'direct'` (segue o scroll 1:1, sem inércia) está
implementada e é uma troca de uma linha.

---

## Coreografia ORGANIC (variante experimental)

Vive em `web/src/j3f-organic.js`, como subclasse de `J3FAnimation` que substitui
apenas `apply()`. **O baseline não foi tocado** — é selecionável no painel e
continua byte a byte o que era antes.

O diagnóstico era que o movimento lia como "14 objetos independentes indo de A
até B". O que mudou:

### Estados procedurais intermediários

```
START  ──────►  FLOW  ──────►  PRE-ASSEMBLY  ──────►  END
 p=0            p≈0.38            p≈0.80              p=1
```

START e END continuam vindo **literalmente do JSON**. FLOW e PRE-ASSEMBLY são
derivados em runtime e não são gravados em lugar nenhum.

Os estágios **não são segmentos concatenados** — isso produziria emendas. São
envelopes contínuos (`smootherstep`, C²) sobre um único caminho paramétrico.
Continuidade é propriedade de construção, não conserto.

### Campo de movimento por topologia, não random por peça

Cada peça recebe `u = (column − 4) / 3` ∈ [−1, 1] e o sinal da metade. Daí saem
três termos, todos funções suaves de `u` — colunas vizinhas recebem valores quase
iguais, que é o que amarra as peças num sistema só:

| Termo | Fórmula | Leitura |
|---|---|---|
| arco lateral | `perp(corda) · arcLateral · \|u\| · \|corda\|` | as externas fazem a curva mais aberta |
| casca de profundidade | `depthShell · cos(πu/2) · sinal(z₀)` | quem vem de trás continua atrás; sem cruzamentos |
| respiração vertical | `VERT_SWING · sinal(metade) · (0.4 + 0.6\|u\|)` | top sobe, bottom desce, e fecham |

A perpendicular sai da própria corda START→END, então o campo é suave por
construção. Nenhum novo `random` foi introduzido.

### Trajetórias curvas

Bézier cúbica com pontos de controle deterministas:

```
P0 = START
P1 = START + corda/3   + offset
P2 = START + 2·corda/3 + offset · 0.55
P3 = END
```

Durante o SETTLE a posição é misturada de volta para a corda reta
(`lerp(reta, bézier, curvature · settleEnvelope(p))`), o que faz a curvatura
morrer antes da chegada. Como Bézier e corda coincidem nas pontas, `p=0` dá START
exato e `p=1` dá END exato, qualquer que seja a curvatura.

### Rotação acompanha o movimento

A tangente do caminho real é medida por diferença central e vira uma orientação
FLOW:

```
qStart = slerp(END, START, rotationMultiplier)
qFlow  = banking(tangente)
qA     = slerp(qStart, qFlow, flowStrength · bump(p, 0.38) · settleEnvelope(p))
q      = slerp(qA, END, p)
```

O banking é **proporcional às componentes da tangente unitária**, não a
`atan2(t.x, t.y)`. O atan2 tem corte de ramo em ±π: qualquer peça com tangente
apontando para baixo que cruzasse a vertical faria o ângulo saltar 2π. Isso foi
medido — salto de `4.4e-01` em t≈0.37 — e é justamente o que o teste de
continuidade pegou.

A rotação principal é em torno do **eixo de visada**, que é o único eixo que não
leva a lâmina a ficar de perfil. É o que elimina os flashes preto/branco.

### Easing: por que não é o easeOutCubic do baseline

`easeOutCubic` tem derivada 3 na origem: cada peça **entra** em movimento com
velocidade não nula no instante em que seu delay vence. Com o stagger de 0.30 isso
passa despercebido; com o stagger sobreposto de 0.165 vira um pipoco de 14
largadas — exatamente o oposto de "um sistema só". E é uma descontinuidade de C¹.

```
organicEase(x) = 1 − (1 − smootherstep(x))²
```

Monotônica, sem overshoot, 1ª e 2ª derivadas nulas em 0 e em 1, com o peso
deslocado para o início. Medido: a segunda diferença do organic converge em
**O(h²)** (razão 4.00× ao dobrar a amostragem) enquanto a do baseline converge em
**O(h)** (razão 2.00×) — a assinatura numérica de C² contra C⁰.

### Stagger em onda contínua

`delayNorm = (1 − cos(π·\|u\|)) / 2`, mais uma defasagem de 0.15 para a metade
inferior, tudo escalado por `organicStagger` (0.165). Não usa o `delay` discreto
do JSON. As transições se sobrepõem muito mais.

### Respiração do sistema

| | de | para | envelope |
|---|---|---|---|
| `rootScale` | 1.04 | 1.00 | `1 − smootherstep(t)` |
| `root.position` | (0, −0.06, +0.10) | (0, 0, 0) | idem |
| dolly da câmera | +5.5% | 0% | idem |

O envelope chega a zero com derivada nula: em `t = 1` o root é **exatamente**
identidade e o dolly **exatamente** 1.0 — verificado no `?selftest` com erro 0.

### Redução de aleatoriedade visual

| Controle | Baseline experimental | Efeito |
|---|---|---|
| `rotationMultiplier` | 0.70 | reduz a rotação de START **em relação ao END**, proceduralmente |
| `scaleVariationMultiplier` | 0.25 | escala efetiva de START vai de 0.84–1.13 para **0.964–1.030** |

Nenhum dos dois toca o JSON. Com ambos em 1.0 o `t = 0` volta a ser o START
literal — há um teste que prova isso.

### Environment mais largo

Dois controles novos, ambos sem tocar o material do GLB:

- **largura das fontes** (`envSpread`, 1.8): aumenta o tamanho dos emissores. A
  radiância cai com o quadrado do fator, então a **potência total é conservada** —
  o highlight fica mais largo e mais gradual, não mais forte.
- **softness** (`envSoftness`, 0.02): blur do PMREM (sigma).

Além disso os painéis deixaram de ser chapados: têm queda radial suave
(`smoothstep` sobre o raio em UV), com a média da queda calculada numericamente
para dividir a radiância e conservar a potência. É o que troca `preto → branco`
por `dark → midtone → broad highlight → midtone`.

### Custo

Medido fora do navegador (Node, relógio real), para as 14 peças:

| | µs por frame |
|---|---|
| baseline | **1,55** |
| organic | **3,84** (2,48×) |

0,05% do orçamento de um frame a 120 Hz. O número não é medível dentro do headless
sob `--virtual-time-budget`, e o `?selftest` diz isso em vez de inventar um valor.

---

## Microinteração (idle + pointer)

`web/src/j3f-interaction.js`. É uma camada **aditiva**, aplicada depois da pose
que a coreografia produziu. **A Organic não foi tocada.**

```
scroll → Organic → BASE POSE → ambient idle → pointer → render
```

### A regra que elimina drift

A cada frame a base pose é **recapturada dos nós** e os offsets são derivados de
novo a partir dela. Nada é aplicado sobre o resultado do frame anterior:

```
position   = base.position + offset
quaternion = base.quaternion * offsetQuaternion
```

Consequência medida: depois de **6000 frames** (100 s simulados) de idle +
pointer, a base pose continua **bit a bit idêntica** (Δ = 0), e o idle é função
pura do tempo — avaliar direto em `t` dá exatamente o mesmo que chegar lá somando
4000 frames.

Com `idle = 0` e `pointer = 0` o resultado é **numericamente igual** à Organic
(Δ = 0 em posição, quaternion, escala e root).

### Idle permanente

Duas senoides lentas sobrepostas, de períodos **17 s** e **26,5 s** — razão
irracional o bastante para não ler como pêndulo:

```
idleWave(t, φ, v) = 0.62·sin(ω₁·v·t + φ) + 0.38·sin(ω₂·v·t + 1.37φ + 1.9)
```

A fase de cada peça sai de `column`, `half` e da posição END:

```
φ = u · 2.1 + (metade inferior ? 1.05 : 0) + end.y · 0.6
```

Colunas vizinhas recebem fases próximas, então **respiram de forma
correlacionada**. Cada canal (Y, Z, rot X, rot Y) tem sua própria defasagem, para
os eixos não andarem juntos.

Amplitudes de referência, todas ajustáveis no painel:

| | amplitude |
|---|---|
| peça Y | ±0,006 BU |
| peça Z | ±0,010 BU |
| peça rot X / Y | ±0,45° |
| root Y | ±0,008 BU |
| root Z | ±0,006 BU |
| root yaw | ±0,15° |

Medido na tela com o scroll congelado em `t = 1`: três capturas em 0,6 s, 5 s e
11 s são todas diferentes — o objeto está vivo — e entre a primeira e a terceira
apenas **0,18% dos pixels** mudam mais que 8/255. Vivo, não screensaver.

### Peso pelo grau de montagem

O objeto disperso já tem movimento de sobra; montado é onde ele pareceria morto.
Por isso o idle cresce:

```
assemblyWeight(t) = floor + (1 − floor) · smootherstep(t)     floor = 0.35
```

| t | 0 | 0.4 | 0.7 | 1 |
|---|---|---|---|---|
| peso | 35% | 56% | 89% | 100% |

### Pointer: campo de influência, não hover booleano

Cada lâmina é projetada para NDC a partir da **base pose** e comparada com o
ponteiro. O X entra corrigido pelo aspect, para o campo ser circular em pixels:

```
d = hypot((px − nx)·aspect, py − ny)
w = 1 − smootherstep(d / influenceRadius)
```

O deslocamento é um **campo magnético** `delta · w`, não `normalize(delta) · w`:
vale zero embaixo do cursor (a peça já está lá), zero longe, e tem máximo no meio.
Normalizar estouraria no centro. O campo é dividido pelo seu próprio máximo
(0,2731), então **o slider do painel vale exatamente o deslocamento máximo em BU**.

Sem `Raycaster`: proximidade em screen space é mais barata e mais suave.

### Damping do ponteiro

`alpha = 1 − exp(−λ·dt)`, igual ao scroll. O alvo segue o mouse na hora; o valor
aplicado persegue com λ = 6. Medido: 30 Hz, 60 Hz e 120 Hz chegam ao mesmo valor
com Δ de **1,1e-16**.

Quando o ponteiro sai, o alvo vira 0 e a ativação desce sozinha — **sem snap**.
Verificado: nenhum passo excede `1 − exp(−λ·dt)`, o primeiro passo analítico da
exponencial. Em 1,93 s a ativação chega a **exatamente zero** (há um snap-to-zero
abaixo de 1e-5), e a partir daí a pose volta a ser a Organic exata.

A ativação **nunca** é zerada por booleano. Desligar o ponteiro ou trocar de modo
leva o alvo a zero e deixa o damping trabalhar — foi um snap de `1,7e-02` num
único frame que o teste de continuidade pegou nesta implementação.

### Sem bloquear o DOM

- `#j3f-canvas { pointer-events: none }` — o canvas nunca intercepta nada;
- os eventos são ouvidos no **window**, com `{ passive: true }`;
- o `pointermove` só guarda `clientX/clientY`; a conversão para NDC e a leitura
  do `getBoundingClientRect` acontecem **uma vez por frame**, o que evita
  layout thrash e garante que o rect nunca fique velho quando a seção entra no
  sticky;
- nenhum `preventDefault`, nenhum `setPointerCapture`.

### Desktop / mobile / reduced motion

| Condição | idle | pointer |
|---|---|---|
| `(hover: hover) and (pointer: fine)` | 100% | ligado |
| ponteiro grosso (touch) | **45%** | desligado |
| `prefers-reduced-motion` | desligado | desligado |

Sob reduced motion a pose é **exatamente** a da coreografia (Δ = 0); scroll e END
continuam funcionais.

### rAF e performance

Com idle permanente o loop precisa desenhar todo frame — aprovado para desktop.
Mas ele **para de verdade**:

- `visibilitychange` → `document.hidden` encerra o rAF;
- um `IntersectionObserver` no palco encerra o rAF quando a seção sai da viewport;
- ao religar, o `dt` acumulado na pausa é descartado: o idle retoma sem salto;
- sem idle e sem ponteiro, volta a valer o desenho sob demanda.

Nenhum `Vector3`/`Quaternion` é alocado por frame: a base pose e os temporários
são pré-alocados no `bind()`.

| | µs por frame |
|---|---|
| Organic sozinha | 3,75 |
| Organic + captureBase + idle + pointer | **7,01** |

0,08% do orçamento de um frame a 120 Hz.

### Limites acordados

| | teto | medido |
|---|---|---|
| deslocamento por peça (pointer) | 0,025 BU | **0,0235 BU** |
| rotação por peça (pointer) | 1,5° | **0,550°** |
| idle Y / Z | 0,006 / 0,010 BU | **0,00600 / 0,01000 BU** |
| idle rotação | 0,45° | **0,225°** |

Varridos 21 × 21 posições de ponteiro × 5 valores de `t`.

---

## Painel `?debug`

| Grupo | Controles |
|---|---|
| **animation mode** | **Organic (experimental) / Baseline (aprovado)** |
| progresso | raw scroll · damped · p final (lead / tail / média) · estágio · slider manual 0–1 · presets 0/25/50/75/100% |
| damping | liga/desliga (raw vs smooth) · lambda |
| organic · coreografia | organicStagger · rotationMultiplier · scaleVariationMultiplier · curvature · arco lateral · casca de profundidade · flowStrength |
| organic · sistema | rootMotion · cameraDolly |
| baseline · coreografia | stagger max · rotation × · position × (X/Y) · depth × (Z) · scale × |
| **ambient motion** | **Interaction Mode (Off / Idle / Idle + Pointer)** · idle enabled · idle amount · idle speed · piece float · piece rotation · root float · assembly weight |
| **pointer interaction** | pointer enabled · influence radius · position strength · depth strength · rotation strength · root tilt · pointer damping · show influence debug · estado do ponteiro |
| câmera | auto-fit · FOV · distância · símbolo/altura |
| render | environment (PMREM) · env intensity · exposure · largura das fontes · softness |
| status | nós associados · erro END (baseline e organic) · escala START efetiva · fps · hover/reduced · viewport |
| | **reset baseline** |

O `reset baseline` preserva o modo selecionado, para não atrapalhar a comparação
A/B. Os sliders de environment reassam o PMREM com 180 ms de debounce.

Mexer no slider de distância desliga o auto-fit automaticamente. O reset volta
exatamente para `BASELINE` em `j3f-config.js`.

---

## Validação (`?selftest`)

Roda no navegador de verdade e escreve o relatório em `#j3f-selftest`,
`window.__J3F_SELFTEST` e no `document.title` (`SELFTEST:OK` / `SELFTEST:FAIL`).

Resultado — **35/35 PASS** em 1440×900, 1280×720 e 390×844, nos dois modos.

**Baseline** (inalterado):

| Verificação | Resultado |
|---|---|
| convenção `gltf_y_up` · stagger do JSON | ok |
| nós associados | **14/14** |
| END == TRS dos nós do GLB | **6,097e-07** BU; rotação e escala **exatamente 0** |
| START == JSON em `t = 0` | **0,000e+00** |
| ida e volta reversível | **0,000e+00** |
| progresso monotônico | sem recuo |
| damping independente de FPS | Δ **9,75e-04** |
| coreografia em quadro | 7 viewports, nada fora |

**Organic**:

| Verificação | Resultado |
|---|---|
| `t = 0` = START efetivo | posição **0,000e+00** (idêntica ao JSON), rotação e escala **0** |
| multiplicadores = 1 ⇒ START literal | **0,000e+00** |
| `t = 1` = END exato | TRS **6,097e-07** · root escala **0** · root posição **0** · dolly **0** |
| ida e volta reversível | **0,000e+00** |
| progresso monotônico | sem recuo |
| **sem descontinuidade FLOW/PRE-ASSEMBLY/END** | Δ¹ máx **3,62e-03** · Δ² máx **3,88e-05** (limiar 1e-04) |
| **segunda diferença converge em O(h²)** | organic **4,00×** ao dobrar N · baseline **2,00×** |
| escala START efetiva | **0,964 – 1,030** |
| coreografia em quadro | 3 viewports, nada fora |

**Microinteração**:

| Verificação | Resultado |
|---|---|
| interação OFF = Organic exata | Δ **0,00e+00** (posição, quaternion, escala, root) |
| **sem drift em 6000 frames** (100 s) | base intacta Δ **0,00e+00** · idle é função pura do tempo Δ **0,00e+00** |
| saída do ponteiro converge a zero, sem snap | ativação → **exatamente 0** em 1,93 s · maior passo **0,09516** = primeiro passo analítico |
| damping do ponteiro independente de FPS | 30/60/120 Hz · Δ **1,11e-16** |
| ligar / desligar o ponteiro sem salto | ao ligar Δ **0,00e+00** · ao desligar Δ **1,63e-03** em um frame |
| amplitudes dentro dos tetos | pointer **0,0235 BU** / **0,550°** · idle **0,00600 / 0,01000 BU** / **0,225°** |
| `prefers-reduced-motion` | idle e pointer desligados · Δ **0,00e+00** |
| touch/coarse não ativa hover | `pointerOn = false` · idle a **45%** · ativação **0** |
| base END com idle rodando (20 s) | TRS **6,097e-07** · root **0,00e+00** |
| peso do idle cresce com a montagem | 35% → 56% → 89% → 100% |

**Comuns**: scroll real 0→1→0 com histerese **0,00e+00**, 14.504 triângulos/frame,
`gl.getError() = 0`, console **sem erros e sem warnings**.

O teste de ordem de convergência é o que realmente separa "suave" de "com vinco",
sem depender de limiar escolhido a dedo: amostrando com passo `h`, uma função C²
dá `d² ~ O(h²)` (dobrar N divide por ~4) e um vinco dá `d² ~ O(h)` (divide por ~2).
Foi esse teste que pegou o salto de `4,4e-01` do `atan2` antes da correção.

### Prova de que o idle está vivo na tela

Com o scroll congelado em `t = 1` (`?capture&t=1&captureAt=…`), três capturas do
framebuffer em 0,6 s, 5 s e 11 s têm MD5 diferentes — o objeto se mexe de verdade
pelo loop de render real. Entre a primeira e a terceira, apenas **0,18% dos
pixels** mudam mais que 8/255: vivo, não screensaver.

### Como rodar a bateria fora do navegador

Com o servidor de pé, usando o Chromium do cache do Playwright:

```bash
CHR=~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell
"$CHR" --headless --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=1440,900 --virtual-time-budget=20000 --dump-dom \
  "http://127.0.0.1:8123/web/index.html?selftest"
```

O `--screenshot` do headless **não compõe o canvas WebGL**. Por isso existe o
`?capture`: ele publica `canvas.toDataURL()` em `#j3f-capture`, que pode ser
extraído do `--dump-dom` e decodificado.

---

## O que ficou de fora desta fase

- pós-processamento (e portanto o DOF f/5.6 dos previews);
- integração com Framer;
- deploy, commit e push;
- ajuste fino do estágio ~25% — o painel existe justamente para essa avaliação.
