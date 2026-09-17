/**
 * J3F - CIRCULAR FLOW (Fase 2).
 *
 * O loop do simbolo NAO vem de pecas orbitando. Vem de uma ONDA DE ORIENTACAO
 * percorrendo as 14 laminas ao longo do anel fechado:
 *
 *   T1 → T2 → T3 → T4 → T5 → T6 → T7
 *                                   ↓
 *   B1 ← B2 ← B3 ← B4 ← B5 ← B6 ← B7
 *    ↓
 *   T1
 *
 * Os CENTROS ficam praticamente parados. O que viaja e tilt, pitch/yaw, uma
 * profundidade minima e - metade do efeito - a leitura de luz: quando a lamina
 * inclina ela sai do angulo de reflexao, escurece, quase some, e depois captura
 * de novo a strip. A geometria so precisa entregar o angulo; o material grafite
 * + bevel + environment fazem o resto.
 *
 * Lugar na cadeia (secao 9 da especificacao):
 *
 *   Organic base pose → CIRCULAR FLOW → Ambient Micro Float → Pointer → render
 *
 * Roda ANTES de `J3FInteraction.captureBase()`, entao a base que o idle e o
 * ponteiro enxergam ja e "Organic + Flow". E o que garante que o ponteiro
 * perturbe a onda sem nunca pausar nem resetar a fase: ele e aditivo sobre ela.
 *
 * Nao acumula nada. `J3FAnimation.apply()` reescreve o TRS inteiro a cada frame
 * antes desta camada, entao somar offsets in place e seguro - a mesma filosofia
 * que sustenta a ausencia de drift no idle.
 *
 * O modulo nao le `window`, `matchMedia`, eventos nem o relogio: quem injeta
 * tempo, progresso e capacidades e o main. E o que permite o ?selftest medir
 * periodicidade e amplitude de forma determinista.
 */

import { Euler, Quaternion, Vector3 } from 'three';

import { smootherstep } from './j3f-organic.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Ordem canonica do anel fechado. NAO e usada para calcular nada - o indice
 * sai da topologia (`half` + `column`) em `bind()`. Fica aqui como referencia
 * legivel e como oraculo do ?selftest, que confere as duas derivacoes.
 */
export const RING_ORDER = [
  'J3F_Bar_T1', 'J3F_Bar_T2', 'J3F_Bar_T3', 'J3F_Bar_T4',
  'J3F_Bar_T5', 'J3F_Bar_T6', 'J3F_Bar_T7',
  'J3F_Bar_B7', 'J3F_Bar_B6', 'J3F_Bar_B5', 'J3F_Bar_B4',
  'J3F_Bar_B3', 'J3F_Bar_B2', 'J3F_Bar_B1',
];

export const FLOW = {
  /**
   * Velocidade temporal do segundo harmonico, em fracao da fundamental, e com
   * sinal trocado (ele anda ao contrario). A especificacao sugeria 0.55; 1/2 e
   * deliberado: com 0.55 = 11/20 o campo so se repete depois de 20 voltas
   * (150 s no baseline), e a especificacao pede fase "perfeitamente periodica".
   * Com 1/2 o periodo exato e 2 voltas - 15 s - e o harmonico continua
   * cumprindo seu unico papel, que e quebrar a perfeicao mecanica.
   */
  HARMONIC_RATE: 0.5,

  /**
   * Defasagem por canal. Pitch e yaw a um quarto de ciclo um do outro fazem a
   * normal da lamina precessar num cone: e isso que le como TORCAO, e nao como
   * uma aba batendo num eixo so.
   */
  PH_PITCH: 0,
  PH_YAW: Math.PI / 2,
  PH_ROLL: Math.PI / 4,
  PH_DEPTH: 1.15,
  PH_RADIAL: 0.4,

  /**
   * Peso por canal sobre o slider de tilt (que vale o MAXIMO em graus).
   * O roll e pequeno de proposito: girar no plano da tela muda a silhueta da
   * marca, enquanto pitch/yaw so mudam o angulo de reflexao - que e o efeito
   * que se quer.
   */
  W_PITCH: 1.0,
  W_YAW: 0.85,
  W_ROLL: 0.22,

  /** peso do flow em t = 0 e mistura da rampa - ver `flowAssemblyWeight` */
  ASSEMBLY_FLOOR: 0.2,
  ASSEMBLY_MIX: 0.4,

  /** janela do contraste dramatico no fim da montagem (secao 5) */
  CONTRAST_START: 0.6,
  CONTRAST_FULL: 0.95,
  /** o boost mexe SO no grading: exposure desce, environment sobe */
  EXPOSURE_DROP: 0.1,
  ENV_GAIN: 0.25,

  /** em ponteiro grosso (mobile/touch) o flow continua, com amplitude menor */
  COARSE_SCALE: 0.6,
};

