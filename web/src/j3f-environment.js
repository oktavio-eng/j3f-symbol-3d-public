/**
 * J3F - environment autoral para o metal.
 *
 * O GLB carrega metallic 1.0: sem ambiente, o material renderiza preto. A
 * iluminacao do Blender (world gradiente + 7 area lights) nao vai no glTF,
 * entao ela e reconstruida aqui e assada em PMREM.
 *
 * Nada de terceiros: nenhum HDRI, textura ou asset externo. O estudio e
 * geometria + shader, com os mesmos numeros de scripts/03_materials.py.
 *
 * As proporcoes entre as luzes vem da fisica do Cycles (L = P / (A * pi)), o
 * que mantem a leitura relativa do baseline. A escala absoluta se ajusta por
 * envIntensity / exposure - nunca mexendo no material do GLB.
 *
 * DOIS CONTROLES DE LARGURA DO REFLEXO (o material do GLB nao e tocado):
 *
 *  - `spread`   aumenta o TAMANHO das fontes emissivas. A radiancia cai com o
 *               quadrado do fator, entao a potencia total e conservada: o
 *               highlight fica mais largo e mais gradual, nao mais forte.
 *  - `softness` borra o PMREM (sigma). Tira o degrau que sobra na borda.
 *
 * Alem disso os paineis nao sao chapados: tem queda radial suave. E o que
 * troca "preto -> branco" por "dark -> midtone -> broad highlight -> midtone".
 */

import {
  BackSide,
  Color,
  LinearSRGBColorSpace,
  Mesh,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

import { LIGHTS, WORLD_RAMP, lightRadiance } from './j3f-config.js';

const DOME_RADIUS = 60;

const DOME_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// ColorRamp EASE do Blender: smoothstep entre as paradas adjacentes.
const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uPos;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  varying vec3 vWorldPos;

  void main() {
    // Generated.Z do world do Blender = componente "para cima" da direcao de
    // visada. Em Y-up isso e o Y.
    float f = clamp(normalize(vWorldPos - cameraPosition).y, 0.0, 1.0);

    vec3 c;
    if (f <= uPos.x) {
      c = uC0;
    } else if (f >= uPos.z) {
      c = uC2;
    } else if (f < uPos.y) {
      float u = (f - uPos.x) / (uPos.y - uPos.x);
      u = u * u * (3.0 - 2.0 * u);
      c = mix(uC0, uC1, u);
    } else {
      float u = (f - uPos.y) / (uPos.z - uPos.y);
      u = u * u * (3.0 - 2.0 * u);
      c = mix(uC1, uC2, u);
    }

    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const PANEL_VERTEX = /* glsl */ `
  varying vec2 vQ;
  void main() {
    vQ = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Softbox de borda macia: queda radial em vez de retangulo chapado.
const PANEL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uEdge;
  varying vec2 vQ;

  void main() {
    float r = length(vQ);
    float f = 1.0 - smoothstep(1.0 - uEdge, 1.0, r);
    gl_FragColor = vec4(uColor * f, 1.0);
  }
`;

/** Largura da transicao da borda do softbox, em fracao do raio. */
const PANEL_EDGE = 0.55;

/**
 * Media da queda radial sobre o quad, calculada uma vez. Serve para dividir a
 * radiancia e conservar a potencia total: o painel macio emite o mesmo que o
 * painel chapado equivalente, so que distribuido de forma gradual.
 */
const PANEL_FALLOFF_MEAN = (() => {
  const N = 128;
  let sum = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1;
      const y = ((j + 0.5) / N) * 2 - 1;
      const r = Math.hypot(x, y);
      const e = PANEL_EDGE;
      const a = 1 - e;
      let s;
      if (r <= a) s = 0;
      else if (r >= 1) s = 1;
      else {
        const u = (r - a) / e;
        s = u * u * (3 - 2 * u);
      }
      sum += 1 - s;
    }
  }
  return sum / (N * N);
})();

function rampUniforms() {
  const [s0, s1, s2] = WORLD_RAMP.stops;
  return {
    uPos: { value: new Vector3(s0.pos, s1.pos, s2.pos) },
    uC0: { value: new Color().setRGB(...s0.color, LinearSRGBColorSpace) },
    uC1: { value: new Color().setRGB(...s1.color, LinearSRGBColorSpace) },
    uC2: { value: new Color().setRGB(...s2.color, LinearSRGBColorSpace) },
  };
}

/**
 * Domo com o gradiente vertical do world do Blender.
 * @param {boolean} toneMapped false para a cena de environment (cena linear),
 *                             true para o fundo visivel da cena principal.
 */
export function createGradientDome({ toneMapped }) {
  const material = new ShaderMaterial({
    uniforms: rampUniforms(),
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    toneMapped,
  });
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 64, 32), material);
  dome.name = 'J3F_World_Dome';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  return dome;
}

/** Blender Z-up -> glTF/Three Y-up: (x, z, -y). */
function toYUp([x, y, z]) {
  return [x, z, -y];
}

/** As 7 area lights como softboxes apontados para a origem. */
function createLightPanels(spread) {
  return LIGHTS.map((light) => {
    const sx = light.size * spread;
    const sy = (light.sizeY ?? light.size) * spread;
    // L = P / (A * pi), com A ja aumentada pelo spread -> potencia conservada.
    // A divisao por PANEL_FALLOFF_MEAN compensa a queda radial.
    const radiance =
      lightRadiance({ ...light, size: sx, sizeY: sy }) / PANEL_FALLOFF_MEAN;

    const material = new ShaderMaterial({
      uniforms: {
        uColor: {
          value: new Color().setRGB(
            light.color[0] * radiance,
            light.color[1] * radiance,
            light.color[2] * radiance,
            LinearSRGBColorSpace,
          ),
        },
        uEdge: { value: PANEL_EDGE },
      },
      vertexShader: PANEL_VERTEX,
      fragmentShader: PANEL_FRAGMENT,
      toneMapped: false,
    });

    const panel = new Mesh(new PlaneGeometry(sx, sy), material);
    panel.name = light.name;
    panel.position.set(...toYUp(light.loc));
    panel.lookAt(0, 0, 0); // TRACK_TO do Blender
    return panel;
  });
}

/**
 * Monta a cena de estudio e assa em PMREM.
 * @param {import('three').WebGLRenderer} renderer
 * @param {{spread?: number, softness?: number}} options
 */
export function createEnvironment(renderer, options = {}) {
  const spread = Math.max(options.spread ?? 1, 0.1);
  const softness = Math.max(options.softness ?? 0, 0);

  const envScene = new Scene();
  const dome = createGradientDome({ toneMapped: false });
  envScene.add(dome);

  const panels = createLightPanels(spread);
  for (const panel of panels) envScene.add(panel);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, softness, 0.1, DOME_RADIUS * 2);
  pmrem.dispose();

  const dispose = () => {
    target.dispose();
    dome.geometry.dispose();
    dome.material.dispose();
    for (const panel of panels) {
      panel.geometry.dispose();
      panel.material.dispose();
    }
  };

  return { texture: target.texture, dispose, lights: panels.length, spread, softness };
}
