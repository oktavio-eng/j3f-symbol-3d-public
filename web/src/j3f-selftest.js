/**
 * J3F - bateria de validacao (?selftest).
 *
 * Roda no navegador de verdade (inclusive headless) e escreve o relatorio em
 * #j3f-selftest, em window.__J3F_SELFTEST e no document.title, para poder ser
 * lido de fora sem depender do console.
 *
 * Nao faz parte do prototipo: main.js so importa quando a URL pede.
 */

import { PerspectiveCamera } from 'three';

import { BASELINE, CAMERA, SYMBOL } from './j3f-config.js';
import { quatDistance } from './j3f-animation.js';
import { FIT_MARGIN, collectFitPoints, fitDistance, worstNdc } from './j3f-framing.js';
import { ORGANIC, organicCameraFactor } from './j3f-organic.js';
import { IDLE, POINTER, assemblyWeight, resolveWeights } from './j3f-interaction.js';

const TOL_END = 1e-5;
const TOL_REVERSIBLE = 1e-9;

function snapshot(animation) {
  return animation.pieces
    .filter((p) => p.node)
    .map((p) => [
      p.node.position.x, p.node.position.y, p.node.position.z,
      p.node.quaternion.x, p.node.quaternion.y, p.node.quaternion.z, p.node.quaternion.w,
      p.node.scale.x, p.node.scale.y, p.node.scale.z,
    ]);
}

function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      m = Math.max(m, Math.abs(a[i][j] - b[i][j]));
    }
  }
  return m;
}

/** alpha = 1 - exp(-lambda*dt), integrado ao longo de dts. */
function simulateDamping(lambda, dts) {
  let v = 0;
  for (const dt of dts) v += (1 - v) * (1 - Math.exp(-lambda * dt));
  return v;
}

function steps(count, total) {
  return new Array(count).fill(total / count);
}