const _euler = new Euler(0, 0, 0, 'XYZ');
const _qOffset = new Quaternion();
const _world = new Vector3();

/** grading devolvido quando o flow esta desligado: identidade EXATA */
const GRADE_IDENTITY = Object.freeze({ exposure: 1, env: 1 });
/** objeto reutilizado - o grading e calculado por frame e nao pode alocar */
const _grade = { exposure: 1, env: 1 };

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Indice da peca no anel fechado, derivado so da topologia.
 *
 *   top:     coluna 1..7  →  0..6
 *   bottom:  coluna 7..1  →  7..13   (o anel desce por B7 e volta por B1)
 */
export function ringIndex(piece) {
  return piece.half === 'top' ? piece.column - 1 : 14 - piece.column;
}

/**
 * Onda viajante: fundamental + segundo harmonico contra-rotante.
 *
 *   wave = sin(theta − dir·w·t + phi) + h · sin(2·theta + dir·rate·w·t + phi)
 *
 * SOBRE O SINAL. A especificacao e ambigua consigo mesma: a secao 2 desenha a
 * ordem com setas (T1→…→T7→B7→…→B1→T1), mas a formula "conceitual" da secao 7
 * escreve `sin(theta + t)`, cuja crista fica em theta = pi/2 − w·t, ou seja,
 * anda no sentido CONTRARIO ao das setas. Aqui vale o diagrama, que e a parte
 * explicita: com `dir = +1` a crista percorre theta CRESCENTE, que e a ordem
 * desenhada. `flowReverse` no painel inverte, para a decisao ser visual.
 * O harmonico acompanha a inversao para continuar contra-rotante.
 *
 * Dividida por (1 + h) para que |wave| <= 1 sempre. E o que faz o slider do
 * painel valer exatamente a amplitude MAXIMA, e nao um numero aproximado que
 * cresce junto com o harmonico.
 *
 * @param {number} theta fase estavel da peca no anel (rad)
 * @param {number} time  tempo acumulado (s)
 * @param {number} omega velocidade angular do loop (rad/s)
 * @param {number} harmonic peso do segundo harmonico (0..~0.3)
 * @param {number} phi defasagem do canal (rad)
 * @param {number} dir +1 = sentido do diagrama, -1 = invertido
 */
export function flowWave(theta, time, omega, harmonic, phi = 0, dir = 1) {
  const fundamental = Math.sin(theta - dir * omega * time + phi);
  const second = Math.sin(2 * theta + dir * FLOW.HARMONIC_RATE * omega * time + phi);
  return (fundamental + harmonic * second) / (1 + harmonic);
}

/**
 * Peso do flow ao longo da montagem (secao 8 da especificacao).
 *
 * A Organic domina a viagem; o Circular Flow domina a sensacao de vida no
 * estado final. Os quatro pontos pedidos eram 20% / 50-60% / 85-90% / 100%.
 * `smootherstep` puro passa de 95% em t = 0.8 - fora da faixa. A mistura com
 * o termo linear e o que faz a curva encostar nos quatro alvos, continuando
 * polinomial (sem vinco) em todo o intervalo:
 *
 *   t=0 → 0.200   t=0.5 → 0.600   t=0.8 → 0.885   t=1 → 1.000
 */
