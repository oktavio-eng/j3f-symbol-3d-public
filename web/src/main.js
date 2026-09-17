/**
 * J3F - prototipo Three.js standalone, Fase 1.
 *
 * Carrega export/j3f-symbol.glb (intocado), dirige o TRS local das 14 laminas
 * com export/j3f-symbol-states.json (intocado) e amarra o progresso ao scroll.
 *
 * Invariantes:
 *  - GLB e JSON sao lidos, nunca escritos;
 *  - so o bloco `gltf_y_up` do JSON e consultado;
 *  - rotacao por quaternion + slerp;
 *  - t = 1 reproduz o TRS oficial dos nos do GLB (validado em runtime);
 *  - o material do GLB nao e alterado: ajuste visual vai em exposure e
 *    scene.environmentIntensity.
 */

import {
  AgXToneMapping,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Timer,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  ASSETS,
  BASELINE,
  CAMERA,
  MAX_DELTA_TIME,
  REDUCED_MOTION_MODE,
  SYMBOL,
} from './j3f-config.js';
import { J3FAnimation } from './j3f-animation.js';
import { J3FOrganicAnimation, organicCameraFactor } from './j3f-organic.js';
import { createEnvironment, createGradientDome } from './j3f-environment.js';
import { collectFitPoints, fitDistance } from './j3f-framing.js';
import { J3FInteraction, resolveWeights } from './j3f-interaction.js';

const url = new URL(window.location.href);
const DEBUG = url.searchParams.has('debug');
const SELFTEST = url.searchParams.has('selftest');
// ?capture preserva o drawing buffer para permitir print/readPixels do canvas
// (headless limpa o buffer antes do snapshot quando ele nao e preservado).
const CAPTURE = SELFTEST || url.searchParams.has('capture');

// --- coletor de erros -------------------------------------------------------
const errors = [];
window.__J3F_ERRORS = errors;
window.addEventListener('error', (e) => errors.push(String(e.message ?? e)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason ?? e)));
const consoleError = console.error.bind(console);
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  consoleError(...args);
};
const consoleWarn = console.warn.bind(console);
const warnings = [];
window.__J3F_WARNINGS = warnings;
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '));
  consoleWarn(...args);
};

// --- estado -----------------------------------------------------------------
const params = { ...BASELINE, manualOverride: false, manualT: 0 };

// ?mode=baseline|organic escolhe a coreografia sem abrir o painel.
const forcedMode = url.searchParams.get('mode');
if (forcedMode === 'baseline' || forcedMode === 'organic') params.mode = forcedMode;

// ?showInfluence liga o overlay do campo do ponteiro (precisa de ?debug).
if (url.searchParams.has('showInfluence')) params.showInfluence = true;

// ?t=0.25 congela o progresso num ponto do timeline, para avaliar um estagio
// sem ter que acertar o scroll na mao.
const forcedT = parseFloat(url.searchParams.get('t'));
if (Number.isFinite(forcedT)) {
  params.manualOverride = true;
  params.manualT = Math.min(Math.max(forcedT, 0), 1);
}
const canvas = document.getElementById('j3f-canvas');
const scrollSection = document.getElementById('j3f-scroll');
const stickyEl = document.getElementById('j3f-sticky');
const statusEl = document.getElementById('j3f-status');

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reducedStatic = prefersReduced && REDUCED_MOTION_MODE === 'static' && !SELFTEST;
/** ponteiro fino com hover de verdade: exclui touch e caneta */
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  // so em ?selftest / ?capture: permite ler o framebuffer e tirar print.
  preserveDrawingBuffer: CAPTURE,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
// AgX do Three.js e uma aproximacao do AgX do Blender: o look "Medium High
// Contrast" nao e reproduzido. O ajuste fica em exposure, nunca no material.
renderer.toneMapping = AgXToneMapping;
renderer.toneMappingExposure = params.exposure;

const scene = new Scene();
scene.add(createGradientDome({ toneMapped: true }));

