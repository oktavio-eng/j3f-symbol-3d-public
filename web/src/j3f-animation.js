/**
 * J3F - modelo de animacao START -> END.
 *
 * Implementa exatamente o que esta em export/j3f-symbol-states.json:
 *
 *   tLocal = clamp((t - delay * maxDelay) / (1 - delay * maxDelay), 0, 1)
 *   p      = easeOutCubic(tLocal) = 1 - (1 - tLocal)^3
 *   position   = lerp(start, end, p)
 *   quaternion = slerp(start, end, p)
 *   scale      = lerp(start, end, p)
 *
 * Regras que este modulo garante por construcao:
 *  - usa SOMENTE o bloco `gltf_y_up` (euler_xyz_debug e blender_z_up ignorados);
 *  - rotacao por quaternion [x, y, z, w] + slerp, nunca por euler;
 *  - em t = 1 todo tLocal e 1 e todo p e 1, entao o TRS resultante e o END
 *    literal do JSON - qualquer multiplicador do painel de debug atua apenas
 *    sobre o estado START, jamais sobre o END.
 *
 * Deliberadamente sem dependencia de DOM/renderer: da para importar em Node
 * para validar a matematica.
 */

import { Quaternion, Vector3 } from 'three';

export function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Distancia entre dois quaternions como maior diferenca de componente,
 * tolerando a dupla cobertura (q e -q representam a mesma rotacao).
 *
 * Deliberadamente NAO usa 2*acos(dot): perto da identidade o acos amplifica o
 * erro de ponto flutuante em ~3 ordens de grandeza e faz uma igualdade exata
 * parecer erro de 1e-3.
 */
export function quatDistance(a, b) {
  const same = Math.max(
    Math.abs(a.x - b.x), Math.abs(a.y - b.y),
    Math.abs(a.z - b.z), Math.abs(a.w - b.w),
  );
  const flipped = Math.max(
    Math.abs(a.x + b.x), Math.abs(a.y + b.y),
    Math.abs(a.z + b.z), Math.abs(a.w + b.w),
  );
  return Math.min(same, flipped);
}

const _effStartPos = new Vector3();
const _effStartQuat = new Quaternion();
const _effStartScale = new Vector3();

export class J3FAnimation {
  /**
   * @param {object} states conteudo de j3f-symbol-states.json
   */
  constructor(states) {
    const space = states?.conventions?.glb_node_space;
    if (space !== 'gltf_y_up') {
      throw new Error(
        `J3F: conventions.glb_node_space esperado 'gltf_y_up', recebido '${space}'`,
      );
    }
    this.space = space;
    this.jsonMaxDelay = states.animation?.stagger?.max_delay_fraction ?? 0.3;
    this.rootName = states.symbol?.root ?? 'J3F_Symbol_Root';

    this.pieces = states.pieces.map((piece) => {
      const end = piece.end[space];
      const start = piece.start[space];
      return {
        name: piece.name,
        index: piece.index,
        half: piece.half,
        column: piece.column,
        delay: piece.delay,
        endPos: new Vector3().fromArray(end.position),
        endQuat: new Quaternion().fromArray(end.quaternion),
        endScale: new Vector3().fromArray(end.scale),
        startPos: new Vector3().fromArray(start.position),
        startQuat: new Quaternion().fromArray(start.quaternion),
        startScale: new Vector3().fromArray(start.scale),
        node: null,
        /** TRS lido do GLB no momento do bind, antes de qualquer escrita */
        glbPos: null,
        glbQuat: null,
        glbScale: null,
        progress: 0,
      };
    });
  }

  /**
   * Associa cada peca ao no correspondente do GLB e guarda o TRS original.
   * @param {import('three').Object3D} root
   */
  bind(root) {
    const bound = [];
    const missing = [];
    for (const piece of this.pieces) {
      const node = root.getObjectByName(piece.name);
      if (!node) {
        missing.push(piece.name);
        continue;
      }
      piece.node = node;
      piece.glbPos = node.position.clone();
      piece.glbQuat = node.quaternion.clone();
      piece.glbScale = node.scale.clone();
      bound.push(piece.name);
    }
    return { bound, missing, count: bound.length, total: this.pieces.length };
  }

  /**
   * Escreve o TRS de cada peca para o progresso `t`.
   *
   * @param {number} t progresso de scroll ja amortecido, 0..1
   * @param {object} params multiplicadores do painel de debug
   * @returns estatisticas de progresso por peca
   */
  apply(t, params = {}) {
    const maxDelay = Math.min(Math.max(params.maxDelay ?? this.jsonMaxDelay, 0), 0.95);
    const rotationMul = params.rotationMul ?? 1;
    const positionMul = params.positionMul ?? 1;
    const depthMul = params.depthMul ?? 1;
    const scaleMul = params.scaleMul ?? 1;

    const tc = clamp01(t);
    let pMin = 1;
    let pMax = 0;
    let pSum = 0;

    for (const piece of this.pieces) {
      const d = piece.delay * maxDelay;
      const denom = 1 - d;
      const tLocal = denom > 1e-9 ? clamp01((tc - d) / denom) : tc >= 1 ? 1 : 0;
      const p = easeOutCubic(tLocal);

      piece.progress = p;
      if (p < pMin) pMin = p;
      if (p > pMax) pMax = p;
      pSum += p;

      if (!piece.node) continue;

      // START efetivo = END deslocado pelos multiplicadores.
      // Em p = 1 nada disso sobrevive: o resultado e o END puro.
      _effStartPos.set(
        piece.endPos.x + (piece.startPos.x - piece.endPos.x) * positionMul,
        piece.endPos.y + (piece.startPos.y - piece.endPos.y) * positionMul,
        piece.endPos.z + (piece.startPos.z - piece.endPos.z) * depthMul,
      );
      _effStartQuat.copy(piece.endQuat).slerp(piece.startQuat, rotationMul);
      _effStartScale.copy(piece.endScale).lerp(piece.startScale, scaleMul);

      piece.node.position.copy(_effStartPos).lerp(piece.endPos, p);
      piece.node.quaternion.copy(_effStartQuat).slerp(piece.endQuat, p);
      piece.node.scale.copy(_effStartScale).lerp(piece.endScale, p);
    }

    return {
      t: tc,
      pMin,
      pMax,
      pMean: pSum / this.pieces.length,
      pLead: this.pieces.find((p) => p.delay === 0)?.progress ?? pMax,
      pTail: this.pieces.reduce((a, b) => (b.delay > a.delay ? b : a), this.pieces[0]).progress,
    };
  }

  /**
   * Erro do estado END: aplica t = 1 e compara o TRS resultante com o TRS
   * lido do GLB no bind. Mede a cadeia inteira (JSON -> modelo -> no).
   * @returns {{position:number, quaternion:number, scale:number, max:number, worst:string}}
   *          erros em BU (posicao/escala) e em componente de quaternion
   */
  endError(params = {}) {
    this.apply(1, params);
    let ep = 0;
    let eq = 0;
    let es = 0;
    let max = 0;
    let worst = '';
    for (const piece of this.pieces) {
      if (!piece.node) continue;
      const dp = piece.node.position.distanceTo(piece.glbPos);
      const ds = piece.node.scale.distanceTo(piece.glbScale);
      const dq = quatDistance(piece.node.quaternion, piece.glbQuat);
      ep = Math.max(ep, dp);
      eq = Math.max(eq, dq);
      es = Math.max(es, ds);
      const m = Math.max(dp, dq, ds);
      if (m > max) {
        max = m;
        worst = piece.name;
      }
    }
    return { position: ep, quaternion: eq, scale: es, max, worst };
  }
}