export function flowAssemblyWeight(t, floor = FLOW.ASSEMBLY_FLOOR) {
  const tc = clamp01(t);
  const s = FLOW.ASSEMBLY_MIX * smootherstep(tc) + (1 - FLOW.ASSEMBLY_MIX) * tc;
  return floor + (1 - floor) * s;
}

/** Rampa do contraste: 0 ate t=0.6, cheia em t=0.95. C² nas duas pontas. */
export function flowContrastWeight(t) {
  return smootherstep(
    (clamp01(t) - FLOW.CONTRAST_START) / (FLOW.CONTRAST_FULL - FLOW.CONTRAST_START),
  );
}

/**
 * Grading do fim da montagem: darks mais profundos, highlights mais dramaticos.
 *
 * NAO toca o material - a especificacao proibe. Mexe so em exposure (desce, o
 * que afunda os darks) e em environmentIntensity (sobe, o que empurra as
 * fontes especulares). Sao multiplicadores sobre os valores do painel, nunca
 * escritos de volta neles.
 *
 * @returns {{exposure:number, env:number}} objeto reutilizado
 */
export function flowGrade(t, weights) {
  if (!weights?.on || !(weights.contrast > 0)) return GRADE_IDENTITY;
  const k = flowContrastWeight(t) * weights.contrast;
  if (k <= 0) return GRADE_IDENTITY;
  _grade.exposure = 1 - FLOW.EXPOSURE_DROP * k;
  _grade.env = 1 + FLOW.ENV_GAIN * k;
  return _grade;
}

/**
 * Traduz os controles do painel + as capacidades do dispositivo nos pesos que
 * a camada consome. Vive aqui, e nao no main, para o ?selftest poder simular
 * `prefers-reduced-motion` ou um dispositivo touch sem mexer no navegador.
 *
 *  - prefers-reduced-motion desliga o Circular Flow por inteiro;
 *  - ponteiro grosso (touch/mobile) mantem o flow, com amplitude reduzida.
 *
 * @param {object} out objeto reutilizado - resolver nao pode alocar por frame
 */
export function resolveFlow(params, caps, out = {}) {
  const reduced = Boolean(caps?.prefersReduced);
  const coarse = !caps?.canHover;
  const amount = params.flowAmount ?? 1;

  out.on = Boolean(params.flowEnabled) && !reduced && amount > 0;
  out.amount = amount * (coarse ? FLOW.COARSE_SCALE : 1);
  out.loopDuration = Math.max(params.flowLoopDuration ?? 7.5, 0.5);
  out.tilt = params.flowTilt ?? 2.0;
  out.depth = params.flowDepth ?? 0.012;
  out.radial = params.flowRadial ?? 0;
  out.harmonic = Math.max(params.flowHarmonic ?? 0.15, 0);
  out.contrast = params.flowContrast ?? 1;
  out.assemblyFloor = params.flowAssemblyFloor ?? FLOW.ASSEMBLY_FLOOR;
  /** +1 = sentido do diagrama (T1→T7→B7→B1); -1 = invertido */
  out.dir = params.flowReverse ? -1 : 1;
  out.reduced = reduced;
  out.coarse = coarse;
  return out;
}

export class J3FCircularFlow {
  constructor() {
    /** estado por peca, realocado uma unica vez */
    this.pieces = [];
    this.bound = false;
    /** leitura para o overlay "show flow phase" */
    this.readout = [];
    /** peso efetivo do ultimo frame, so para o painel */
    this.lastWeight = 0;
    this.lastOmegaTime = 0;
  }

  /**
   * Aloca o estado e congela a fase de cada peca no anel. Uma vez, nunca por
   * frame. A fase e ESTAVEL: so depende da topologia, nunca do tempo.
   */
  bind(animation) {
    const n = animation.pieces.length;
    this.pieces = animation.pieces.map((piece) => {
      const ring = ringIndex(piece);
      // direcao radial no plano da tela, a partir do centro do simbolo. So e
      // usada quando `flowRadial > 0`; o baseline aprovado e 0.
      const rx = piece.endPos.x;
      const ry = piece.endPos.y;
      const len = Math.hypot(rx, ry);
      return {
        name: piece.name,
        ring,
        theta: (TAU * ring) / n,
        dirX: len > 1e-6 ? rx / len : 0,
        dirY: len > 1e-6 ? ry / len : 0,
        /** valor da onda no ultimo frame (-1..1), para o overlay de fase */
        wave: 0,
        ndcX: 0,
        ndcY: 0,
      };
    });
    this.readout = this.pieces;
    this.bound = true;
    return this.pieces.length;
  }

