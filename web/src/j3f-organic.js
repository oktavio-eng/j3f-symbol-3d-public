/**
 * J3F - coreografia ORGANIC (variante experimental).
 *
 * O baseline (j3f-animation.js) continua intacto e selecionavel: esta classe
 * herda dele e substitui apenas `apply()`. START e END continuam vindo
 * literalmente do JSON; FLOW e PRE-ASSEMBLY sao derivados proceduralmente aqui
 * e NUNCA sao gravados em lugar nenhum.
 *
 *   START  ──►  FLOW  ──►  PRE-ASSEMBLY  ──►  END
 *     p=0       p≈0.38        p≈0.80         p=1
 *
 * Os "estados" nao sao segmentos concatenados - isso produziria emendas. Eles
 * sao ENVELOPES continuos (smootherstep, C²) sobre um unico caminho parametrico.
 * Continuidade e propriedade de construcao, nao de conserto; o ?selftest mede a
 * segunda diferenca ao longo do sweep para provar que nao ha vinco.
 *
 * Invariantes preservados do baseline:
 *  - so o bloco `gltf_y_up` do JSON;
 *  - rotacao por quaternion + slerp;
 *  - em t = 1: TRS = END literal, root = identidade, dolly = 1.0;
 *  - funcao pura de t -> reversibilidade exata no scroll.
 */

import { Quaternion, Vector3 } from 'three';

import { J3FAnimation } from './j3f-animation.js';

/** Constantes da coreografia. O que e ajustavel em runtime mora em BASELINE. */
export const ORGANIC = {
  /** pico do envelope FLOW */
  FLOW_PEAK: 0.38,
  /** inicio do SETTLE (fim do PRE-ASSEMBLY) */
  PRE_ASSEMBLY: 0.8,
  /** defasagem da metade inferior, em fracao do stagger */
  HALF_PHASE: 0.15,
  /** respiracao vertical: top sobe, bottom desce no meio do voo (BU) */
  VERT_SWING: 0.1,
  /** saturacao suave do alinhamento ao fluxo (rad) */
  FLOW_MAX_ANGLE: 0.9,
  /** inclinacao maxima vinda da componente de profundidade da tangente (rad) */
  FLOW_PITCH: 0.21,
  /** peso do segundo ponto de controle do Bezier */
  P2_WEIGHT: 0.55,
  /** passo da diferenca central usada para a tangente */
  TANGENT_H: 2e-3,
  /** respiracao do sistema inteiro */
  ROOT_SCALE_START: 1.04,
  ROOT_OFFSET_Y: -0.06,
  ROOT_OFFSET_Z: 0.1,
};

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);

const _p1 = new Vector3();
const _p2 = new Vector3();
const _bez = new Vector3();
const _lin = new Vector3();
const _posA = new Vector3();
const _posB = new Vector3();
const _tangent = new Vector3();
const _qFlow = new Quaternion();
const _qPitch = new Quaternion();
const _qStart = new Quaternion();
const _qA = new Quaternion();
const _sStart = new Vector3();

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** C²: derivadas primeira e segunda nulas em 0 e em 1. */
export function smootherstep(x) {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Bump C² com pico em `peak`. As duas metades sao smootherstep, que chega ao
 * topo com derivada 1ª e 2ª nulas - por isso a juncao no pico nao tem vinco.
 */
export function bump(p, peak) {
  return p < peak ? smootherstep(p / peak) : smootherstep((1 - p) / (1 - peak));
}

/**
 * Easing do modo organic.
 *
 * NAO e o easeOutCubic do baseline, e a diferenca e proposital: easeOutCubic
 * tem derivada 3 na origem, entao cada peca ENTRA em movimento com velocidade
 * nao nula no instante em que seu delay vence. Com stagger visivel isso passa
 * despercebido; com stagger bem sobreposto vira um "pipoco" de 14 largadas e
 * quebra justamente a leitura de sistema unico que se quer aqui. Alem disso e
 * uma descontinuidade de C¹, que o criterio de continuidade nao aceita.
 *
 *   organicEase(x) = 1 − (1 − smootherstep(x))²
 *
 * Monotonica, sem overshoot, primeira e segunda derivadas nulas em 0 e em 1, e
 * com o peso deslocado para o inicio (sai cedo e assenta longo).
 */
export function organicEase(x) {
  const q = smootherstep(x);
  const u = 1 - q;
  return 1 - u * u;
}

/** 1 até PRE_ASSEMBLY, depois desce suavemente até 0 em p = 1. */
export function settleEnvelope(p) {
  const s = (p - ORGANIC.PRE_ASSEMBLY) / (1 - ORGANIC.PRE_ASSEMBLY);
  return 1 - smootherstep(s);
}

/** Fator de dolly da camera. Vale exatamente 1.0 em t = 1. */
export function organicCameraFactor(t, params = {}) {
  return 1 + (params.cameraDolly ?? 0) * (1 - smootherstep(clamp01(t)));
}

/** Nome do estagio, so para leitura no painel. */
export function organicPhase(p) {
  if (p <= 0) return 'START';
  if (p >= 1) return 'END';
  if (p < ORGANIC.FLOW_PEAK) return 'START→FLOW';
  if (p < ORGANIC.PRE_ASSEMBLY) return 'FLOW→PRE-ASSEMBLY';
  return 'SETTLE→END';
}

function cubicBezier(p0, c1, c2, p3, t, out) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return out.set(
    a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    a * p0.y + b * c1.y + c * c2.y + d * p3.y,
    a * p0.z + b * c1.z + c * c2.z + d * p3.z,
  );
}