const camera = new PerspectiveCamera(params.fovDeg, 1, CAMERA.near, CAMERA.far);
/** camera descartavel usada so pela busca de enquadramento */
const probeCamera = new PerspectiveCamera(params.fovDeg, 1, CAMERA.near, CAMERA.far);
/** cantos da coreografia inteira, em world space */
let fitPoints = [];

/** as duas coreografias vivem lado a lado; o painel ?debug alterna entre elas */
const interaction = new J3FInteraction();
let baselineAnimation = null;
let organicAnimation = null;
let animation = null;
let symbolRoot = null;
let environment = null;
let panel = null;

let rawProgress = params.manualOverride ? params.manualT : reducedStatic ? 1 : 0;
let smoothProgress = rawProgress;
let lastAppliedProgress = Number.NaN;
let dirty = true;
let fps = 0;
let framesRendered = 0;
let running = false;
let sectionVisible = true;
let elapsed = 0;

const timer = new Timer();

// --- camera -----------------------------------------------------------------

/**
 * Reamostra a coreografia para o enquadramento. Muta o TRS das pecas, entao
 * invalida o t aplicado - o proximo frame reescreve.
 */
function recomputeFitPoints() {
  if (!animation || !symbolRoot) return;
  fitPoints = collectFitPoints(animation, symbolRoot, params);
  lastAppliedProgress = Number.NaN;
  dirty = true;
}

function applyCamera() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const aspect = width / Math.max(height, 1);

  const halfTan = Math.tan(MathUtils.degToRad(params.fovDeg) / 2);
  if (params.autoFit) {
    probeCamera.fov = params.fovDeg;
    probeCamera.aspect = aspect;
    params.distance = fitDistance(fitPoints, probeCamera, CAMERA.direction, CAMERA.distance);
  }

  camera.fov = params.fovDeg;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  placeCamera();

  const visibleHeight = 2 * params.distance * halfTan;
  return { width, height, aspect, framing: SYMBOL.heightBU / visibleHeight };
}

/**
 * Posiciona a camera na distancia de enquadramento, multiplicada pelo dolly.
 * O dolly vale exatamente 1.0 em t = 1, entao o enquadramento final e sempre o
 * baseline - o recuo so existe durante a viagem, como respiracao.
 */
function placeCamera() {
  const factor =
    params.mode === 'organic' ? organicCameraFactor(smoothProgress, params) : 1;
  const d = params.distance * factor;
  camera.position.set(
    CAMERA.direction[0] * d,
    CAMERA.direction[1] * d,
    CAMERA.direction[2] * d,
  );
  camera.lookAt(0, 0, 0);
}

function resize() {
  // Mede o palco, nao a janela: com 100svh no mobile a barra de endereco faz
  // window.innerHeight e a altura real do canvas divergirem.
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  const info = applyCamera();
  dirty = true;
  if (panel) {
    panel.sync();
    panel.update({
      viewport: `${width}×${height} · dpr ${renderer.getPixelRatio().toFixed(2)}`,
      framing: `${(info.framing * 100).toFixed(1)}%`,
    });
  }
  return info;
}

// --- scroll -----------------------------------------------------------------

function readScroll() {
  if (reducedStatic) return 1;
  if (!scrollSection) return 0;
  const stage = stickyEl?.offsetHeight || window.innerHeight;
  const total = scrollSection.offsetHeight - stage;
  if (total <= 0) return 0;
  const scrolled = -scrollSection.getBoundingClientRect().top;
  return MathUtils.clamp(scrolled / total, 0, 1);
}

// --- microinteração ---------------------------------------------------------

/** Objeto reutilizado: resolver os pesos não pode alocar por frame. */
const ip = {};

/** Capacidades reais deste dispositivo, injetadas no resolvedor. */
const capabilities = { canHover, prefersReduced };

function resolveInteraction() {
  return resolveWeights(params, capabilities, ip);
}

