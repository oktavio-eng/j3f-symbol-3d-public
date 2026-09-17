/**
 * J3F - parametros do prototipo Three.js.
 *
 * Tudo que e "baseline" aqui vem da Fase Blender (scripts/j3f_config.py e
 * scripts/03_materials.py) e nao deve ser reinventado. O que e derivado, e
 * derivado em codigo a partir dos numeros do Blender, para nao virar constante
 * magica desalinhada da fonte.
 */

const DEG = 180 / Math.PI;

/** Caminhos relativos a web/ - os arquivos aprovados nao sao copiados nem alterados. */
export const ASSETS = {
  glb: '../export/j3f-symbol.glb',
  states: '../export/j3f-symbol-states.json',
};

/** Dimensoes do simbolo montado, em BU (conferem com symbol.* do JSON). */
export const SYMBOL = {
  root: 'J3F_Symbol_Root',
  heightBU: 2.0,
  widthBU: 1.708169,
};

// --- Camera -----------------------------------------------------------------
// Blender: 70mm, sensor 36mm, sensor_fit AUTO em 1200x1400 (retrato) -> os 36mm
// caem na VERTICAL, entao o FOV vertical do Blender e o FOV do Three.js.
const CAM_LENS_MM = 70.0;
const CAM_SENSOR_MM = 36.0;

// Posicao da camera no Blender (Z-up) convertida para glTF/Three (Y-up): (x, z, -y).
const CAM_LOC_BLENDER = [1.0, -6.25, 0.6];
const CAM_LOC_YUP = [CAM_LOC_BLENDER[0], CAM_LOC_BLENDER[2], -CAM_LOC_BLENDER[1]];

const CAM_DISTANCE = Math.hypot(...CAM_LOC_YUP);
const CAM_FOV_DEG = 2 * Math.atan(CAM_SENSOR_MM / 2 / CAM_LENS_MM) * DEG;

// Fracao da altura do quadro ocupada pelo simbolo no enquadramento aprovado.
// Derivada, nao escolhida: e o que o baseline do Blender produz (~62%).
const CAM_HALF_TAN = Math.tan((CAM_FOV_DEG / DEG) / 2);
const FRAME_HEIGHT_FRACTION = SYMBOL.heightBU / (2 * CAM_DISTANCE * CAM_HALF_TAN);

export const CAMERA = {
  lensMM: CAM_LENS_MM,
  sensorMM: CAM_SENSOR_MM,
  fovDeg: CAM_FOV_DEG,
  distance: CAM_DISTANCE,
  /** direcao unitaria camera->origem preservada do baseline */
  direction: CAM_LOC_YUP.map((c) => c / CAM_DISTANCE),
  /** fracao da altura do quadro ocupada pelo simbolo montado no baseline */
  heightFraction: FRAME_HEIGHT_FRACTION,
  near: 0.1,
  far: 120,
};

// --- World do Blender (autoral) ---------------------------------------------
// ColorRamp EASE sobre Generated.Z, de 03_materials.py::_world().
// Valores LINEARES - nao sao cores sRGB.
export const WORLD_RAMP = {
  interpolation: 'ease',
  stops: [
    { pos: 0.22, color: [0.006, 0.008, 0.011] },
    { pos: 0.58, color: [0.038, 0.048, 0.062] },
    { pos: 0.95, color: [0.165, 0.19, 0.225] },
  ],
};

// --- Luzes do Blender (autoral) ---------------------------------------------
// #00B1CC -> linear (usado como base das luzes de acento, igual ao Blender).
const BRAND_LINEAR = [0.0, 0.4397, 0.6038];

/**
 * As 7 area lights de 03_materials.py::_lights().
 * loc em Blender Z-up; a conversao para Y-up acontece no modulo de environment.
 * size/sizeY em BU, power em W (Blender), color linear.
 */