export class J3FOrganicAnimation extends J3FAnimation {
  constructor(states) {
    super(states);
    this.root = null;

    for (const piece of this.pieces) {
      // coordenada topologica da coluna: -1 (esquerda) .. 0 (centro) .. +1
      const u = (piece.column - 4) / 3;
      const r = Math.abs(u);
      piece.u = u;
      piece.r = r;
      piece.halfSign = piece.half === 'top' ? 1 : -1;

      piece.chord = new Vector3().subVectors(piece.endPos, piece.startPos);
      piece.chordLen = piece.chord.length();

      // perpendicular à corda, no plano da tela: define o lado do arco.
      // Como sai da própria corda, colunas vizinhas recebem perpendiculares
      // quase iguais - o campo é suave, não é random por peça.
      const lxy = Math.hypot(piece.chord.x, piece.chord.y);
      piece.perp =
        lxy > 1e-6
          ? new Vector3(-piece.chord.y / lxy, piece.chord.x / lxy, 0)
          : new Vector3(0, 1, 0);

      // campo de profundidade por coluna: máximo no centro, zero nas pontas
      piece.depthField = Math.cos((Math.PI * u) / 2);
      // a peça que vem de trás continua atrás no meio do voo, e vice-versa:
      // preserva a leitura de camadas e evita cruzamentos
      const z0 = piece.startPos.z;
      piece.depthSign = Math.sign(z0) * Math.min(Math.abs(z0), 1);

      // onda contínua por coluna: 0 no centro, 1 nas extremas
      piece.delayNorm = (1 - Math.cos(Math.PI * r)) / 2;

      piece.offset = new Vector3();
      piece.phaseProgress = 0;
    }
  }

  bind(root) {
    this.root = root;
    return super.bind(root);
  }

  /** Delay contínuo do modo organic (não usa o `delay` discreto do JSON). */
  organicDelay(piece, stagger) {
    const phase = piece.delayNorm + (piece.halfSign < 0 ? ORGANIC.HALF_PHASE : 0);
    return (phase / (1 + ORGANIC.HALF_PHASE)) * stagger;
  }

  /** Offsets do campo de movimento. Dependem só da topologia, não de `p`. */
  _updateOffset(piece, params) {
    const arcLateral = params.arcLateral ?? 0.22;
    const depthShell = params.depthShell ?? 0.28;

    piece.offset.set(0, 0, 0);
    // 1) arco lateral, proporcional à distância ao centro
    piece.offset.addScaledVector(piece.perp, arcLateral * piece.r * piece.chordLen);
    // 2) casca de profundidade compartilhada
    piece.offset.z += depthShell * piece.depthField * piece.depthSign;
    // 3) respiração vertical, com sinal pela metade
    piece.offset.y += ORGANIC.VERT_SWING * piece.halfSign * (0.4 + 0.6 * piece.r);
  }

  /**
   * Posição no caminho: Bezier cúbica com pontos de controle deterministas,
   * misturada de volta para a corda reta durante o SETTLE.
   */
  _positionAt(piece, p, curvature, out) {
    _p1.copy(piece.startPos).addScaledVector(piece.chord, 1 / 3).add(piece.offset);
    _p2
      .copy(piece.startPos)
      .addScaledVector(piece.chord, 2 / 3)
      .addScaledVector(piece.offset, ORGANIC.P2_WEIGHT);

    cubicBezier(piece.startPos, _p1, _p2, piece.endPos, p, _bez);
    _lin.copy(piece.startPos).addScaledVector(piece.chord, p);

    const blend = curvature * settleEnvelope(p);
    return out.copy(_lin).lerp(_bez, blend);
  }

