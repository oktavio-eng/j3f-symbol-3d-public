# Protótipo Three.js — Fases 1 e 2

Protótipo standalone que carrega `export/j3f-symbol.glb` + `export/j3f-symbol-states.json`
e amarra a convergência das 14 lâminas ao scroll.

- **Fase 1** — coreografia (baseline + Organic), enquadramento, environment,
  microinteração (idle + pointer). Concluída e commitada.
- **Fase 2** — **Circular Flow**: a onda de orientação que percorre o anel das
  14 lâminas. Concluída, aprovada visualmente em 2026-09-17.

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
| `…/web/index.html?debug&showFlowPhase` | overlay da onda do Circular Flow (14 dots + tira na ordem do anel) |
| `…/web/index.html?flow=off` | desliga o Circular Flow sem abrir o painel (A/B rápido) |
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
│   ├── j3f-flow.js            CIRCULAR FLOW — onda de orientação pelo anel (Fase 2)
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

## Circular Flow (Fase 2)

O loop do símbolo **não** vem de peças orbitando. Vem de uma **onda de
orientação** percorrendo as 14 lâminas ao longo de um anel fechado. Os centros
ficam praticamente parados; o que viaja é tilt, pitch/yaw, uma profundidade
mínima e — metade do efeito — a leitura de luz.

`web/src/j3f-flow.js`. Como os outros módulos de movimento, não lê `window`,
`matchMedia`, eventos nem o relógio: quem injeta tempo, progresso e capacidades
é o `main`. É o que permite ao `?selftest` medir periodicidade e amplitude de
forma determinista.

### Ordem na cadeia

```
Organic base pose  →  CIRCULAR FLOW  →  Ambient Micro Float  →  Pointer  →  render
```

Está literal em `render()` (`web/src/main.js`). O ponto que sustenta a seção 10
da especificação: o flow roda **antes** de `interaction.captureBase()`, então a
base que o idle e o ponteiro enxergam já é *Organic + Flow*. O ponteiro perturba
a onda **sem nunca pausá-la nem resetá-la**, porque ele é aditivo sobre ela; ao
sair, o damping devolve a peça exatamente para a onda no tempo corrente.

Não acumula nada: `J3FAnimation.apply()` reescreve o TRS inteiro a cada frame
antes desta camada, então somar offsets in place é seguro — a mesma filosofia
que sustenta a ausência de drift no idle.

### O anel

```
T1 → T2 → T3 → T4 → T5 → T6 → T7
                                 ↓
B1 ← B2 ← B3 ← B4 ← B5 ← B6 ← B7
 ↓
T1
```

O índice no anel sai só da topologia, nunca de uma lista de nomes:

```
top:     coluna 1..7  →  ring 0..6
bottom:  coluna 7..1  →  ring 7..13
theta_k = 2π · ring / 14
```

`RING_ORDER` existe no módulo apenas como referência legível e como oráculo do
`?selftest`, que confere as duas derivações uma contra a outra.

### A onda

```
wave(θ, t, φ) = [ sin(θ − dir·ω·t + φ) + h · sin(2θ + dir·½·ω·t + φ) ] / (1 + h)
```

Dividida por `(1 + h)` para que `|wave| ≤ 1` sempre — é o que faz cada slider do
painel valer **exatamente** a amplitude máxima, e não um número aproximado que
cresce junto com o harmônico.

**Sobre o sinal.** A especificação discorda de si mesma: a seção 2 desenha a
ordem com setas (`T1→…→T7→B7→…→B1→T1`), mas a fórmula "conceitual" da seção 7
escreve `sin(theta + t)`, cuja crista fica em `θ = π/2 − ω·t` — ou seja, anda no
sentido **contrário** ao das setas. Vale o diagrama, que é a parte explícita. O
toggle `flowReverse` inverte, e o `?selftest` prende a direção medindo o tempo em
que a crista chega a cada posição do anel.

**Sobre o segundo harmônico.** A especificação sugeria `t*0.55`. Aqui o rate é
**½**, e é deliberado: com `0.55 = 11/20` o campo só se repetiria depois de 20
voltas (102 s na configuração final), e a seção 2 pede fase "perfeitamente
periódica". Com ½ a repetição exata é 2 voltas. O harmônico continua cumprindo
seu único papel, que é quebrar a perfeição mecânica — e continua contra-rotante.

### Por que pitch e yaw a um quarto de ciclo

Pitch e yaw defasados de `π/2` fazem a normal da lâmina **precessar num cone**. É
isso que lê como *torção*, e não como uma aba batendo num eixo só. O roll entra
com peso pequeno (0,22) de propósito: girar no plano da tela muda a silhueta da
marca, enquanto pitch/yaw mudam apenas o ângulo de reflexão — que é o efeito
desejado.