export const LIGHTS = [
  { name: 'J3F_Key', loc: [-2.9, -3.6, 2.4], size: 4.0, power: 4600, color: [1.0, 0.985, 0.96] },
  { name: 'J3F_Key_Hi', loc: [2.6, -3.4, 2.9], size: 2.4, power: 2800, color: [0.98, 0.99, 1.0] },
  {
    name: 'J3F_Fill_Cyan',
    loc: [-3.4, -3.2, -2.4],
    size: 4.5,
    power: 2000,
    color: [BRAND_LINEAR[0] + 0.02, BRAND_LINEAR[1] + 0.16, BRAND_LINEAR[2] + 0.2],
  },
  { name: 'J3F_Kicker', loc: [3.4, -2.6, 1.6], size: 1.2, power: 3400, color: [0.96, 0.98, 1.0] },
  { name: 'J3F_Strip', loc: [0.9, -2.4, 3.2], size: 0.16, sizeY: 8.0, power: 3000, color: [1.0, 1.0, 1.0] },
  {
    name: 'J3F_Strip_Low',
    loc: [-1.4, -2.7, -3.0],
    size: 0.14,
    sizeY: 7.0,
    power: 850,
    color: [BRAND_LINEAR[0] + 0.3, BRAND_LINEAR[1] + 0.55, BRAND_LINEAR[2] + 0.62],
  },
  { name: 'J3F_Ambient', loc: [0.2, -6.4, 0.4], size: 11.0, power: 260, color: [0.94, 0.965, 1.0] },
];

/**
 * Radiancia de uma area light lambertiana: L = P / (A * pi).
 * Mantem entre as luzes exatamente a mesma proporcao do Cycles; a escala
 * absoluta e ajustada visualmente por envIntensity/exposure, nunca no material.
 */
export function lightRadiance(light) {
  const area = light.size * (light.sizeY ?? light.size);
  return light.power / (area * Math.PI);
}

// --- Baseline dos controles -------------------------------------------------
/**
 * Valores de partida do prototipo. O botao "reset baseline" do painel ?debug
 * volta exatamente para ca. Multiplicadores em 1.0 = coreografia aprovada.
 */
