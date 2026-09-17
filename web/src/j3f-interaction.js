/**
 * J3F - camada de microinteracao (idle + pointer).
 *
 * Roda DEPOIS da coreografia, sobre a pose que ela produziu:
 *
 *   scroll → Organic → BASE POSE → idle → pointer → render
 *
 * A regra que sustenta tudo: a cada frame a base pose e RECAPTURADA dos nos e
 * os offsets sao derivados de novo a partir dela. Nada e acumulado frame a
 * frame, entao nao existe drift numerico - nem depois de horas. Com
 * idle = 0 e pointer = 0 o resultado e bit a bit a pose da Organic.
 *
 *   position   = base.position + offset
 *   quaternion = base.quaternion * offsetQuaternion
 *
 * O modulo nao le `window`, `matchMedia` nem eventos: quem faz isso e o main,
 * que injeta dt, tempo e posicao do ponteiro. E o que permite testar a camada
 * inteira de forma determinista.
 */

import { Euler, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;

export const IDLE = {
  /** duas frequencias lentas e de razao irracional: evita pendulo obvio */
  W1: (2 * Math.PI) / 17.0, // periodo 17 s
  W2: (2 * Math.PI) / 26.5, // periodo 26,5 s
  MIX1: 0.62,
  MIX2: 0.38,

  /** amplitudes de referencia (multiplicadas pelos controles do painel) */
  PIECE_Y: 0.006, // BU
  PIECE_Z: 0.01, // BU
  PIECE_ROT: 0.45 * DEG, // rad
  ROOT_Y: 0.008, // BU
  ROOT_Z: 0.006, // BU
  ROOT_YAW: 0.15 * DEG, // rad

  /** defasagens por canal, para os eixos nao andarem juntos */
  PH_Y: 0.0,
  PH_Z: 1.7,
  PH_RX: 3.1,
  PH_RY: 4.6,

  /** idle reduzido em ponteiro grosso (touch) */
  COARSE_SCALE: 0.45,
};

export const POINTER = {
  /**
   * O campo magnetico e `delta * falloff(delta)`, que vale zero embaixo do
   * cursor (a peca ja esta la) e zero longe. Seu maximo e 0.2731; dividir por
   * ele faz o slider do painel valer exatamente o deslocamento MAXIMO em BU.
   */
  FIELD_NORM: 1 / 0.2731,
  /** limites acordados; o selftest verifica */
  MAX_POSITION_BU: 0.025,
  MAX_ROTATION_DEG: 1.5,
};

const _euler = new Euler(0, 0, 0, 'XYZ');
const _qOffset = new Quaternion();
const _qRoot = new Quaternion();
const _world = new Vector3();

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smootherstep(x) {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Peso do idle ao longo da montagem. Disperso o objeto ja tem movimento de
 * sobra; montado e onde ele precisaria parecer morto. Por isso o idle cresce.
 *
 *   t=0 -> floor   t=0.4 -> ~0.56   t=0.7 -> ~0.89   t=1 -> 1.0
 */
export function assemblyWeight(t, floor = 0.35) {
  return floor + (1 - floor) * smootherstep(t);
}

/** Soma de duas senoides lentas, sempre dentro de [-1, 1]. */
export function idleWave(time, phase, speed) {
  return (
    IDLE.MIX1 * Math.sin(IDLE.W1 * speed * time + phase) +
    IDLE.MIX2 * Math.sin(IDLE.W2 * speed * time + phase * 1.37 + 1.9)
  );
}

/** Queda radial C² usada pelo campo de influencia do ponteiro. */
export function falloff(x) {
  return 1 - smootherstep(x);
}

/**
 * Traduz os controles do painel + as capacidades do dispositivo nos pesos que a
 * camada consome. Vive aqui, e nao no main, para que o selftest possa simular
 * um dispositivo sem hover ou `prefers-reduced-motion` sem mexer no navegador.
 *
 *  - prefers-reduced-motion desliga idle E pointer;
 *  - pointer so existe em (hover: hover) and (pointer: fine);
 *  - em ponteiro grosso (touch) o idle fica reduzido.
 *
 * @param {object} out objeto reutilizado - resolver nao pode alocar por frame
 */
export function resolveWeights(params, caps, out = {}) {
  const mode = params.interactionMode;
  const canHover = Boolean(caps?.canHover);
  const reduced = Boolean(caps?.prefersReduced);

  out.idleOn = mode !== 'off' && Boolean(params.idleEnabled) && !reduced;
  out.pointerOn =
    mode === 'idle+pointer' && Boolean(params.pointerEnabled) && canHover && !reduced;
  out.pointerActive = out.pointerOn;
  out.idleAmount = (params.idleAmount ?? 1) * (canHover ? 1 : IDLE.COARSE_SCALE);
  out.idleSpeed = params.idleSpeed ?? 1;
  out.pieceFloat = params.pieceFloat ?? 1;
  out.pieceRotation = params.pieceRotation ?? 1;
  out.rootFloat = params.rootFloat ?? 1;
  out.assemblyFloor = params.assemblyFloor ?? 0.35;
  out.influenceRadius = params.influenceRadius ?? 0.55;
  out.positionStrength = params.positionStrength ?? 0.018;
  out.depthStrength = params.depthStrength ?? 0.02;
  out.rotationStrength = params.rotationStrength ?? 1.1;
  out.rootTilt = params.rootTilt ?? 0.35;
  out.pointerDamping = params.pointerDamping ?? 6;
  return out;
}

export class J3FInteraction {
  constructor() {
    /** base pose, realocada uma unica vez */
    this.base = [];
    this.rootBase = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    };
    this.root = null;
    this.bound = false;

    /** alvo do ponteiro, em NDC; segue o mouse imediatamente */
    this.target = { x: 0, y: 0, inside: false };
    /** valor aplicado, com damping exponencial independente de FPS */
    this.damped = { x: 0, y: 0, activation: 0 };

    this.aspect = 1;
    /** leitura para o overlay de debug */
    this.readout = [];
  }

  /** Aloca os buffers da base pose. Uma vez, nunca por frame. */
  bind(animation, root) {
    this.root = root;
    this.base = animation.pieces.map((piece) => {
      // a coreografia baseline nao precomputa `u`/`halfSign`; derivar aqui
      // mantem a camada utilizavel nos dois modos
      const u = piece.u ?? (piece.column - 4) / 3;
      const halfSign = piece.halfSign ?? (piece.half === 'top' ? 1 : -1);
      return {
        name: piece.name,
        position: new Vector3(),
        quaternion: new Quaternion(),
        scale: new Vector3(),
        // fase derivada da topologia + posicao END: colunas vizinhas recebem
        // fases proximas, entao respiram de forma correlacionada
        phase: u * 2.1 + (halfSign < 0 ? 1.05 : 0) + piece.endPos.y * 0.6,
        influence: 0,
        ndcX: 0,
        ndcY: 0,
      };
    });
    this.readout = this.base;
    this.bound = true;
    return this.base.length;
  }

  /** Posicao do ponteiro em NDC (-1..1). `inside` = dentro da seção 3D. */
  setPointer(x, y, inside) {
    this.target.x = x;
    this.target.y = y;
    this.target.inside = inside;
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  /** Zera o estado do ponteiro. Usado pelos testes e ao trocar de modo. */
  reset() {
    this.target.x = 0;
    this.target.y = 0;
    this.target.inside = false;
    this.damped.x = 0;
    this.damped.y = 0;
    this.damped.activation = 0;
    for (const b of this.base) b.influence = 0;
  }

  /**
   * Avanca o damping do ponteiro.
   *
   * Mesma filosofia do scroll: alpha = 1 − exp(−lambda·dt). 30, 60 ou 120 Hz
   * percorrem a mesma curva no mesmo tempo de relogio. Quando o ponteiro sai,
   * o alvo vira 0 e as pecas voltam sozinhas - sem snap.
   */
  update(dt, params = {}) {
    const lambda = params.pointerDamping ?? 6;
    const alpha = 1 - Math.exp(-lambda * Math.max(dt, 0));
    const active = params.pointerActive && this.target.inside ? 1 : 0;

    this.damped.x += (this.target.x - this.damped.x) * alpha;
    this.damped.y += (this.target.y - this.damped.y) * alpha;
    this.damped.activation += (active - this.damped.activation) * alpha;

    // encosta no zero de verdade: e o que garante que "ponteiro fora" volta a
    // ser exatamente a pose da Organic, e nao um epsilon para sempre
    if (Math.abs(active - this.damped.activation) < 1e-5) {
      this.damped.activation = active;
    }
  }

  /** Copia o TRS que a coreografia acabou de escrever. Esta e a fonte da verdade. */
  captureBase(animation) {
    const pieces = animation.pieces;
    for (let i = 0; i < pieces.length; i++) {
      const node = pieces[i].node;
      if (!node) continue;
      const b = this.base[i];
      b.position.copy(node.position);
      b.quaternion.copy(node.quaternion);
      b.scale.copy(node.scale);
    }
    if (this.root) {
      this.rootBase.position.copy(this.root.position);
      this.rootBase.quaternion.copy(this.root.quaternion);
      this.rootBase.scale.copy(this.root.scale);
    }
  }

  /** Reescreve a base pose nos nos, descartando qualquer interacao. */
  restoreBase(animation) {
    const pieces = animation.pieces;
    for (let i = 0; i < pieces.length; i++) {
      const node = pieces[i].node;
      if (!node) continue;
      const b = this.base[i];
      node.position.copy(b.position);
      node.quaternion.copy(b.quaternion);
      node.scale.copy(b.scale);
      b.influence = 0;
    }
    if (this.root) {
      this.root.position.copy(this.rootBase.position);
      this.root.quaternion.copy(this.rootBase.quaternion);
      this.root.scale.copy(this.rootBase.scale);
    }
  }

  /**
   * Escreve base + idle + pointer nos nos.
   *
   * @param {object} animation
   * @param {import('three').Camera} camera usada so para projetar em NDC
   * @param {number} time tempo acumulado, em segundos
   * @param {number} t progresso de montagem (0..1), para o peso do idle
   * @param {object} params controles do painel
   */
  apply(animation, camera, time, t, params = {}) {
    const pieces = animation.pieces;

    // --- pesos -------------------------------------------------------------
    const idleOn = params.idleOn !== false;
    const idleAmount = idleOn ? (params.idleAmount ?? 1) * assemblyWeight(t, params.assemblyFloor ?? 0.35) : 0;
    const idleSpeed = params.idleSpeed ?? 1;
    const pieceFloat = params.pieceFloat ?? 1;
    const pieceRotation = params.pieceRotation ?? 1;
    const rootFloat = params.rootFloat ?? 1;

    // A ativação vem SEMPRE do valor amortecido, nunca de um booleano. Zerar
    // aqui quando `pointerOn` cai produziria exatamente o snap que não se quer:
    // desligar o ponteiro (ou trocar de modo) tem que devolver as peças
    // suavemente. Quem leva o alvo a zero é `update()`.
    const act = this.damped.activation;
    const radius = Math.max(params.influenceRadius ?? 0.55, 1e-3);
    const posStrength = params.positionStrength ?? 0.018;
    const depthStrength = params.depthStrength ?? 0.02;
    const rotStrength = (params.rotationStrength ?? 1.1) * DEG;
    const rootTilt = (params.rootTilt ?? 0.35) * DEG;

    const needPointer = act > 0 && (posStrength || depthStrength || rotStrength);

    // As posicoes projetadas saem da BASE pose, nao do resultado do frame
    // anterior. Por isso a matriz mundo e atualizada antes de qualquer escrita.
    if (needPointer && this.root && camera) {
      this.root.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
    }

    // --- pecas -------------------------------------------------------------
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const node = piece.node;
      if (!node) continue;
      const b = this.base[i];

      let dx = 0;
      let dy = 0;
      let dz = 0;
      let rx = 0;
      let ry = 0;

      if (idleAmount > 0) {
        const ph = b.phase;
        dy += idleWave(time, ph + IDLE.PH_Y, idleSpeed) * IDLE.PIECE_Y * pieceFloat * idleAmount;
        dz += idleWave(time, ph + IDLE.PH_Z, idleSpeed) * IDLE.PIECE_Z * pieceFloat * idleAmount;
        rx += idleWave(time, ph + IDLE.PH_RX, idleSpeed) * IDLE.PIECE_ROT * pieceRotation * idleAmount;
        ry += idleWave(time, ph + IDLE.PH_RY, idleSpeed) * IDLE.PIECE_ROT * pieceRotation * idleAmount;
      }

      if (needPointer) {
        _world.setFromMatrixPosition(node.matrixWorld).project(camera);
        b.ndcX = _world.x;
        b.ndcY = _world.y;

        // distancia em unidades de altura de tela: o X entra corrigido pelo
        // aspect para o campo ser circular em pixels, nao elipse
        const sx = (this.damped.x - _world.x) * this.aspect;
        const sy = this.damped.y - _world.y;
        const dist = Math.hypot(sx, sy);
        const norm = dist / radius;
        const w = norm >= 1 ? 0 : falloff(norm);
        b.influence = w * act;

        if (w > 0) {
          // campo magnetico: puxa na direcao do cursor, zero embaixo dele e
          // zero longe. Nao e normalizado - normalizar estouraria no centro.
          const gx = (sx / radius) * w * POINTER.FIELD_NORM * act;
          const gy = (sy / radius) * w * POINTER.FIELD_NORM * act;

          dx += gx * posStrength;
          dy += gy * posStrength;
          dz += w * act * depthStrength;
          rx += -gy * rotStrength;
          ry += gx * rotStrength;
        }
      } else {
        b.influence = 0;
      }

      node.position.set(b.position.x + dx, b.position.y + dy, b.position.z + dz);
      node.scale.copy(b.scale);

      if (rx !== 0 || ry !== 0) {
        _euler.set(rx, ry, 0, 'XYZ');
        _qOffset.setFromEuler(_euler);
        node.quaternion.copy(b.quaternion).multiply(_qOffset);
      } else {
        node.quaternion.copy(b.quaternion);
      }
    }

    // --- root --------------------------------------------------------------
    if (this.root) {
      let ry = 0;
      let rz = 0;
      let yaw = 0;
      let tiltX = 0;
      let tiltY = 0;

      if (idleAmount > 0) {
        ry = idleWave(time, 0.4, idleSpeed) * IDLE.ROOT_Y * rootFloat * idleAmount;
        rz = idleWave(time, 2.6, idleSpeed) * IDLE.ROOT_Z * rootFloat * idleAmount;
        yaw = idleWave(time, 5.0, idleSpeed) * IDLE.ROOT_YAW * rootFloat * idleAmount;
      }
      if (act > 0 && rootTilt > 0) {
        tiltX = -this.damped.y * rootTilt * act;
        tiltY = this.damped.x * rootTilt * act;
      }

      this.root.position.set(
        this.rootBase.position.x,
        this.rootBase.position.y + ry,
        this.rootBase.position.z + rz,
      );
      this.root.scale.copy(this.rootBase.scale);

      if (yaw !== 0 || tiltX !== 0 || tiltY !== 0) {
        _euler.set(tiltX, tiltY + yaw, 0, 'XYZ');
        _qRoot.setFromEuler(_euler);
        this.root.quaternion.copy(this.rootBase.quaternion).multiply(_qRoot);
      } else {
        this.root.quaternion.copy(this.rootBase.quaternion);
      }
    }
  }
}