A rotação é **pós-multiplicada** (`node.quaternion.multiply(offset)`), ou seja,
em torno dos eixos **locais** da lâmina, e não de um eixo global do símbolo.
Mesma convenção do idle e do ponteiro.

### Luz faz metade do trabalho

Nada disso tenta resolver a sensação geometricamente. Quando a lâmina inclina ela
sai do ângulo de reflexão, escurece, quase some, e depois captura de novo a
strip. Medido: com o flow ligado e desligado **no mesmo instante**, 3,86% dos
pixels mudam, com delta máximo **237/255**. A geometria só entrega o ângulo; o
material grafite + bevel + environment fazem o resto.

### Contraste no fim da montagem

A especificação proíbe mexer no material. O boost mexe **só no grading**, como
multiplicador sobre os valores do painel, nunca escrito de volta neles:

| `t` | exposure | environmentIntensity |
|---|---|---|
| ≤ 0,60 | ×1,000 | ×1,000 |
| 0,60 → 0,95 | rampa `smootherstep` | rampa `smootherstep` |
| ≥ 0,95 | **×0,900** | **×1,250** |

Exposure desce (afunda os darks) e o environment sobe (empurra as fontes
especulares): darks mais profundos e highlights mais dramáticos, sem tocar em
metallic nem roughness. Com o flow desligado o grading é identidade **exata**.

### Peso ao longo da montagem

A Organic domina a viagem; o Circular Flow domina a sensação de vida no estado
final. Os quatro pontos pedidos eram 20% / 50–60% / 85–90% / 100%.
`smootherstep` puro passa de 95% em `t = 0.8` — fora da faixa. Por isso a curva é
a mistura que encosta nos quatro alvos, continuando polinomial (sem vinco) em
todo o intervalo:

```
s(t)  = 0.4 · smootherstep(t) + 0.6 · t
peso  = floor + (1 − floor) · s(t)          floor = 0.20
```

| `t` | 0 | 0,5 | 0,8 | 1 |
|---|---|---|---|---|
| peso | **20,0%** | **60,0%** | **88,5%** | **100,0%** |

### Parâmetros finais aprovados

Aprovados visualmente em **2026-09-17**. Vivem em `BASELINE`, em
`web/src/j3f-config.js`; o `reset baseline` do painel volta exatamente para cá.

| Controle | Valor | Faixa sugerida pela spec |
|---|---|---|
| `flowEnabled` | `true` | — |
| `flowAmount` (mestre) | **1,240** | — |
| `flowLoopDuration` | **5,100 s** | 6–9 s ⚠️ |
| `flowTilt` | **2,300°** | ±1–3° ✅ |
| `flowDepth` | **0,016 BU** | 0,008–0,015 ⚠️ |
| `flowRadial` | **0,004 BU** | começar em 0 ⚠️ |
| `flowHarmonic` | **0,150** | 0,12–0,18 ✅ |
| `flowContrast` | **1,000** | — |
| `flowAssemblyFloor` | **0,200** | 20% em `t=0` ✅ |
| `flowReverse` | `false` (sentido do diagrama) | — |

⚠️ Três valores ficaram fora das faixas sugeridas. **A aprovação visual
prevalece** — o registro existe para que o desvio seja uma decisão consciente e
não um acidente de slider.

`flowAmount` multiplica tilt, depth e radial, então as amplitudes **efetivas**
em `t = 1` são 1,24× os números da tabela:

| | slider | efetivo em `t = 1` |
|---|---|---|
| tilt (pitch) | 2,300° | **2,852°** |
| profundidade | 0,016 BU | **0,01984 BU** |
| radial | 0,004 BU | **0,00496 BU** = 0,25% da altura do símbolo |
| rotação composta medida | — | **2,890°** |

### Os dois tempos, que não são o mesmo

| | duração | o que é |
|---|---|---|
| **Volta** | **5,1 s** | a crista completa o anel: 14 peças × 0,3643 s. É o "loop" no sentido visual, e é nele que a fundamental fecha. |
| **Repetição exata** | **10,2 s** | o campo inteiro volta ao mesmo estado. O segundo harmônico é contra-rotante a **metade** da velocidade: em `t + 5,1 s` ele troca de sinal e só volta ao mesmo valor em `t + 10,2 s`. |

O `?selftest` mede os dois. É o que impede alguém de mexer no `HARMONIC_RATE` e
quebrar a periodicidade em silêncio.

### Desktop / mobile / reduced motion

| Contexto | Circular Flow |
|---|---|
| desktop | amplitude cheia (`amount` 1,240) |
| touch / coarse pointer | **mantido**, a 60% (`amount` 0,744) |
| `prefers-reduced-motion` | **desligado**, Δ **0,00e+00** |