export const BASELINE = {
  /** 'baseline' = coreografia aprovada da Fase Blender; 'organic' = variante */
  mode: 'organic',

  // damping (independente de frame rate: alpha = 1 - exp(-lambda * dt))
  dampingEnabled: true,
  lambda: 6.0,

  // --- animacao BASELINE (nao mexer: e a coreografia aprovada) -------------
  maxDelay: 0.3, // == animation.stagger.max_delay_fraction do JSON
  rotationMul: 1.0,
  positionMul: 1.0, // X/Y no espaco Y-up
  depthMul: 1.0, // Z no espaco Y-up (a profundidade do Blender)
  scaleMul: 1.0,

  // --- animacao ORGANIC (experimental) ------------------------------------
  /** onda continua por coluna; mais sobreposta que o stagger de 0.30 */
  organicStagger: 0.165,
  /** reduz a rotacao de START em relacao ao END, proceduralmente */
  rotationMultiplier: 0.7,
  /** reduz a variacao de escala de START; 0.25 -> faixa efetiva ~0.96-1.03 */
  scaleVariationMultiplier: 0.25,
  /** mestre da curvatura das trajetorias (0 = reta) */
  curvature: 1.0,
  /** amplitude do arco lateral, em fracao da corda */
  arcLateral: 0.22,
  /** casca de profundidade compartilhada, em BU */
  depthShell: 0.28,
  /** peso da orientacao FLOW (alinhamento com a tangente) */
  flowStrength: 0.75,
  /** respiracao do sistema inteiro (root) */
  rootMotion: 1.0,
  /** dolly da camera; converge para 1.0 em t = 1 */
  cameraDolly: 0.055,

  // --- microinteracao: ADITIVA, aplicada depois da pose da coreografia -----
  /** 'off' | 'idle' | 'idle+pointer' */
  interactionMode: 'idle+pointer',

  idleEnabled: true,
  idleAmount: 1.0,
  idleSpeed: 1.0,
  pieceFloat: 1.0,
  pieceRotation: 1.0,
  rootFloat: 1.0,
  /** peso do idle em t = 0; cresce por smootherstep ate 1.0 em t = 1 */
  assemblyFloor: 0.35,

  pointerEnabled: true,
  /** raio do campo de influencia, em unidades de meia-altura de tela (NDC) */
  influenceRadius: 0.55,
  /** deslocamento MAXIMO por peca, em BU */
  positionStrength: 0.018,
  depthStrength: 0.02,
  /** rotacao MAXIMA por peca, em graus */
  rotationStrength: 1.1,
  /** inclinacao do sistema inteiro, em graus */
  rootTilt: 0.35,
  pointerDamping: 6.0,
  showInfluence: false,

  // --- CIRCULAR FLOW: onda de orientacao percorrendo o anel das 14 pecas ----
  // Roda entre a coreografia e a microinteracao. Com flowEnabled = false o
  // resultado volta a ser numericamente identico a Organic.
  //
  // VALORES FINAIS APROVADOS VISUALMENTE em 2026-09-17 (Fase 2). Tres deles
  // ficaram fora das faixas sugeridas pela especificacao; a aprovacao visual
  // prevalece e o desvio fica registrado aqui para nao virar acidente:
  //   loopDuration 5.1 s  (a spec sugeria 6-9 s)
  //   depth        0.016  (a spec sugeria 0.008-0.015)
  //   radial       0.004  (a spec pedia comecar em 0)
  // `amount` = 1.240 multiplica tilt/depth/radial, entao as amplitudes
  // EFETIVAS em t = 1 sao 1.24x os numeros abaixo.
  flowEnabled: true,
  /** mestre do flow: multiplica tilt, depth e radial */
  flowAmount: 1.24,
  /** duracao de UMA volta completa da crista pelo anel, em segundos */
  flowLoopDuration: 5.1,
  /** rotacao MAXIMA por lamina, em graus (canal de pitch; yaw e roll sao fracoes) */
  flowTilt: 2.3,
  /** deslocamento MAXIMO em profundidade, em BU */
  flowDepth: 0.016,
  /** deslocamento MAXIMO radial, em BU */
  flowRadial: 0.004,
  /** peso do segundo harmonico, so para quebrar a perfeicao mecanica */
  flowHarmonic: 0.15,
  /** boost de contraste no fim da montagem; mexe so no grading, nunca no material */
  flowContrast: 1.0,
  /** peso do flow em t = 0; cresce ate 1.0 em t = 1 */
  flowAssemblyFloor: 0.2,
  /**
   * false = a onda anda no sentido do diagrama da especificacao
   * (T1→…→T7→B7→…→B1→T1). true inverte. Existe porque a secao 2 (setas) e a
   * secao 7 (formula `sin(theta + t)`) discordam entre si: o default segue o
   * diagrama, que e a parte explicita, e o toggle resolve no olho.
   */
  flowReverse: false,
  showFlowPhase: false,

  // camera
  fovDeg: CAMERA.fovDeg,
  autoFit: true,
  distance: CAMERA.distance,

  // render
  environment: true,
  envIntensity: 1.0,
  exposure: 1.0,
  /** tamanho das fontes emissivas; potencia conservada (highlight mais largo) */
  envSpread: 1.8,
  /** blur do PMREM (sigma) */
  envSoftness: 0.02,
};

/** dt maximo aceito pelo damping (protege contra aba em background). */
export const MAX_DELTA_TIME = 0.25;

/**
 * Comportamento em prefers-reduced-motion.
 *  'static' - trava no estado END (simbolo oficial montado), sem animacao
 *  'direct' - segue o scroll 1:1, apenas sem damping/inercia
 */
export const REDUCED_MOTION_MODE = 'static';