/**
 * Posição do ponteiro em coordenadas de cliente. A conversão para NDC acontece
 * uma vez por frame, com o rect lido no frame: assim o pointermove não dispara
 * leitura de layout e o rect nunca fica velho quando a seção entra no sticky.
 */
const pointerClient = { x: 0, y: 0, seen: false };

function onPointerMove(event) {
  pointerClient.x = event.clientX;
  pointerClient.y = event.clientY;
  pointerClient.seen = true;
}

function syncPointer() {
  if (!pointerClient.seen) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  interaction.setAspect(rect.width / rect.height);
  const inside =
    pointerClient.x >= rect.left &&
    pointerClient.x <= rect.right &&
    pointerClient.y >= rect.top &&
    pointerClient.y <= rect.bottom;
  interaction.setPointer(
    ((pointerClient.x - rect.left) / rect.width) * 2 - 1,
    -((((pointerClient.y - rect.top) / rect.height) * 2) - 1),
    inside,
  );
}

// --- loop -------------------------------------------------------------------

function tick(timestamp) {
  if (!running) return;
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), MAX_DELTA_TIME);
  elapsed += dt;
  if (dt > 0) fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

  const interactionWeights = resolveInteraction();
  if (interactionWeights.pointerOn) syncPointer();
  interaction.update(dt, interactionWeights);

  rawProgress = params.manualOverride ? params.manualT : readScroll();

  if (params.dampingEnabled && !reducedStatic) {
    // Damping independente de frame rate: para o mesmo dt total, 60 Hz, 120 Hz
    // e quedas de FPS convergem para a mesma curva.
    const alpha = 1 - Math.exp(-params.lambda * dt);
    smoothProgress += (rawProgress - smoothProgress) * alpha;
    if (Math.abs(rawProgress - smoothProgress) < 1e-5) smoothProgress = rawProgress;
  } else {
    smoothProgress = rawProgress;
  }

  // com idle permanente o loop precisa desenhar todo frame; sem ele, volta a
  // valer o desenho sob demanda
  const animated =
    interactionWeights.idleOn || interaction.damped.activation > 0;

  if (dirty || animated || Math.abs(smoothProgress - lastAppliedProgress) > 1e-6) {
    render();
    lastAppliedProgress = smoothProgress;
    dirty = false;
    framesRendered += 1;
  }

  if (panel) {
    panel.update({
      raw: rawProgress,
      damped: smoothProgress,
      fps: fps.toFixed(0),
      pointerState:
        `${interaction.target.inside ? 'dentro' : 'fora'} · ` +
        `ativação ${interaction.damped.activation.toFixed(3)}`,
    });
  }

  if (running) requestAnimationFrame(tick);
}

/** O rAF só existe enquanto a seção está visível e a aba está em primeiro plano. */
function startLoop() {
  if (running) return;
  running = true;
  // descarta o dt acumulado durante a pausa: o idle retoma de onde parou, sem salto
  timer.update(performance.now());
  timer.getDelta();
  requestAnimationFrame(tick);
}

function stopLoop() {
  running = false;
}

/**
 * ?capture: publica o PNG do canvas no DOM para poder ser extraido de fora.
 * O headless nao compoe o canvas WebGL em --screenshot, entao o print sai do
 * proprio framebuffer.
 */
function publishCapture() {
  if (document.getElementById('j3f-capture')) return;
  const out = document.createElement('pre');
  out.id = 'j3f-capture';
  out.style.display = 'none';
  out.textContent = canvas.toDataURL('image/png');
  document.body.append(out);
  document.title = 'CAPTURE:READY';
}

function render() {
  const weights = resolveInteraction();
  if (animation) {
    const stats = animation.apply(smoothProgress, params);

    // BASE POSE: a pose da coreografia é recapturada a cada frame e é dela que
    // os offsets são derivados. Nada é aplicado sobre o resultado anterior.
    interaction.captureBase(animation);
    if (weights.idleOn || interaction.damped.activation > 0) {
      interaction.apply(animation, camera, elapsed, smoothProgress, weights);
    }

    if (panel) {
      panel.update({
        pLead: stats.pLead,
        pTail: stats.pTail,
        pMean: stats.pMean,
        phase: stats.phase ?? 'baseline',
      });
    }
  }
  if (params.mode === 'organic') placeCamera();
  if (panel && params.showInfluence) panel.updateInfluence(interaction);
  renderer.render(scene, camera);
}