### O que o flow NÃO toca

GLB, JSON, Blender, trajetória Organic, START, END, stagger e o easing da
Organic continuam intocados. Com `flowEnabled = false`, `idle = off` e
`pointer = off`, o resultado é **numericamente idêntico** à Organic — Δ
**0,00e+00**, verificado no `?selftest`.

O invariante "`t = 1` = END literal" continua valendo para a **base pose**. Como
o idle, o flow mexe o objeto em `t = 1` — é o objetivo da camada. O END oficial
segue sendo o que `animation.apply(1)` escreve, e é isso que os testes de END
medem.

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
| **circular flow** | **circular flow enabled** · amount (mestre) · loop duration · tilt amount · depth amount · radial amount · secondary harmonic · contrast boost at END · assembly weight · inverter sentido da onda · show flow phase · peso efetivo · tira de 14 células na ordem do anel |
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

Resultado — **47/47 PASS** em 1440×900, nos dois modos. Os 35 checks da Fase 1
continuam com os **mesmos números**; os 12 da Fase 2 são novos.

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

**Circular Flow** (Fase 2, com os parâmetros finais aprovados):

| Verificação | Resultado |
|---|---|
| Circular Flow OFF = Organic exata | Δ **0,00e+00** |
| **flow + idle + pointer OFF = Organic exata** | Δ **0,00e+00** (as três camadas desligadas) |
| fase percorre o anel T1→T7→B7→B1 | ordem `0..13` · passo **0,448799 rad** (erro **8,88e-16**) |
| **a crista viaja no sentido do diagrama** | **0,3643 s** por peça (erro **1,46e-04 s**) · `flowReverse` inverte · volta 5,1 s / 14 peças |
| **periodicidade: volta 5,1 s** | fundamental fecha em 5,1 s: Δ **3,12e-17** |
| **periodicidade: repetição exata 10,2 s** | campo completo: Δ **1,99e-17** · em 5,1 s o harmônico troca de sinal: Δ **6,50e-03** (>0 esperado) |
| **sem drift em 6000 frames** (100 s) | base intacta Δ **0,00e+00** · END **6,097e-07** |
| amplitudes dentro dos tetos | `amount` 1,240 · rotação **2,890°** (teto composto 5,904°) · Z **0,01984 BU** · XY **0,00496 BU** = **0,25%** da altura do símbolo |
| peso cresce com a montagem | **20,0% → 60,0% → 88,5% → 100,0%** (alvos 20 / 50-60 / 85-90 / 100) |
| `prefers-reduced-motion` desliga o flow | Δ **0,00e+00** · touch mantém a **60%** (`amount` 0,744) |
| **ponteiro perturba a onda sem pausar nem resetar** | perturbação **2,04e-02** · volta à onda Δ **0,00e+00** · fase intacta Δ **0,00e+00** |
| contrast boost só no grading e só no fim | off/`t=0`/`t=0,6` ×1,000 · `t=1` exposure **×0,900** env **×1,250** |
| **sem vinco no tempo (Δ² em O(h²))** | **4,00×** ao dobrar N (C² ≈ 4×) |

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

### Prova de que o Circular Flow está na tela

Mesma técnica, comparando `?capture&t=1` com `?capture&flow=off&t=1` **no mesmo
instante**: **3,86% dos pixels** mudam mais que 8/255, com delta máximo
**237/255**. É a assinatura do comportamento pedido na seção 4 da especificação —
a lâmina sai do ângulo de reflexão, escurece, quase some, e depois recaptura a
strip.

**Ressalva honesta sobre o método.** Esse diff **não** serve para medir o
*timing* da onda: sob `--virtual-time-budget` o relógio do headless quase não
avança entre capturas (entre 2500 ms e 4400 ms virtuais, dois frames com o flow
ligado diferem em apenas 0,01% dos pixels). Quem prova o percurso e a
periodicidade são os checks determinísticos do `?selftest`, que injetam o tempo
diretamente — não o diff de pixels.

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

## O que ficou de fora destas fases

- pós-processamento (e portanto o DOF f/5.6 dos previews);
- integração com Framer;
- deploy;
- ajuste fino do estágio ~25% — o painel existe justamente para essa avaliação;
- acoplamento explícito ponteiro → amplitude do flow. A seção 10 da
  especificação dizia que a peça próxima ao cursor "**pode**" aumentar
  tilt/depth; hoje isso já acontece pela camada de ponteiro, que é aditiva sobre
  a onda. Um ganho local dedicado exigiria o flow conhecer o campo de influência,
  o que inverteria a ordem das camadas — ficou de fora por escolha.