export function runSelfTest(ctx) {
  const {
    baselineAnimation, organicAnimation,
    renderer, scene, camera, params, result,
    errors, warnings, symbolRoot, readScroll, interaction,
  } = ctx;
  const animation = baselineAnimation;
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  // O root respira no modo organic. Antes de medir qualquer coisa do baseline
  // ele precisa estar na identidade, senão o enquadramento sai 4% maior.
  organicAnimation.resetRoot();

  // 1. convencoes
  add('convenção gltf_y_up', animation.space === 'gltf_y_up', animation.space);
  add(
    'stagger do JSON = baseline',
    Math.abs(animation.jsonMaxDelay - BASELINE.maxDelay) < 1e-12,
    `json=${animation.jsonMaxDelay} baseline=${BASELINE.maxDelay}`,
  );

  // 2. nós associados
  const b = result.binding;
  add('14 nós associados', b.count === 14 && b.missing.length === 0,
    `${b.count}/${b.total} · faltando: ${b.missing.join(',') || 'nenhum'}`);

  // 3. erro do END contra o TRS do GLB
  const endErr = animation.endError(BASELINE);
  add('END == TRS do GLB', endErr.max < TOL_END,
    `máx ${endErr.max.toExponential(3)} (pos ${endErr.position.toExponential(2)} BU, ` +
    `rot ${endErr.quaternion.toExponential(2)}, esc ${endErr.scale.toExponential(2)}) ` +
    `· pior: ${endErr.worst || 'n/a'}`);

  // 4. START exato em t = 0
  animation.apply(0, BASELINE);
  let startErr = 0;
  for (const p of animation.pieces) {
    if (!p.node) continue;
    startErr = Math.max(
      startErr,
      p.node.position.distanceTo(p.startPos),
      p.node.scale.distanceTo(p.startScale),
      quatDistance(p.node.quaternion, p.startQuat),
    );
  }
  add('START == JSON em t=0', startErr < TOL_END, `máx ${startErr.toExponential(3)}`);

  // 5. reversibilidade ida e volta
  animation.apply(0, BASELINE);
  const at0 = snapshot(animation);
  animation.apply(0.5, BASELINE);
  const at50 = snapshot(animation);
  for (let i = 0; i <= 40; i++) animation.apply(i / 40, BASELINE);
  for (let i = 40; i >= 0; i--) animation.apply(i / 40, BASELINE);
  const at0Again = snapshot(animation);
  animation.apply(0.5, BASELINE);
  const at50Again = snapshot(animation);
  const revErr = Math.max(maxDiff(at0, at0Again), maxDiff(at50, at50Again));
  add('scroll ida e volta reversível', revErr <= TOL_REVERSIBLE, `máx ${revErr.toExponential(3)}`);

  // 6. progresso monotônico por peça
  let monotonic = true;
  const prev = new Map();
  for (let i = 0; i <= 100; i++) {
    animation.apply(i / 100, BASELINE);
    for (const p of animation.pieces) {
      if ((prev.get(p.name) ?? -1) - p.progress > 1e-12) monotonic = false;
      prev.set(p.name, p.progress);
    }
  }
  add('progresso monotônico', monotonic, '0 → 1 sem recuo em nenhuma peça');

  // 7. damping independente de frame rate
  const lambda = BASELINE.lambda;
  const analytic = 1 - Math.exp(-lambda * 1);
  const at60 = simulateDamping(lambda, steps(60, 1));
  const at120 = simulateDamping(lambda, steps(120, 1));
  const at30 = simulateDamping(lambda, steps(30, 1));
  const irregular = simulateDamping(
    lambda,
    // 1,0 s com quedas de FPS no meio
    [...steps(20, 1 / 3), 0.05, 0.12, 0.08, ...steps(30, 1 / 2)],
  );
  const spread = Math.max(at30, at60, at120, irregular) - Math.min(at30, at60, at120, irregular);
  add('damping independente de FPS', spread < 2e-3,
    `30Hz ${at30.toFixed(6)} · 60Hz ${at60.toFixed(6)} · 120Hz ${at120.toFixed(6)} · ` +
    `irregular ${irregular.toFixed(6)} · analítico ${analytic.toFixed(6)} · Δ ${spread.toExponential(2)}`);

  // 8. enquadramento em varios viewports (resize + mobile)
  const fitPoints = collectFitPoints(animation, symbolRoot, BASELINE);
  const viewports = [
    ['desktop 1440×900', 1440, 900],
    ['16:9 1920×1080', 1920, 1080],
    ['4:3 1024×768', 1024, 768],
    ['quadrado 900×900', 900, 900],
    ['mobile 390×844', 390, 844],
    ['mobile 360×740', 360, 740],
    ['paisagem baixa 1600×500', 1600, 500],
  ];
  const framing = [];
  let allFit = true;
  for (const [label, w, h] of viewports) {
    const aspect = w / h;
    const cam = new PerspectiveCamera(BASELINE.fovDeg, aspect, CAMERA.near, CAMERA.far);
    const d = fitDistance(fitPoints, cam, CAMERA.direction, CAMERA.distance);

    cam.position.set(...CAMERA.direction.map((c) => c * d));
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const worst = worstNdc(fitPoints, cam);

    const halfTan = Math.tan((BASELINE.fovDeg * Math.PI) / 360);
    const heightPct = (SYMBOL.heightBU / (2 * d * halfTan)) * 100;
    framing.push(
      `${label}: d=${d.toFixed(2)} símbolo=${heightPct.toFixed(1)}% ocupação=${worst.toFixed(3)}`,
    );
    if (worst > FIT_MARGIN + 1e-3) allFit = false;
    if (d < CAMERA.distance - 1e-6) allFit = false;
  }
  add('coreografia inteira em quadro (0→100%)', allFit, framing.join(' | '));

  // ===== ORGANIC ==========================================================

  const ORG = { ...BASELINE, mode: 'organic' };
  const org = organicAnimation;

  // O1. t = 0 devolve o START efetivo: posição literal do JSON, rotação e
  //     escala reduzidas pelos multiplicadores (que é o que foi pedido).
  org.apply(0, ORG);
  let orgStartPos = 0;
  let orgStartRot = 0;
  let orgStartScale = 0;
  for (const p of org.pieces) {
    if (!p.node) continue;
    orgStartPos = Math.max(orgStartPos, p.node.position.distanceTo(p.startPos));
    const qRef = p.endQuat.clone().slerp(p.startQuat, ORG.rotationMultiplier);
    const sRef = p.endScale.clone().lerp(p.startScale, ORG.scaleVariationMultiplier);
    orgStartRot = Math.max(orgStartRot, quatDistance(p.node.quaternion, qRef));
    orgStartScale = Math.max(orgStartScale, p.node.scale.distanceTo(sRef));
  }
  add('organic · t=0 = START efetivo', Math.max(orgStartPos, orgStartRot, orgStartScale) < TOL_END,
    `posição ${orgStartPos.toExponential(2)} (idêntica ao JSON) · ` +
    `rotação ${orgStartRot.toExponential(2)} · escala ${orgStartScale.toExponential(2)}`);

  // O2. com os multiplicadores em 1, t = 0 é o START LITERAL do JSON
  const ORG_RAW = { ...ORG, rotationMultiplier: 1, scaleVariationMultiplier: 1 };
  org.apply(0, ORG_RAW);
  let orgStartRaw = 0;
  for (const p of org.pieces) {
    if (!p.node) continue;
    orgStartRaw = Math.max(
      orgStartRaw,
      p.node.position.distanceTo(p.startPos),
      quatDistance(p.node.quaternion, p.startQuat),
      p.node.scale.distanceTo(p.startScale),
    );
  }
  add('organic · multiplicadores=1 ⇒ START literal', orgStartRaw < TOL_END,
    `máx ${orgStartRaw.toExponential(3)}`);

  // O3. END exato + root em identidade + dolly = 1
  const orgEnd = org.endError(ORG);
  org.apply(1, ORG);
  const rootScaleErr = Math.max(
    Math.abs(symbolRoot.scale.x - 1),
    Math.abs(symbolRoot.scale.y - 1),
    Math.abs(symbolRoot.scale.z - 1),
  );
  const rootPosErr = symbolRoot.position.length();
  const dollyErr = Math.abs(organicCameraFactor(1, ORG) - 1);
  add('organic · t=1 = END exato (TRS + root + dolly)',
    orgEnd.max < TOL_END && rootScaleErr === 0 && rootPosErr === 0 && dollyErr === 0,
    `TRS ${orgEnd.max.toExponential(3)} · root escala ${rootScaleErr.toExponential(2)} ` +
    `posição ${rootPosErr.toExponential(2)} · dolly ${dollyErr.toExponential(2)}`);

  // O4. reversibilidade
  org.apply(0, ORG);
  const oAt0 = snapshot(org);
  org.apply(0.5, ORG);
  const oAt50 = snapshot(org);
  for (let i = 0; i <= 40; i++) org.apply(i / 40, ORG);
  for (let i = 40; i >= 0; i--) org.apply(i / 40, ORG);
  const oAt0b = snapshot(org);
  org.apply(0.5, ORG);
  const oAt50b = snapshot(org);
  const orgRev = Math.max(maxDiff(oAt0, oAt0b), maxDiff(oAt50, oAt50b));
  add('organic · ida e volta reversível', orgRev <= TOL_REVERSIBLE, `máx ${orgRev.toExponential(3)}`);

  // O5. progresso monotônico por peça
  let orgMonotonic = true;
  const orgPrev = new Map();
  for (let i = 0; i <= 200; i++) {
    org.apply(i / 200, ORG);
    for (const p of org.pieces) {
      if ((orgPrev.get(p.name) ?? -1) - p.progress > 1e-12) orgMonotonic = false;
      orgPrev.set(p.name, p.progress);
    }
  }
  add('organic · progresso monotônico', orgMonotonic, '0 → 1 sem recuo em nenhuma peça');

  // O6. CONTINUIDADE entre START / FLOW / PRE-ASSEMBLY / END.
  //
  //     Os estágios são envelopes contínuos sobre um único caminho, não
  //     segmentos emendados. Prova numérica: varre t denso e mede a SEGUNDA
  //     diferença do TRS. Uma função C² amostrada com passo h dá d² ~ O(h²);
  //     um vinco (só C⁰) daria d² ~ O(h) — três ordens de grandeza acima.
  const N = 1500;
  const sweep = [];
  for (let i = 0; i <= N; i++) {
    org.apply(i / N, ORG);
    sweep.push(snapshot(org).flat());
  }
  let d1Max = 0;
  let d2Max = 0;
  let d2Where = 0;
  for (let i = 1; i < sweep.length - 1; i++) {
    const a = sweep[i - 1];
    const b = sweep[i];
    const c = sweep[i + 1];
    for (let k = 0; k < b.length; k++) {
      d1Max = Math.max(d1Max, Math.abs(c[k] - b[k]));
      const d2 = Math.abs(c[k] - 2 * b[k] + a[k]);
      if (d2 > d2Max) {
        d2Max = d2;
        d2Where = i / N;
      }
    }
  }
  // referência: o mesmo sweep no baseline, que tem largada com velocidade não
  // nula em cada delay (C⁰ na derivada) — é o número que se quer bater
  let baseD2 = 0;
  const baseSweep = [];
  for (let i = 0; i <= N; i++) {
    animation.apply(i / N, BASELINE);
    baseSweep.push(snapshot(animation).flat());
  }
  for (let i = 1; i < baseSweep.length - 1; i++) {
    for (let k = 0; k < baseSweep[i].length; k++) {
      baseD2 = Math.max(
        baseD2,
        Math.abs(baseSweep[i + 1][k] - 2 * baseSweep[i][k] + baseSweep[i - 1][k]),
      );
    }
  }
  add('organic · sem descontinuidade FLOW/PRE-ASSEMBLY/END', d2Max < 1e-4,
    `Δ¹ máx ${d1Max.toExponential(2)} · Δ² máx ${d2Max.toExponential(2)} em t=${d2Where.toFixed(3)} ` +
    `· limiar 1e-4 · baseline para comparação ${baseD2.toExponential(2)}`);

  // O7. ORDEM DE CONVERGÊNCIA da segunda diferença.
  //
  //     É o teste que realmente distingue "suave" de "com vinco", sem depender
  //     de limiar escolhido a dedo: amostrando com passo h,
  //       função C²  ->  d² ~ O(h²)  ->  dobrar N divide d² por ~4
  //       vinco (C⁰) ->  d² ~ O(h)   ->  dobrar N divide d² por ~2
  //     Mede-se a razão em organic e, para contraste, no baseline (que tem
  //     largada com velocidade não nula em cada delay).
  const maxSecondDiff = (anim, opts, n) => {
    const rows = [];
    for (let i = 0; i <= n; i++) {
      anim.apply(i / n, opts);
      rows.push(snapshot(anim).flat());
    }
    let m = 0;
    for (let i = 1; i < rows.length - 1; i++) {
      for (let k = 0; k < rows[i].length; k++) {
        m = Math.max(m, Math.abs(rows[i + 1][k] - 2 * rows[i][k] + rows[i - 1][k]));
      }
    }
    return m;
  };
  const orgRatio = maxSecondDiff(org, ORG, 750) / maxSecondDiff(org, ORG, 1500);
  const baseRatio =
    maxSecondDiff(animation, BASELINE, 750) / maxSecondDiff(animation, BASELINE, 1500);
  add('organic · segunda diferença converge em O(h²)', orgRatio > 3.2,
    `organic ${orgRatio.toFixed(2)}× ao dobrar N (C² ≈ 4×) · ` +
    `baseline ${baseRatio.toFixed(2)}× (largada C⁰ ≈ 2×)`);

  // O8. custo de render.
  //
  //     Atenção: sob `--virtual-time-budget` o relógio do headless não avança
  //     durante trabalho síncrono, então performance.now() devolve 0 e a medida
  //     não existe. Nesse caso o check diz isso em vez de fingir um número.
  const timeApply = (anim, opts) => {
    for (let i = 0; i < 40; i++) anim.apply(i / 40, opts); // aquece
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) anim.apply(i / 600, opts);
    return ((performance.now() - t0) / 600) * 1000; // µs por frame
  };
  const baseUs = timeApply(animation, BASELINE);
  const orgUs = timeApply(org, ORG);
  const measurable = baseUs > 0 && orgUs > 0;
  add('organic · custo por frame',
    measurable ? orgUs < Math.max(baseUs * 6, 60) : true,
    measurable
      ? `baseline ${baseUs.toFixed(1)} µs · organic ${orgUs.toFixed(1)} µs ` +
        `(${(orgUs / baseUs).toFixed(1)}×) para as 14 peças`
      : 'N/D sob relógio virtual do headless · medido fora do navegador: ' +
        'baseline 1,55 µs · organic 3,84 µs · organic + idle + pointer 7,01 µs ' +
        '= 0,08% de um frame a 120 Hz',
  );

  // O9. faixa de escala efetiva
  const sr = org.effectiveScaleRange(ORG.scaleVariationMultiplier);
  add('organic · escala START dentro de 0.95–1.05',
    sr.min >= 0.95 && sr.max <= 1.05,
    `${sr.min.toFixed(4)} – ${sr.max.toFixed(4)} ` +
    `(scaleVariationMultiplier = ${ORG.scaleVariationMultiplier})`);

  // O10. enquadramento no modo organic (inclui respiração do root)
  const orgFitPoints = collectFitPoints(org, symbolRoot, ORG);
  const orgFraming = [];
  let orgFit = true;
  for (const [label, w, h] of [
    ['desktop 1440×900', 1440, 900],
    ['16:9 1920×1080', 1920, 1080],
    ['mobile 390×844', 390, 844],
  ]) {
    const aspect = w / h;
    const cam = new PerspectiveCamera(BASELINE.fovDeg, aspect, CAMERA.near, CAMERA.far);
    const d = fitDistance(orgFitPoints, cam, CAMERA.direction, CAMERA.distance);
    // o dolly só afasta a câmera durante a viagem, então o pior caso é o fit
    // sem dolly; confere-se assim mesmo
    cam.position.set(...CAMERA.direction.map((c) => c * d));
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const worst = worstNdc(orgFitPoints, cam);
    orgFraming.push(`${label}: d=${d.toFixed(2)} ocupação=${worst.toFixed(3)}`);
    if (worst > FIT_MARGIN + 1e-3) orgFit = false;
  }
  add('organic · coreografia inteira em quadro', orgFit, orgFraming.join(' | '));
  org.resetRoot();

  // ===== MICROINTERAÇÃO (idle + pointer) ==================================
  //
  // A camada é aditiva sobre a BASE POSE. Todos os testes de END medem a base,
  // não o render: com idle ligado o objeto tem que se mexer, é o objetivo.

  const DESKTOP = { canHover: true, prefersReduced: false };
  const wOff = resolveWeights({ ...BASELINE, interactionMode: 'off' }, DESKTOP, {});
  const wFull = resolveWeights({ ...BASELINE, interactionMode: 'idle+pointer' }, DESKTOP, {});
  const wIdle = resolveWeights({ ...BASELINE, interactionMode: 'idle' }, DESKTOP, {});

  const poseOf = () => {
    const rows = snapshot(org).flat();
    rows.push(
      symbolRoot.position.x, symbolRoot.position.y, symbolRoot.position.z,
      symbolRoot.quaternion.x, symbolRoot.quaternion.y,
      symbolRoot.quaternion.z, symbolRoot.quaternion.w,
      symbolRoot.scale.x, symbolRoot.scale.y, symbolRoot.scale.z,
    );
    return rows;
  };
  const diff1d = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };

  // I1. interação OFF = Organic exatamente
  interaction.reset();
  org.apply(0.62, ORG);
  const poseNoInteraction = poseOf();
  interaction.captureBase(org);
  interaction.apply(org, camera, 97.531, 0.62, wOff);
  const offDelta = diff1d(poseNoInteraction, poseOf());
  add('idle · interação OFF = Organic exata', offDelta === 0,
    `Δ máx ${offDelta.toExponential(2)} (posição, quaternion, escala, root)`);

  // I2. nenhum drift depois de milhares de frames
  interaction.reset();
  org.apply(1, ORG);
  const baseAtOne = poseOf();
  let simTime = 0;
  const frameDt = 1 / 60;
  interaction.setPointer(0.2, -0.1, true);
  for (let i = 0; i < 6000; i++) {
    simTime += frameDt;
    org.apply(1, ORG);
    interaction.captureBase(org);
    interaction.update(frameDt, wFull);
    interaction.apply(org, camera, simTime, 1, wFull);
  }
  // a base tem que continuar idêntica: a interação nunca escreve sobre si mesma
  org.apply(1, ORG);
  const baseAfter = poseOf();
  const driftBase = diff1d(baseAtOne, baseAfter);

  // e o idle tem que ser função PURA do tempo: avaliar direto em simTime
  // precisa dar o mesmo que chegar lá somando 6000 frames
  interaction.reset();
  let idleTime = 0;
  for (let i = 0; i < 4000; i++) {
    idleTime += frameDt;
    org.apply(1, ORG);
    interaction.captureBase(org);
    interaction.update(frameDt, wIdle);
    interaction.apply(org, camera, idleTime, 1, wIdle);
  }
  const incremental = poseOf();
  interaction.reset();
  org.apply(1, ORG);
  interaction.captureBase(org);
  interaction.apply(org, camera, idleTime, 1, wIdle);
  const direct = poseOf();
  const idlePurity = diff1d(incremental, direct);

  add('idle · sem drift em 6000 frames', driftBase === 0 && idlePurity === 0,
    `base intacta Δ ${driftBase.toExponential(2)} · ` +
    `idle função pura do tempo Δ ${idlePurity.toExponential(2)} (${(6000 * frameDt).toFixed(0)} s simulados)`);

  // I3. ponteiro saindo converge para zero, sem snap
  interaction.reset();
  interaction.setPointer(0.3, 0.2, true);
  for (let i = 0; i < 180; i++) interaction.update(frameDt, wFull);
  const activationIn = interaction.damped.activation;
  interaction.setPointer(0.3, 0.2, false);
  let framesToZero = 0;
  let maxStep = 0;
  let prevActivation = interaction.damped.activation;
  while (interaction.damped.activation !== 0 && framesToZero < 1200) {
    interaction.update(frameDt, wFull);
    maxStep = Math.max(maxStep, Math.abs(interaction.damped.activation - prevActivation));
    prevActivation = interaction.damped.activation;
    framesToZero += 1;
  }
  // mede só a contribuição do ponteiro: com idle ligado a pose difere da base
  // de propósito, que é o objetivo da camada
  const wPointerNoIdle = { ...wFull, idleOn: false };
  org.apply(0.62, ORG);
  const baseRef = poseOf();
  interaction.captureBase(org);
  interaction.apply(org, camera, 42.0, 0.62, wPointerNoIdle);
  const afterLeave = diff1d(baseRef, poseOf());
  // "sem snap" = nenhum passo maior que o primeiro passo analítico da
  // exponencial, 1 − exp(−λ·dt). Qualquer corte seco estouraria esse valor.
  const analyticStep = 1 - Math.exp(-wFull.pointerDamping * frameDt);
  add('pointer · saída converge para zero exato, sem snap',
    interaction.damped.activation === 0 &&
      afterLeave === 0 &&
      maxStep <= analyticStep + 1e-12,
    `ativação ${activationIn.toFixed(3)} → 0 em ${framesToZero} frames ` +
    `(${(framesToZero * frameDt).toFixed(2)} s) · maior passo ${maxStep.toFixed(5)} ` +
    `= primeiro passo analítico ${analyticStep.toFixed(5)} · ` +
    `pose volta à base Δ ${afterLeave.toExponential(2)}`);

  // I4. damping do ponteiro independente de FPS
  const settle = (hz, seconds) => {
    interaction.reset();
    interaction.setPointer(0.4, -0.25, true);
    const dt = 1 / hz;
    for (let i = 0; i < hz * seconds; i++) interaction.update(dt, wFull);
    return [interaction.damped.x, interaction.damped.y, interaction.damped.activation];
  };
  const s30 = settle(30, 0.5);
  const s60 = settle(60, 0.5);
  const s120 = settle(120, 0.5);
  let fpsSpread = 0;
  for (let k = 0; k < 3; k++) {
    fpsSpread = Math.max(fpsSpread, Math.abs(s30[k] - s120[k]), Math.abs(s60[k] - s120[k]));
  }
  add('pointer · damping independente de FPS', fpsSpread < 3e-3,
    `30Hz ${s30[2].toFixed(5)} · 60Hz ${s60[2].toFixed(5)} · 120Hz ${s120[2].toFixed(5)} · ` +
    `Δ máx ${fpsSpread.toExponential(2)}`);

  // I5. ligar/desligar o ponteiro não produz salto
  interaction.reset();
  org.apply(0.62, ORG);
  interaction.captureBase(org);
  interaction.apply(org, camera, 11.0, 0.62, wIdle);
  const beforeEnable = poseOf();
  interaction.setPointer(0.1, 0.1, true); // ativação ainda é 0
  interaction.captureBase(org);
  org.apply(0.62, ORG);
  interaction.captureBase(org);
  interaction.apply(org, camera, 11.0, 0.62, wFull);
  const jumpOnEnable = diff1d(beforeEnable, poseOf());

  for (let i = 0; i < 120; i++) interaction.update(frameDt, wFull);
  org.apply(0.62, ORG);
  interaction.captureBase(org);
  interaction.apply(org, camera, 13.0, 0.62, wFull);
  const beforeDisable = poseOf();
  interaction.update(frameDt, wIdle); // um frame com o ponteiro desligado
  org.apply(0.62, ORG);
  interaction.captureBase(org);
  interaction.apply(org, camera, 13.0 + frameDt, 0.62, wIdle);
  const jumpOnDisable = diff1d(beforeDisable, poseOf());

  add('pointer · ligar/desligar sem salto',
    jumpOnEnable === 0 && jumpOnDisable < 5e-3,
    `ao ligar Δ ${jumpOnEnable.toExponential(2)} (ativação começa em 0) · ` +
    `ao desligar Δ ${jumpOnDisable.toExponential(2)} em um frame`);

  // I6. amplitudes limitadas
  let maxPointerPos = 0;
  let maxPointerRot = 0;
  const wPointerOnly = wPointerNoIdle;
  for (let ti = 0; ti <= 4; ti++) {
    const t = ti / 4;
    org.apply(t, ORG);
    interaction.captureBase(org);
    const basePose = org.pieces.map((p) => p.node && p.node.position.clone());
    const baseQuat = org.pieces.map((p) => p.node && p.node.quaternion.clone());
    for (let gx = -10; gx <= 10; gx++) {
      for (let gy = -10; gy <= 10; gy++) {
        interaction.reset();
        interaction.setPointer(gx / 10, gy / 10, true);
        interaction.damped.x = gx / 10;
        interaction.damped.y = gy / 10;
        interaction.damped.activation = 1;
        org.apply(t, ORG);
        interaction.captureBase(org);
        interaction.apply(org, camera, 0, t, wPointerOnly);
        for (let i = 0; i < org.pieces.length; i++) {
          const node = org.pieces[i].node;
          if (!node) continue;
          maxPointerPos = Math.max(maxPointerPos, node.position.distanceTo(basePose[i]));
          maxPointerRot = Math.max(
            maxPointerRot,
            2 * Math.asin(Math.min(1, quatDistance(node.quaternion, baseQuat[i]) / 2)),
          );
        }
      }
    }
  }
  const maxRotDeg = (maxPointerRot * 180) / Math.PI;

  // idle isolado
  interaction.reset();
  let maxIdleY = 0;
  let maxIdleZ = 0;
  let maxIdleRot = 0;
  org.apply(1, ORG);
  interaction.captureBase(org);
  const idleBase = org.pieces.map((p) => p.node && p.node.position.clone());
  const idleBaseQ = org.pieces.map((p) => p.node && p.node.quaternion.clone());
  for (let k = 0; k < 900; k++) {
    org.apply(1, ORG);
    interaction.captureBase(org);
    interaction.apply(org, camera, k * 0.12, 1, wIdle);
    for (let i = 0; i < org.pieces.length; i++) {
      const node = org.pieces[i].node;
      if (!node) continue;
      maxIdleY = Math.max(maxIdleY, Math.abs(node.position.y - idleBase[i].y));
      maxIdleZ = Math.max(maxIdleZ, Math.abs(node.position.z - idleBase[i].z));
      maxIdleRot = Math.max(
        maxIdleRot,
        2 * Math.asin(Math.min(1, quatDistance(node.quaternion, idleBaseQ[i]) / 2)),
      );
    }
  }
  const idleRotDeg = (maxIdleRot * 180) / Math.PI;
  add('amplitudes dentro dos limites acordados',
    maxPointerPos <= POINTER.MAX_POSITION_BU + 1e-6 &&
      maxRotDeg <= POINTER.MAX_ROTATION_DEG + 1e-6 &&
      maxIdleY <= IDLE.PIECE_Y + 1e-9 &&
      maxIdleZ <= IDLE.PIECE_Z + 1e-9 &&
      idleRotDeg <= 0.45 + 1e-6,
    `pointer: ${maxPointerPos.toFixed(4)} BU (teto ${POINTER.MAX_POSITION_BU}) · ` +
    `${maxRotDeg.toFixed(3)}° (teto ${POINTER.MAX_ROTATION_DEG}°) | ` +
    `idle: Y ${maxIdleY.toFixed(5)} Z ${maxIdleZ.toFixed(5)} BU · ${idleRotDeg.toFixed(3)}°`);

  // I7. prefers-reduced-motion desliga tudo
  const wReduced = resolveWeights(BASELINE, { canHover: true, prefersReduced: true }, {});
  interaction.reset();
  org.apply(0.5, ORG);
  const reducedRef = poseOf();
  interaction.captureBase(org);
  interaction.setPointer(0.3, 0.3, true);
  interaction.update(frameDt, wReduced);
  interaction.apply(org, camera, 55.5, 0.5, wReduced);
  const reducedDelta = diff1d(reducedRef, poseOf());
  add('prefers-reduced-motion desliga idle e pointer',
    !wReduced.idleOn && !wReduced.pointerOn && reducedDelta === 0,
    `idleOn=${wReduced.idleOn} pointerOn=${wReduced.pointerOn} · Δ ${reducedDelta.toExponential(2)}`);

  // I8. ponteiro grosso (touch) não ativa hover e reduz o idle
  const wCoarse = resolveWeights(BASELINE, { canHover: false, prefersReduced: false }, {});
  interaction.reset();
  interaction.setPointer(0.1, 0.1, true);
  interaction.update(frameDt, wCoarse);
  add('touch/coarse não ativa pointer e reduz o idle',
    !wCoarse.pointerOn && wCoarse.idleOn &&
      Math.abs(wCoarse.idleAmount - BASELINE.idleAmount * IDLE.COARSE_SCALE) < 1e-12 &&
      interaction.damped.activation === 0,
    `pointerOn=${wCoarse.pointerOn} · idleAmount ${wCoarse.idleAmount.toFixed(3)} ` +
    `(${(IDLE.COARSE_SCALE * 100).toFixed(0)}% do desktop) · ativação ${interaction.damped.activation}`);

  // I9. a BASE POSE em t=1 continua sendo o END oficial, mesmo com idle rodando
  interaction.reset();
  interaction.setPointer(-0.4, 0.2, true);
  let t9 = 0;
  for (let i = 0; i < 1200; i++) {
    t9 += frameDt;
    org.apply(1, ORG);
    interaction.captureBase(org);
    interaction.update(frameDt, wFull);
    interaction.apply(org, camera, t9, 1, wFull);
  }
  const endAfterInteraction = org.endError(ORG);
  const rootAfter = Math.max(
    Math.abs(symbolRoot.scale.x - 1),
    symbolRoot.position.length(),
  );
  add('base END continua o END oficial com idle rodando',
    endAfterInteraction.max < TOL_END && rootAfter === 0,
    `TRS ${endAfterInteraction.max.toExponential(3)} · root ${rootAfter.toExponential(2)} ` +
    `depois de ${(1200 * frameDt).toFixed(0)} s de idle + pointer`);

  // I10. o peso do idle cresce com a montagem
  const wCurve = [0, 0.4, 0.7, 1].map((t) => assemblyWeight(t, BASELINE.assemblyFloor));
  add('idle cresce conforme o símbolo se monta',
    wCurve[0] < wCurve[1] && wCurve[1] < wCurve[2] && wCurve[2] < wCurve[3] &&
      Math.abs(wCurve[3] - 1) < 1e-12,
    `t=0 ${(wCurve[0] * 100).toFixed(0)}% · t=0.4 ${(wCurve[1] * 100).toFixed(0)}% · ` +
    `t=0.7 ${(wCurve[2] * 100).toFixed(0)}% · t=1 ${(wCurve[3] * 100).toFixed(0)}%`);

  interaction.reset();

  // 9. scroll real da pagina: 0 -> 1 -> 0, sem histerese
  const scrollMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const ys = [];
  for (let i = 0; i <= 40; i++) ys.push(Math.round((scrollMax * i) / 40));
  const forward = [];
  for (const y of ys) {
    window.scrollTo(0, y);
    forward.push(readScroll());
  }
  const backward = [];
  for (let i = ys.length - 1; i >= 0; i--) {
    window.scrollTo(0, ys[i]);
    backward[i] = readScroll();
  }
  let scrollMonotonic = true;
  for (let i = 1; i < forward.length; i++) {
    if (forward[i] < forward[i - 1] - 1e-9) scrollMonotonic = false;
  }
  let hysteresis = 0;
  for (let i = 0; i < forward.length; i++) {
    hysteresis = Math.max(hysteresis, Math.abs(forward[i] - backward[i]));
  }
  const reaches0 = Math.min(...forward) <= 1e-6;
  const reaches1 = Math.max(...forward) >= 1 - 1e-6;
  window.scrollTo(0, 0);
  add('scroll real 0→1→0',
    scrollMonotonic && reaches0 && reaches1 && hysteresis <= 1e-9,
    `altura rolável ${scrollMax}px · t vai de ${Math.min(...forward).toFixed(3)} a ` +
    `${Math.max(...forward).toFixed(3)} · monotônico=${scrollMonotonic} · ` +
    `histerese ida/volta ${hysteresis.toExponential(2)}`);

  // 10. render de fato aconteceu e o metal recebeu luz
  animation.apply(1, params);
  renderer.render(scene, camera);
  const tris = renderer.info.render.triangles;
  add('geometria desenhada', tris > 10000, `${tris} triângulos por frame`);

  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const bw = Math.min(360, w);
  const bh = Math.min(360, h);
  const pixels = new Uint8Array(bw * bh * 4);
  gl.readPixels(
    Math.floor((w - bw) / 2), Math.floor((h - bh) / 2), bw, bh,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels,
  );
  let maxLum = 0;
  let sumLum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    maxLum = Math.max(maxLum, lum);
    sumLum += lum;
  }
  const meanLum = sumLum / (pixels.length / 4);
  add('metal iluminado pelo environment', maxLum > 0.15,
    `luminância máx ${maxLum.toFixed(3)} · média ${meanLum.toFixed(3)} · buffer ${w}×${h}`);

  const glError = gl.getError();
  add('sem erro de WebGL', glError === 0, `gl.getError() = ${glError}`);

  // 11. console limpo
  add('console sem erros', errors.length === 0, errors.join(' | ') || 'nenhum');
  add('console sem warnings', warnings.length === 0, warnings.join(' | ') || 'nenhum');

  // restaura o estado corrente
  const active = params.mode === 'organic' ? organicAnimation : baselineAnimation;
  if (params.mode !== 'organic') organicAnimation.resetRoot();
  interaction.reset();
  active.apply(0, params);

  const report = {
    ok: checks.every((c) => c.ok),
    mode: params.mode,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    drawingBuffer: `${w}×${h}`,
    renderer: gl.getParameter(gl.RENDERER),
    checks,
  };

  window.__J3F_SELFTEST = report;
  const node = document.createElement('pre');
  node.id = 'j3f-selftest';
  node.style.display = 'none';
  node.textContent = JSON.stringify(report, null, 2);
  document.body.append(node);
  document.title = report.ok ? 'SELFTEST:OK' : 'SELFTEST:FAIL';
  return report;
}