// --- carga ------------------------------------------------------------------

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function load() {
  setStatus('carregando estados…');
  const statesRes = await fetch(ASSETS.states);
  if (!statesRes.ok) throw new Error(`falha ao ler ${ASSETS.states}: ${statesRes.status}`);
  const states = await statesRes.json();

  setStatus('carregando geometria…');
  const gltf = await new GLTFLoader().loadAsync(ASSETS.glb);

  symbolRoot = gltf.scene.getObjectByName(SYMBOL.root) ?? gltf.scene;
  scene.add(gltf.scene);

  // as duas coreografias sao ligadas aos MESMOS nos, antes de qualquer
  // escrita, para que ambas leiam o TRS original do GLB no bind
  baselineAnimation = new J3FAnimation(states);
  organicAnimation = new J3FOrganicAnimation(states);
  const binding = baselineAnimation.bind(symbolRoot);
  const organicBinding = organicAnimation.bind(symbolRoot);
  if (binding.missing.length || organicBinding.missing.length) {
    console.error(
      `J3F: nós ausentes no GLB: ${[...binding.missing, ...organicBinding.missing].join(', ')}`,
    );
  }
  animation = params.mode === 'organic' ? organicAnimation : baselineAnimation;
  interaction.bind(organicAnimation, symbolRoot);

  setStatus('montando estúdio…');
  environment = createEnvironment(renderer, {
    spread: params.envSpread,
    softness: params.envSoftness,
  });
  scene.environment = params.environment ? environment.texture : null;
  scene.environmentIntensity = params.envIntensity;

  const endError = baselineAnimation.endError(BASELINE);
  const organicEndError = organicAnimation.endError(BASELINE);
  organicAnimation.resetRoot();
  recomputeFitPoints();
  animation.apply(smoothProgress, params);

  setStatus('');
  return { states, binding, organicBinding, endError, organicEndError, gltf };
}

// --- eventos ----------------------------------------------------------------

/** Chaves que mudam a coreografia e portanto o enquadramento. */
const MOTION_KEYS = [
  'maxDelay', 'rotationMul', 'positionMul', 'depthMul', 'scaleMul',
  'organicStagger', 'rotationMultiplier', 'scaleVariationMultiplier',
  'curvature', 'arcLateral', 'depthShell', 'flowStrength', 'rootMotion',
];

let envRebuildTimer = 0;

/** O PMREM e caro para reassar: espera o slider parar antes de refazer. */
function scheduleEnvRebuild() {
  clearTimeout(envRebuildTimer);
  envRebuildTimer = setTimeout(() => {
    environment?.dispose();
    environment = createEnvironment(renderer, {
      spread: params.envSpread,
      softness: params.envSoftness,
    });
    scene.environment = params.environment ? environment.texture : null;
    dirty = true;
  }, 180);
}