  /** Zera a leitura. Nao existe estado temporal a resetar: a onda e funcao pura do tempo. */
  reset() {
    for (const p of this.pieces) p.wave = 0;
    this.lastWeight = 0;
  }

  /**
   * Soma a onda sobre a pose que a coreografia acabou de escrever.
   *
   * @param {object} animation coreografia ativa (baseline ou organic)
   * @param {number} time tempo acumulado, em segundos
   * @param {number} t progresso de montagem (0..1), para o peso do flow
   * @param {object} w pesos vindos de `resolveFlow`
   */
  apply(animation, time, t, w = {}) {
    if (!this.bound || w.on === false) return 0;

    const pieces = animation.pieces;
    if (pieces.length !== this.pieces.length) return 0;

    const weight = (w.amount ?? 1) * flowAssemblyWeight(t, w.assemblyFloor);
    this.lastWeight = weight;
    if (weight <= 0) return 0;

    const omega = TAU / Math.max(w.loopDuration ?? 7.5, 0.5);
    const harmonic = w.harmonic ?? 0.15;
    const dir = w.dir ?? 1;
    const tilt = (w.tilt ?? 2.0) * DEG * weight;
    const depth = (w.depth ?? 0.012) * weight;
    const radial = (w.radial ?? 0) * weight;
    this.lastOmegaTime = (omega * time) % TAU;

    for (let i = 0; i < pieces.length; i++) {
      const node = pieces[i].node;
      if (!node) continue;
      const f = this.pieces[i];
      const theta = f.theta;

      // canal de leitura: a fundamental sem defasagem, para o overlay mostrar
      // a onda "pura" percorrendo o anel
      f.wave = flowWave(theta, time, omega, harmonic, 0, dir);

      // --- rotacao: o efeito principal ------------------------------------
      const rx = flowWave(theta, time, omega, harmonic, FLOW.PH_PITCH, dir) * tilt * FLOW.W_PITCH;
      const ry = flowWave(theta, time, omega, harmonic, FLOW.PH_YAW, dir) * tilt * FLOW.W_YAW;
      const rz = flowWave(theta, time, omega, harmonic, FLOW.PH_ROLL, dir) * tilt * FLOW.W_ROLL;

      // pos-multiplicacao = eixos LOCAIS da lamina. E o que faz a peca torcer
      // em torno da propria face, e nao em torno de um eixo global do simbolo.
      _euler.set(rx, ry, rz, 'XYZ');
      _qOffset.setFromEuler(_euler);
      node.quaternion.multiply(_qOffset);

      // --- profundidade: muito sutil ---------------------------------------
      if (depth !== 0) {
        node.position.z += flowWave(theta, time, omega, harmonic, FLOW.PH_DEPTH, dir) * depth;
      }

      // --- radial: 0 no baseline aprovado ----------------------------------
      if (radial !== 0) {
        const r = flowWave(theta, time, omega, harmonic, FLOW.PH_RADIAL, dir) * radial;
        node.position.x += f.dirX * r;
        node.position.y += f.dirY * r;
      }
    }

    return weight;
  }

  /** Projeta os centros em NDC. So o overlay "show flow phase" usa. */
  project(animation, camera) {
    const pieces = animation.pieces;
    for (let i = 0; i < pieces.length; i++) {
      const node = pieces[i].node;
      if (!node) continue;
      _world.setFromMatrixPosition(node.matrixWorld).project(camera);
      this.pieces[i].ndcX = _world.x;
      this.pieces[i].ndcY = _world.y;
    }
  }
}