  /**
   * Orientação FLOW: a lâmina alinha o eixo longo com a tangente do caminho.
   *
   * A rotação principal é em torno do eixo de visada (Z), que é justamente o
   * eixo que NÃO leva a peça a ficar de perfil - é o que elimina os flashes
   * preto/branco. A profundidade da tangente entra só como uma inclinação
   * pequena.
   */
  _flowQuaternion(tangent, out) {
    // O ângulo NÃO sai de atan2(tangent.x, tangent.y). atan2 tem corte de ramo
    // em ±pi: qualquer peça cuja tangente aponte para baixo e cruze a vertical
    // faria o ângulo saltar 2pi, o que aparece como um pulo no meio do voo
    // (medido: salto de 4.4e-1 em t≈0.37 antes desta correção).
    //
    // Em vez disso, a inclinação é proporcional às COMPONENTES da tangente
    // unitária, que são suaves em todo lugar. Lê-se como banking: quanto mais
    // horizontal a viagem, mais a lâmina se inclina para dentro do movimento;
    // viajando na vertical, ela fica de pé.
    const bank = -ORGANIC.FLOW_MAX_ANGLE * tangent.x;
    const pitch = ORGANIC.FLOW_PITCH * tangent.z;

    out.setFromAxisAngle(AXIS_Z, bank);
    _qPitch.setFromAxisAngle(AXIS_X, pitch);
    return out.multiply(_qPitch);
  }

  apply(t, params = {}) {
    const stagger = Math.min(Math.max(params.organicStagger ?? 0.165, 0), 0.9);
    const rotationMultiplier = params.rotationMultiplier ?? 0.7;
    const scaleVariationMultiplier = params.scaleVariationMultiplier ?? 0.25;
    const curvature = params.curvature ?? 1;
    const flowStrength = params.flowStrength ?? 0.75;
    const h = ORGANIC.TANGENT_H;

    const tc = clamp01(t);
    let pMin = 1;
    let pMax = 0;
    let pSum = 0;

    for (const piece of this.pieces) {
      const d = this.organicDelay(piece, stagger);
      const denom = 1 - d;
      const tLocal = denom > 1e-9 ? clamp01((tc - d) / denom) : tc >= 1 ? 1 : 0;
      const p = organicEase(tLocal);

      piece.progress = p;
      if (p < pMin) pMin = p;
      if (p > pMax) pMax = p;
      pSum += p;

      if (!piece.node) continue;

      this._updateOffset(piece, params);

      // --- posição ---
      this._positionAt(piece, p, curvature, piece.node.position);

      // --- tangente do caminho real (diferença central, com as pontas presas
      //     dentro de [0, 1] para não extrapolar) ---
      const pa = Math.max(0, p - h);
      const pb = Math.min(1, p + h);
      this._positionAt(piece, pa, curvature, _posA);
      this._positionAt(piece, pb, curvature, _posB);
      _tangent.subVectors(_posB, _posA);
      if (_tangent.lengthSq() > 1e-18) _tangent.normalize();
      else _tangent.copy(piece.chord).normalize();

      // --- rotação: START reduzido -> FLOW -> END ---
      _qStart.copy(piece.endQuat).slerp(piece.startQuat, rotationMultiplier);
      this._flowQuaternion(_tangent, _qFlow);

      const flowWeight = flowStrength * bump(p, ORGANIC.FLOW_PEAK) * settleEnvelope(p);
      _qA.copy(_qStart).slerp(_qFlow, flowWeight);
      piece.node.quaternion.copy(_qA).slerp(piece.endQuat, p);

      // --- escala ---
      _sStart.copy(piece.endScale).lerp(piece.startScale, scaleVariationMultiplier);
      piece.node.scale.copy(_sStart).lerp(piece.endScale, p);
    }

    this.applyRoot(tc, params);

    return {
      t: tc,
      pMin,
      pMax,
      pMean: pSum / this.pieces.length,
      pLead: this.pieces.reduce((a, b) => (b.delayNorm < a.delayNorm ? b : a), this.pieces[0])
        .progress,
      pTail: this.pieces.reduce((a, b) => (b.delayNorm > a.delayNorm ? b : a), this.pieces[0])
        .progress,
      phase: organicPhase(pSum / this.pieces.length),
    };
  }

  /**
   * Respiração do sistema inteiro. Usa `1 - smootherstep(t)`, que chega a zero
   * com derivada nula: em t = 1 o root é exatamente identidade, e o movimento
   * não tem partida nem chegada bruscas.
   */
  applyRoot(t, params = {}) {
    if (!this.root) return;
    const e = (1 - smootherstep(clamp01(t))) * (params.rootMotion ?? 1);
    const s = 1 + (ORGANIC.ROOT_SCALE_START - 1) * e;
    this.root.scale.set(s, s, s);
    this.root.position.set(0, ORGANIC.ROOT_OFFSET_Y * e, ORGANIC.ROOT_OFFSET_Z * e);
    this.root.quaternion.set(0, 0, 0, 1);
  }

  /** Devolve o root à identidade (usado ao voltar para o modo baseline). */
  resetRoot() {
    if (!this.root) return;
    this.root.scale.set(1, 1, 1);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.set(0, 0, 0, 1);
  }

  /** Escala efetiva de START depois do multiplicador, para leitura no debug. */
  effectiveScaleRange(scaleVariationMultiplier) {
    let min = Infinity;
    let max = -Infinity;
    for (const piece of this.pieces) {
      const s = 1 + (piece.startScale.x - 1) * scaleVariationMultiplier;
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    return { min, max };
  }
}