function onParamChange(key) {
  if (key === 'mode' || key === '*') {
    animation = params.mode === 'organic' ? organicAnimation : baselineAnimation;
    // o root so respira no modo organic; ao voltar para o baseline ele precisa
    // estar exatamente na identidade
    if (params.mode !== 'organic') organicAnimation?.resetRoot();
    lastAppliedProgress = Number.NaN;
  }
  if (key === 'exposure' || key === '*') renderer.toneMappingExposure = params.exposure;
  if (key === 'envIntensity' || key === '*') scene.environmentIntensity = params.envIntensity;
  if (key === 'environment' || key === '*') {
    scene.environment = params.environment && environment ? environment.texture : null;
  }
  if (key === 'envSpread' || key === 'envSoftness' || key === '*') scheduleEnvRebuild();
  if (key === 'distance') params.autoFit = false;
  if (key === 'showInfluence' || key === '*') {
    if (panel) panel.setInfluenceVisible(params.showInfluence);
  }
  if (key === 'mode' || key === '*' || MOTION_KEYS.includes(key)) recomputeFitPoints();
  if (['fovDeg', 'distance', 'autoFit', 'mode', '*'].includes(key) || MOTION_KEYS.includes(key)) {
    const info = applyCamera();
    if (panel) {
      panel.sync();
      panel.update({ framing: `${(info.framing * 100).toFixed(1)}%` });
    }
  }
  dirty = true;
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.addEventListener('scroll', () => {
  dirty = true;
}, { passive: true });

// Ouvir no window, sem preventDefault, sem captura e sem exigir pointer-events
// no canvas: a interação 3D não pode roubar clique, hover ou seleção do DOM
// que virá por cima (Framer).
window.addEventListener('pointermove', onPointerMove, { passive: true });
for (const event of ['pointercancel', 'blur']) {
  window.addEventListener(event, () => {
    interaction.setPointer(interaction.target.x, interaction.target.y, false);
  });
}
document.addEventListener('mouseleave', () => {
  interaction.setPointer(interaction.target.x, interaction.target.y, false);
});

// rAF só enquanto a aba está visível
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (sectionVisible) startLoop();
});

// --- boot -------------------------------------------------------------------

load()
  .then(async (result) => {
    resize();

    if (DEBUG) {
      const { J3FDebugPanel } = await import('./j3f-debug.js');
      panel = new J3FDebugPanel(params, onParamChange);
      panel.setInfluenceVisible(params.showInfluence);
      panel.update({
        nodes: `${result.binding.count}/${result.binding.total}`,
        endError: result.endError.max.toExponential(2),
        endErrorOrganic: result.organicEndError.max.toExponential(2),
        capabilities: `${canHover ? 'hover' : 'coarse'} / ${prefersReduced ? 'reduced' : 'normal'}`,
        scaleRange: (() => {
          const r = organicAnimation.effectiveScaleRange(params.scaleVariationMultiplier);
          return `${r.min.toFixed(3)} – ${r.max.toFixed(3)}`;
        })(),
      });
      resize();
    }

    document.body.classList.add('is-ready');

    // rAF só enquanto a seção 3D está em tela
    if (stickyEl && 'IntersectionObserver' in window) {
      new IntersectionObserver(
        (entries) => {
          sectionVisible = entries.some((e) => e.isIntersecting);
          if (sectionVisible && !document.hidden) startLoop();
          else stopLoop();
        },
        { threshold: 0 },
      ).observe(stickyEl);
    }
    startLoop();

    if (CAPTURE && !SELFTEST) {
      // espera um frame de verdade: toDataURL antes do primeiro render devolve
      // um canvas transparente.
      const tryCapture = () =>
        (framesRendered > 0 ? publishCapture() : setTimeout(tryCapture, 200));
      setTimeout(tryCapture, Number(url.searchParams.get('captureAt')) || 500);
    }

    window.__J3F = {
      params, scene, camera, renderer, result, readScroll, resize,
      baselineAnimation, organicAnimation, interaction,
      capabilities,
      get animation() { return animation; },
    };

    if (SELFTEST) {
      const { runSelfTest } = await import('./j3f-selftest.js');
      runSelfTest({
        animation, baselineAnimation, organicAnimation, interaction,
        renderer, scene, camera, params, result,
        errors, warnings, symbolRoot, resize, readScroll,
        capabilities,
      });
    }
  })
  .catch((err) => {
    errors.push(String(err?.stack ?? err));
    console.error(err);
    setStatus(`erro: ${err.message}`);
    if (SELFTEST) {
      const node = document.createElement('pre');
      node.id = 'j3f-selftest';
      node.textContent = JSON.stringify({ ok: false, fatal: String(err), errors }, null, 2);
      document.body.append(node);
      document.title = 'SELFTEST:FAIL';
    }
  });
