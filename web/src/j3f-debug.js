/**
 * J3F - painel de debug (?debug).
 *
 * Nao existe em producao: main.js so importa e instancia quando a URL pede.
 * Todos os controles escrevem no mesmo objeto `params` que alimenta o loop, e
 * "reset baseline" volta exatamente para os valores de j3f-config.js.
 */

import { BASELINE } from './j3f-config.js';

const FMT = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '--');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class J3FDebugPanel {
  /**
   * @param {object} params objeto de parametros vivo, mutado in place
   * @param {(key: string, value: any) => void} onChange
   */
  constructor(params, onChange) {
    this.params = params;
    this.onChange = onChange ?? (() => {});
    this.controls = [];
    this.readouts = {};

    const root = el('aside', 'j3f-debug');
    root.setAttribute('aria-label', 'Painel de debug J3F');
    this.root = root;

    const header = el('header', 'j3f-debug__header');
    header.append(el('span', 'j3f-debug__title', 'J3F · debug'));
    const collapse = el('button', 'j3f-debug__collapse', '–');
    collapse.type = 'button';
    collapse.title = 'recolher / expandir';
    collapse.addEventListener('click', () => {
      root.classList.toggle('is-collapsed');
      collapse.textContent = root.classList.contains('is-collapsed') ? '+' : '–';
    });
    header.append(collapse);
    root.append(header);

    this.body = el('div', 'j3f-debug__body');
    root.append(this.body);

    this._buildMode();
    this._buildProgress();
    this._buildDamping();
    this._buildOrganic();
    this._buildSystem();
    this._buildBaselineAnimation();
    this._buildAmbient();
    this._buildPointer();
    this._buildCamera();
    this._buildRender();
    this._buildStatus();

    const reset = el('button', 'j3f-debug__reset', 'reset baseline');
    reset.type = 'button';
    reset.addEventListener('click', () => this.reset());
    this.body.append(reset);

    document.body.append(root);
  }

  // --- construcao ----------------------------------------------------------

  _section(title) {
    const section = el('section', 'j3f-debug__section');
    section.append(el('h2', 'j3f-debug__legend', title));
    this.body.append(section);
    return section;
  }

  _readout(parent, key, label) {
    const row = el('div', 'j3f-debug__readout');
    row.append(el('span', 'j3f-debug__label', label));
    const value = el('span', 'j3f-debug__value', '--');
    row.append(value);
    parent.append(row);
    this.readouts[key] = value;
  }

  _slider(parent, key, label, min, max, step) {
    const row = el('div', 'j3f-debug__row');
    const head = el('div', 'j3f-debug__rowhead');
    head.append(el('span', 'j3f-debug__label', label));
    const value = el('span', 'j3f-debug__value', FMT(this.params[key]));
    head.append(value);
    row.append(head);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = this.params[key];
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      this.params[key] = v;
      value.textContent = FMT(v);
      this.onChange(key, v);
    });
    row.append(input);
    parent.append(row);

    this.controls.push({
      key,
      sync: () => {
        input.value = this.params[key];
        value.textContent = FMT(this.params[key]);
      },
    });
    return input;
  }

  _select(parent, key, label, options) {
    const row = el('div', 'j3f-debug__row');
    const head = el('div', 'j3f-debug__rowhead');
    head.append(el('span', 'j3f-debug__label', label));
    row.append(head);

    const select = document.createElement('select');
    select.className = 'j3f-debug__select';
    select.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = this.params[key];
    select.addEventListener('change', () => {
      this.params[key] = select.value;
      this.onChange(key, select.value);
    });
    row.append(select);
    parent.append(row);

    this.controls.push({
      key,
      sync: () => {
        select.value = this.params[key];
      },
    });
    return select;
  }

  _toggle(parent, key, label) {
    const row = el('label', 'j3f-debug__toggle');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(this.params[key]);
    input.addEventListener('change', () => {
      this.params[key] = input.checked;
      this.onChange(key, input.checked);
    });
    row.append(input, el('span', 'j3f-debug__label', label));
    parent.append(row);

    this.controls.push({
      key,
      sync: () => {
        input.checked = Boolean(this.params[key]);
      },
    });
    return input;
  }

  _buildMode() {
    const s = this._section('animation mode');
    this._select(s, 'mode', 'modo', [
      ['organic', 'Organic (experimental)'],
      ['baseline', 'Baseline (aprovado)'],
    ]);
    s.append(
      el('p', 'j3f-debug__note', 'Baseline = exatamente a coreografia da Fase Blender'),
    );
  }

  _buildProgress() {
    const s = this._section('progresso');
    this._readout(s, 'raw', 'raw scroll');
    this._readout(s, 'damped', 'damped');
    this._readout(s, 'pLead', 'p final · lead (T4)');
    this._readout(s, 'pTail', 'p final · tail (B1/B7)');
    this._readout(s, 'pMean', 'p final · média');
    this._readout(s, 'phase', 'estágio');

    this._toggle(s, 'manualOverride', 'slider manual');
    this._slider(s, 'manualT', 't manual', 0, 1, 0.001);

    const presets = el('div', 'j3f-debug__presets');
    for (const pct of [0, 25, 50, 75, 100]) {
      const b = el('button', 'j3f-debug__preset', `${pct}%`);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.params.manualOverride = true;
        this.params.manualT = pct / 100;
        this.sync();
        this.onChange('manualT', this.params.manualT);
      });
      presets.append(b);
    }
    s.append(presets);
  }

  _buildDamping() {
    const s = this._section('damping');
    this._toggle(s, 'dampingEnabled', 'damping ligado (raw vs smooth)');
    this._slider(s, 'lambda', 'lambda (1/s)', 0.5, 30, 0.1);
    s.append(
      el(
        'p',
        'j3f-debug__note',
        'alpha = 1 − exp(−lambda · dt) · independente de frame rate',
      ),
    );
  }

  _buildOrganic() {
    const s = this._section('organic · coreografia');
    this._slider(s, 'organicStagger', 'organicStagger', 0.02, 0.6, 0.005);
    this._slider(s, 'rotationMultiplier', 'rotationMultiplier', 0, 1.2, 0.01);
    this._slider(s, 'scaleVariationMultiplier', 'scaleVariationMultiplier', 0, 1.2, 0.01);
    this._slider(s, 'curvature', 'curvature (mestre)', 0, 2, 0.01);
    this._slider(s, 'arcLateral', 'arco lateral', 0, 0.6, 0.005);
    this._slider(s, 'depthShell', 'casca de profundidade', 0, 1, 0.005);
    this._slider(s, 'flowStrength', 'flowStrength (rotação↔tangente)', 0, 1, 0.01);
    s.append(
      el('p', 'j3f-debug__note', 'só afeta o START e o meio do caminho; END é intocável'),
    );
  }

  _buildSystem() {
    const s = this._section('organic · sistema');
    this._slider(s, 'rootMotion', 'rootMotion', 0, 2, 0.01);
    this._slider(s, 'cameraDolly', 'cameraDolly', 0, 0.2, 0.001);
    s.append(el('p', 'j3f-debug__note', 'ambos convergem exatamente para o baseline em t = 1'));
  }

  _buildBaselineAnimation() {
    const s = this._section('baseline · coreografia');
    this._slider(s, 'maxDelay', 'stagger max', 0, 0.95, 0.005);
    this._slider(s, 'rotationMul', 'rotation ×', 0, 2, 0.01);
    this._slider(s, 'positionMul', 'position × (X/Y)', 0, 2, 0.01);
    this._slider(s, 'depthMul', 'depth × (Z)', 0, 2, 0.01);
    this._slider(s, 'scaleMul', 'scale ×', 0, 2, 0.01);
  }

  _buildAmbient() {
    const s = this._section('ambient motion');
    this._select(s, 'interactionMode', 'interaction mode', [
      ['idle+pointer', 'Idle + Pointer'],
      ['idle', 'Idle'],
      ['off', 'Off'],
    ]);
    this._toggle(s, 'idleEnabled', 'idle enabled');
    this._slider(s, 'idleAmount', 'idle amount', 0, 3, 0.01);
    this._slider(s, 'idleSpeed', 'idle speed', 0.1, 4, 0.01);
    this._slider(s, 'pieceFloat', 'piece float', 0, 4, 0.01);
    this._slider(s, 'pieceRotation', 'piece rotation', 0, 4, 0.01);
    this._slider(s, 'rootFloat', 'root float', 0, 4, 0.01);
    this._slider(s, 'assemblyFloor', 'assembly weight (piso em t=0)', 0, 1, 0.01);
    s.append(
      el('p', 'j3f-debug__note', 'aditivo sobre a pose da coreografia · com tudo em 0 volta a ser a Organic exata'),
    );
  }

  _buildPointer() {
    const s = this._section('pointer interaction');
    this._toggle(s, 'pointerEnabled', 'pointer enabled');
    this._slider(s, 'influenceRadius', 'influence radius (NDC)', 0.1, 1.5, 0.01);
    this._slider(s, 'positionStrength', 'position strength (BU)', 0, 0.05, 0.001);
    this._slider(s, 'depthStrength', 'depth strength (BU)', 0, 0.05, 0.001);
    this._slider(s, 'rotationStrength', 'rotation strength (°)', 0, 3, 0.05);
    this._slider(s, 'rootTilt', 'root tilt (°)', 0, 2, 0.01);
    this._slider(s, 'pointerDamping', 'pointer damping (λ)', 0.5, 20, 0.1);
    this._toggle(s, 'showInfluence', 'show influence debug');
    this._readout(s, 'pointerState', 'ponteiro');
    s.append(
      el('p', 'j3f-debug__note', 'só em (hover: hover) and (pointer: fine) · os sliders são o valor MÁXIMO'),
    );
  }

  _buildCamera() {
    const s = this._section('câmera');
    this._toggle(s, 'autoFit', 'auto-fit (responsivo)');
    this._slider(s, 'fovDeg', 'FOV vertical (°)', 8, 60, 0.1);
    this._slider(s, 'distance', 'distância (BU)', 2, 24, 0.01);
    this._readout(s, 'framing', 'símbolo / altura');
  }

  _buildRender() {
    const s = this._section('render');
    this._toggle(s, 'environment', 'environment (PMREM)');
    this._slider(s, 'envIntensity', 'env intensity', 0, 4, 0.01);
    this._slider(s, 'exposure', 'exposure', 0.05, 3, 0.01);
    this._slider(s, 'envSpread', 'largura das fontes', 0.4, 3, 0.05);
    this._slider(s, 'envSoftness', 'softness (PMREM σ)', 0, 0.12, 0.002);
    s.append(
      el('p', 'j3f-debug__note', 'largura conserva a potência: highlight mais largo, não mais forte'),
    );
  }

  _buildStatus() {
    const s = this._section('status');
    this._readout(s, 'nodes', 'nós associados');
    this._readout(s, 'endError', 'erro END · baseline');
    this._readout(s, 'endErrorOrganic', 'erro END · organic');
    this._readout(s, 'scaleRange', 'escala START efetiva');
    this._readout(s, 'fps', 'fps');
    this._readout(s, 'capabilities', 'hover / reduced');
    this._readout(s, 'viewport', 'viewport');
  }

  // --- overlay de influencia -----------------------------------------------

  setInfluenceVisible(visible) {
    if (visible && !this.influence) {
      const layer = el('div', 'j3f-influence');
      layer.setAttribute('aria-hidden', 'true');
      const ring = el('div', 'j3f-influence__ring');
      layer.append(ring);
      this.influenceDots = [];
      for (let i = 0; i < 14; i++) {
        const dot = el('div', 'j3f-influence__dot');
        layer.append(dot);
        this.influenceDots.push(dot);
      }
      document.body.append(layer);
      this.influence = layer;
      this.influenceRing = ring;
    }
    if (this.influence) this.influence.style.display = visible ? 'block' : 'none';
  }

  /** Marcadores em screen space: um por peça, escalados pela influência. */
  updateInfluence(interaction) {
    if (!this.influence) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toX = (ndc) => ((ndc + 1) / 2) * w;
    const toY = (ndc) => ((1 - ndc) / 2) * h;

    const radiusPx = (this.params.influenceRadius / 2) * h;
    this.influenceRing.style.width = `${radiusPx * 2}px`;
    this.influenceRing.style.height = `${radiusPx * 2}px`;
    this.influenceRing.style.transform =
      `translate(${toX(interaction.damped.x) - radiusPx}px, ${toY(interaction.damped.y) - radiusPx}px)`;
    this.influenceRing.style.opacity = interaction.damped.activation.toFixed(3);

    for (let i = 0; i < this.influenceDots.length; i++) {
      const b = interaction.readout[i];
      const dot = this.influenceDots[i];
      if (!b) {
        dot.style.display = 'none';
        continue;
      }
      const size = 5 + b.influence * 22;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.transform = `translate(${toX(b.ndcX) - size / 2}px, ${toY(b.ndcY) - size / 2}px)`;
      dot.style.opacity = (0.18 + b.influence * 0.82).toFixed(3);
    }
  }

  // --- uso -----------------------------------------------------------------

  /** Reescreve os controles a partir de `params` (apos reset/preset). */
  sync() {
    for (const control of this.controls) control.sync();
  }

  /** Volta aos valores de BASELINE, preservando o modo em comparação. */
  reset() {
    const mode = this.params.mode;
    Object.assign(this.params, BASELINE, { mode, manualOverride: false, manualT: 0 });
    this.sync();
    this.onChange('*', null);
  }

  /** @param {Record<string, string|number>} values */
  update(values) {
    for (const [key, value] of Object.entries(values)) {
      const node = this.readouts[key];
      if (node) node.textContent = typeof value === 'number' ? FMT(value) : value;
    }
  }
}
