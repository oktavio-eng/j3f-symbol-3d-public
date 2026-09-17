/**
 * J3F - enquadramento responsivo.
 *
 * O baseline do Blender (70mm, 6,36 BU, simbolo a ~62% da altura) foi calibrado
 * num quadro RETRATO de 1200x1400. Na web o aspect e outro e varia, entao o FOV
 * nao pode ser simplesmente copiado: o que se preserva e a intencao.
 *
 * Duas regras, nesta ordem:
 *  1. a camera nunca chega mais perto que a distancia baseline - isso trava o
 *     teto de ~62% de altura do simbolo montado;
 *  2. a camera recua o quanto for preciso para que a COREOGRAFIA INTEIRA (nao
 *     so o simbolo montado) caiba no quadro, inclusive a dispersao de t = 0.
 *
 * A regra 2 e o que faz o prototipo se comportar em retrato/mobile, onde o FOV
 * horizontal e estreito e a dispersao sairia de quadro.
 */

import { Box3, Vector3 } from 'three';

/** Fracao do quadro (NDC) que a coreografia pode ocupar. 1.0 = borda exata. */
export const FIT_MARGIN = 0.98;

const _box = new Box3();
const _v = new Vector3();

function pushCorners(box, out) {
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
    }
  }
}

/**
 * Amostra a coreografia e devolve os cantos das bboxes de cada peca em world
 * space. Amostra so o inicio do timeline: dali em diante as pecas convergem.
 *
 * Atencao: muta o TRS das pecas. Quem chama precisa reaplicar o t corrente.
 */
export function collectFitPoints(animation, symbolRoot, params, samples = [0, 0.08, 0.16, 0.25, 0.4]) {
  const points = [];
  for (const t of samples) {
    animation.apply(t, params);
    symbolRoot.updateMatrixWorld(true);
    for (const piece of animation.pieces) {
      if (!piece.node) continue;
      _box.setFromObject(piece.node);
      pushCorners(_box, points);
    }
  }
  return points;
}

/** Maior |x| ou |y| em NDC entre todos os pontos. <= 1 significa "em quadro". */
export function worstNdc(points, camera) {
  let worst = 0;
  for (const p of points) {
    _v.copy(p).project(camera);
    worst = Math.max(worst, Math.abs(_v.x), Math.abs(_v.y));
  }
  return worst;
}

/**
 * Menor distancia >= minDistance em que a coreografia inteira cabe no quadro.
 * @param {Vector3[]} points
 * @param {import('three').PerspectiveCamera} camera camera de trabalho, ja com fov/aspect
 * @param {number[]} direction direcao unitaria camera->origem
 * @param {number} minDistance distancia baseline (teto de aproximacao)
 */
export function fitDistance(points, camera, direction, minDistance, margin = FIT_MARGIN) {
  if (!points.length) return minDistance;

  const place = (d) => {
    camera.position.set(direction[0] * d, direction[1] * d, direction[2] * d);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return worstNdc(points, camera);
  };

  let lo = minDistance;
  if (place(lo) <= margin) return lo;

  let hi = lo * 1.5;
  for (let i = 0; i < 12 && place(hi) > margin; i++) hi *= 1.5;

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (place(mid) > margin) lo = mid;
    else hi = mid;
  }
  return hi;
}
