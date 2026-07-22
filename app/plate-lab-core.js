/*
 * Signal Field Plate Lab
 *
 * A dependency-free Kirchhoff–Love rectangular thin-plate core.  The
 * simply-supported branch uses the analytic sine basis.  The clamped branch
 * is deliberately labelled "clamped-approx": it is a separable product of
 * clamped-clamped beam modes, useful for visual exploration but not an exact
 * 2D clamped-plate eigenvalue solution.
 */
(function exposePlateLabCore(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PlateLabCore = api;
  else if (typeof globalThis !== 'undefined') globalThis.PlateLabCore = api;
}(function createPlateLabCore() {
  'use strict';

  const VERSION = 1;
  const KIND = 'signal-field-plate-lab';
  const MAX_MODE_COUNT = 24;
  const MAX_GRID_SIDE = 256;
  const PI = Math.PI;
  const TWO_PI = PI * 2;

  const MATERIALS = Object.freeze({
    steel: Object.freeze({ name: 'steel', density: 7850, youngModulus: 200e9, poissonRatio: 0.29 }),
    aluminum: Object.freeze({ name: 'aluminum', density: 2700, youngModulus: 69e9, poissonRatio: 0.33 }),
    glass: Object.freeze({ name: 'glass', density: 2500, youngModulus: 70e9, poissonRatio: 0.22 }),
    acrylic: Object.freeze({ name: 'acrylic', density: 1180, youngModulus: 3.2e9, poissonRatio: 0.35 })
  });

  // βL roots for a clamped-clamped Euler–Bernoulli beam: cosh(β)cos(β)=1.
  // They are used only for the clearly-marked separable 2D approximation.
  const CLAMPED_BEAM_ROOTS = Object.freeze([
    4.730040744862704, 7.853204624095838, 10.99560783800167,
    14.137165491257, 17.278759657399, 20.420352251041,
    23.561944901923, 26.703537555518, 29.845130209103,
    32.986722862693, 36.128315516283, 39.269908169872
  ]);
  const clampedShapeNormalization = [];
  const clampedShapeIntegral = [];

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function freezeObject(value) {
    // Typed-array elements cannot be frozen in several supported JS engines.
    // They are freshly allocated output and never retained by module state.
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) value.forEach(freezeObject);
    else if (isPlainObject(value)) Object.keys(value).forEach(function freezeKey(key) { freezeObject(value[key]); });
    return Object.freeze(value);
  }

  function finiteNumber(value, name, minimum, maximum) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(name + ' must be a finite number.');
    }
    if (minimum != null && value < minimum) throw new RangeError(name + ' must be at least ' + minimum + '.');
    if (maximum != null && value > maximum) throw new RangeError(name + ' must be at most ' + maximum + '.');
    return value;
  }

  function integer(value, name, minimum, maximum) {
    const number = finiteNumber(value, name, minimum, maximum);
    if (!Number.isInteger(number)) throw new TypeError(name + ' must be an integer.');
    return number;
  }

  function boundedUnit(value, name) {
    return finiteNumber(value, name, 0, 1);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function rejectUnknownKeys(object, allowed, label) {
    Object.keys(object).forEach(function checkKey(key) {
      if (allowed.indexOf(key) === -1) throw new TypeError(label + ' has an unsupported property: ' + key + '.');
    });
  }

  function normalizePoint(value, name) {
    const point = value == null ? { x: 0.5, y: 0.5 } : value;
    if (!isPlainObject(point)) throw new TypeError(name + ' must be an object with normalized x and y coordinates.');
    rejectUnknownKeys(point, ['x', 'y'], name);
    if (!own(point, 'x') || !own(point, 'y')) throw new TypeError(name + ' needs both x and y.');
    return freezeObject({ x: boundedUnit(point.x, name + '.x'), y: boundedUnit(point.y, name + '.y') });
  }

  /**
   * Normalizes input without mutating it. All geometry uses metres, material
   * values use SI units, and excitation coordinates are normalized [0, 1].
   */
  function normalizeConfig(input) {
    const source = input == null ? {} : input;
    if (!isPlainObject(source)) throw new TypeError('Plate configuration must be an object.');
    rejectUnknownKeys(source, [
      'material', 'boundary', 'width', 'height', 'thickness', 'density',
      'youngModulus', 'poissonRatio', 'dampingRatio', 'excitationPoint', 'modeCount'
    ], 'Plate configuration');

    const materialName = own(source, 'material') ? source.material : 'steel';
    if (typeof materialName !== 'string' || (!own(MATERIALS, materialName) && materialName !== 'custom')) {
      throw new RangeError('material must be one of steel, aluminum, glass, acrylic, or custom.');
    }
    const boundary = own(source, 'boundary') ? source.boundary : 'simply-supported';
    if (boundary !== 'simply-supported' && boundary !== 'clamped-approx') {
      throw new RangeError('boundary must be simply-supported or clamped-approx.');
    }

    const width = own(source, 'width') ? finiteNumber(source.width, 'width', 0.01, 10) : 0.3;
    const height = own(source, 'height') ? finiteNumber(source.height, 'height', 0.01, 10) : 0.3;
    const thickness = own(source, 'thickness') ? finiteNumber(source.thickness, 'thickness', 0.00001, 0.1) : 0.001;
    if (thickness / Math.min(width, height) > 0.1) {
      throw new RangeError('thickness is too large for a Kirchhoff–Love thin-plate approximation.');
    }
    if (Math.max(width / height, height / width) > 5) {
      throw new RangeError('width/height aspect ratio must be at most 5 for this bounded modal approximation.');
    }

    const dampingRatio = own(source, 'dampingRatio')
      ? finiteNumber(source.dampingRatio, 'dampingRatio', 0, 0.3)
      : 0.012;
    const modeCount = own(source, 'modeCount')
      ? integer(source.modeCount, 'modeCount', 1, MAX_MODE_COUNT)
      : 12;

    let material;
    if (materialName === 'custom') {
      ['density', 'youngModulus', 'poissonRatio'].forEach(function requireCustom(key) {
        if (!own(source, key)) throw new TypeError('custom material requires ' + key + '.');
      });
      material = {
        name: 'custom',
        density: finiteNumber(source.density, 'density', 100, 30000),
        youngModulus: finiteNumber(source.youngModulus, 'youngModulus', 1e6, 1e13),
        poissonRatio: finiteNumber(source.poissonRatio, 'poissonRatio', -0.99, 0.49)
      };
    } else {
      ['density', 'youngModulus', 'poissonRatio'].forEach(function rejectPresetOverride(key) {
        if (own(source, key)) throw new TypeError(key + ' can only be supplied when material is custom.');
      });
      material = MATERIALS[materialName];
    }

    return freezeObject({
      material: material.name,
      boundary: boundary,
      width: width,
      height: height,
      thickness: thickness,
      density: material.density,
      youngModulus: material.youngModulus,
      poissonRatio: material.poissonRatio,
      dampingRatio: dampingRatio,
      excitationPoint: normalizePoint(source.excitationPoint, 'excitationPoint'),
      modeCount: modeCount,
      units: freezeObject({ length: 'm', density: 'kg/m^3', youngModulus: 'Pa', frequency: 'Hz' })
    });
  }

  function flexuralRigidity(config) {
    return config.youngModulus * Math.pow(config.thickness, 3) / (12 * (1 - Math.pow(config.poissonRatio, 2)));
  }

  function clampedRoot(index) {
    if (index < 1 || index > CLAMPED_BEAM_ROOTS.length) {
      throw new RangeError('clamped-approx supports modal indices 1 through ' + CLAMPED_BEAM_ROOTS.length + '.');
    }
    return CLAMPED_BEAM_ROOTS[index - 1];
  }

  function rawClampedBeam(index, coordinate) {
    const beta = clampedRoot(index);
    const ratio = (Math.cosh(beta) - Math.cos(beta)) / (Math.sinh(beta) - Math.sin(beta));
    const b = beta * coordinate;
    return Math.cosh(b) - Math.cos(b) - ratio * (Math.sinh(b) - Math.sin(b));
  }

  function clampedBeamNormalization(index) {
    if (clampedShapeNormalization[index]) return clampedShapeNormalization[index];
    let peak = 0;
    const divisions = 1024;
    for (let step = 0; step <= divisions; step += 1) {
      peak = Math.max(peak, Math.abs(rawClampedBeam(index, step / divisions)));
    }
    if (!(peak > 0) || !Number.isFinite(peak)) throw new RangeError('Could not normalize clamped-approx mode ' + index + '.');
    clampedShapeNormalization[index] = peak;
    return peak;
  }

  function clampedBeamShape(index, coordinate) {
    if (coordinate === 0 || coordinate === 1) return 0;
    return rawClampedBeam(index, coordinate) / clampedBeamNormalization(index);
  }

  function clampedBeamIntegral(index) {
    if (clampedShapeIntegral[index]) return clampedShapeIntegral[index];
    const divisions = 1024; // even count required by Simpson's rule
    let sum = 0;
    for (let step = 0; step <= divisions; step += 1) {
      const value = clampedBeamShape(index, step / divisions);
      const coefficient = step === 0 || step === divisions ? 1 : (step % 2 === 0 ? 2 : 4);
      sum += coefficient * value * value;
    }
    const integral = sum / (3 * divisions);
    if (!(integral > 0) || !Number.isFinite(integral)) throw new RangeError('Could not integrate clamped-approx mode ' + index + '.');
    clampedShapeIntegral[index] = integral;
    return integral;
  }

  function shapeAtConfig(config, m, n, point) {
    if (config.boundary === 'simply-supported') {
      return Math.sin(m * PI * point.x) * Math.sin(n * PI * point.y);
    }
    return clampedBeamShape(m, point.x) * clampedBeamShape(n, point.y);
  }

  function modalMassFor(config, m, n) {
    const area = config.width * config.height;
    const shapeIntegral = config.boundary === 'simply-supported'
      ? 0.25
      : clampedBeamIntegral(m) * clampedBeamIntegral(n);
    return config.density * config.thickness * area * shapeIntegral;
  }

  function candidateLimit(config) {
    const aspect = Math.max(config.width / config.height, config.height / config.width);
    const raw = Math.ceil(Math.sqrt(config.modeCount * 2) * aspect + 3);
    const cap = config.boundary === 'clamped-approx' ? CLAMPED_BEAM_ROOTS.length : 24;
    return Math.max(6, Math.min(cap, raw));
  }

  function computeModes(config, mechanics) {
    const limit = candidateLimit(config);
    const modes = [];
    const speed = Math.sqrt(mechanics.flexuralRigidity / mechanics.massPerArea);
    for (let m = 1; m <= limit; m += 1) {
      for (let n = 1; n <= limit; n += 1) {
        const kx = config.boundary === 'simply-supported' ? m * PI / config.width : clampedRoot(m) / config.width;
        const ky = config.boundary === 'simply-supported' ? n * PI / config.height : clampedRoot(n) / config.height;
        const angularFrequency = speed * (kx * kx + ky * ky);
        const coupling = shapeAtConfig(config, m, n, config.excitationPoint);
        modes.push({
          m: m,
          n: n,
          kx: kx,
          ky: ky,
          angularFrequency: angularFrequency,
          frequencyHz: angularFrequency / TWO_PI,
          coupling: coupling,
          couplingMagnitude: Math.abs(coupling),
          modalMass: modalMassFor(config, m, n),
          dampingRatio: config.dampingRatio
        });
      }
    }
    modes.sort(function sortModes(left, right) {
      return left.frequencyHz - right.frequencyHz || left.m - right.m || left.n - right.n;
    });
    return modes.slice(0, config.modeCount).map(function sealMode(mode, index) {
      return freezeObject(Object.assign({ index: index }, mode));
    });
  }

  function createPlateLab(input) {
    const config = normalizeConfig(input);
    const area = config.width * config.height;
    const massPerArea = config.density * config.thickness;
    const mechanics = freezeObject({
      flexuralRigidity: flexuralRigidity(config),
      massPerArea: massPerArea,
      area: area,
      totalMass: area * massPerArea,
      thinnessRatio: config.thickness / Math.min(config.width, config.height),
      governingModel: 'Kirchhoff–Love thin plate',
      boundaryNote: config.boundary === 'clamped-approx'
        ? 'Approximate: separable clamped-clamped beam basis, not an exact 2D clamped plate eigenproblem.'
        : 'Analytic simply-supported rectangular Kirchhoff–Love basis.'
    });
    const modes = computeModes(config, mechanics);
    return freezeObject({
      schemaVersion: VERSION,
      kind: KIND,
      config: config,
      mechanics: mechanics,
      modes: modes
    });
  }

  function assertPlateLab(lab) {
    if (!isPlainObject(lab) || lab.kind !== KIND || lab.schemaVersion !== VERSION || !Array.isArray(lab.modes)) {
      throw new TypeError('Expected a PlateLabCore plate created by createPlateLab().');
    }
    return lab;
  }

  function resolveMode(lab, selector) {
    assertPlateLab(lab);
    if (selector == null) return lab.modes[0];
    if (typeof selector === 'number') {
      const index = integer(selector, 'mode index', 0, lab.modes.length - 1);
      return lab.modes[index];
    }
    if (!isPlainObject(selector)) throw new TypeError('mode selector must be an index or { m, n }.');
    rejectUnknownKeys(selector, ['m', 'n'], 'mode selector');
    const m = integer(selector.m, 'mode selector.m', 1, 24);
    const n = integer(selector.n, 'mode selector.n', 1, 24);
    const found = lab.modes.find(function matchMode(mode) { return mode.m === m && mode.n === n; });
    if (!found) throw new RangeError('Requested mode (' + m + ',' + n + ') is not in this plate lab.');
    return found;
  }

  function modeShape(lab, selector, point) {
    const plate = assertPlateLab(lab);
    const mode = resolveMode(plate, selector);
    return shapeAtConfig(plate.config, mode.m, mode.n, normalizePoint(point, 'point'));
  }

  function sampleModeGrid(lab, selector, options) {
    const plate = assertPlateLab(lab);
    const mode = resolveMode(plate, selector);
    const settings = options == null ? {} : options;
    if (!isPlainObject(settings)) throw new TypeError('grid options must be an object.');
    rejectUnknownKeys(settings, ['columns', 'rows', 'nodeWidth'], 'grid options');
    const columns = own(settings, 'columns') ? integer(settings.columns, 'columns', 2, MAX_GRID_SIDE) : 64;
    const rows = own(settings, 'rows') ? integer(settings.rows, 'rows', 2, MAX_GRID_SIDE) : 64;
    const nodeWidth = own(settings, 'nodeWidth') ? finiteNumber(settings.nodeWidth, 'nodeWidth', 0.001, 0.5) : 0.075;
    const values = new Float32Array(columns * rows);
    const nodeIntensity = new Float32Array(columns * rows);
    let peak = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = column / (columns - 1);
        const y = row / (rows - 1);
        const value = shapeAtConfig(plate.config, mode.m, mode.n, { x: x, y: y });
        const index = row * columns + column;
        values[index] = value;
        peak = Math.max(peak, Math.abs(value));
      }
    }
    const normalization = peak || 1;
    for (let index = 0; index < values.length; index += 1) {
      const normalized = Math.abs(values[index]) / normalization;
      // Gaussian node band: 1 at a displacement node, smoothly lower away from it.
      nodeIntensity[index] = Math.exp(-0.5 * Math.pow(normalized / nodeWidth, 2));
    }
    return freezeObject({
      mode: mode,
      columns: columns,
      rows: rows,
      nodeWidth: nodeWidth,
      values: values,
      nodeIntensity: nodeIntensity,
      interpretation: 'Signed normalized displacement and visual node-band intensity; not a granular-contact simulation.'
    });
  }

  function frequencyResponse(lab, frequencyHz, options) {
    const plate = assertPlateLab(lab);
    const frequency = finiteNumber(frequencyHz, 'frequencyHz', 0, 200000);
    const settings = options == null ? {} : options;
    if (!isPlainObject(settings)) throw new TypeError('frequency response options must be an object.');
    rejectUnknownKeys(settings, ['observationPoint', 'forceNewtons', 'modeCount'], 'frequency response options');
    const observationPoint = normalizePoint(settings.observationPoint || plate.config.excitationPoint, 'observationPoint');
    const forceNewtons = own(settings, 'forceNewtons') ? finiteNumber(settings.forceNewtons, 'forceNewtons', -1e6, 1e6) : 1;
    const modeCount = own(settings, 'modeCount')
      ? integer(settings.modeCount, 'modeCount', 1, plate.modes.length)
      : plate.modes.length;
    const omega = TWO_PI * frequency;
    let real = 0;
    let imaginary = 0;
    let dominant = null;
    let dominantMagnitude = -1;
    const contributions = [];

    for (let index = 0; index < modeCount; index += 1) {
      const mode = plate.modes[index];
      const observationCoupling = shapeAtConfig(plate.config, mode.m, mode.n, observationPoint);
      const numerator = forceNewtons * mode.coupling * observationCoupling;
      const denominatorReal = mode.modalMass * (mode.angularFrequency * mode.angularFrequency - omega * omega);
      const denominatorImaginary = mode.modalMass * (2 * mode.dampingRatio * mode.angularFrequency * omega);
      const denominatorMagnitudeSquared = denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary;
      const contributionReal = numerator * denominatorReal / denominatorMagnitudeSquared;
      const contributionImaginary = -numerator * denominatorImaginary / denominatorMagnitudeSquared;
      const magnitude = Math.hypot(contributionReal, contributionImaginary);
      real += contributionReal;
      imaginary += contributionImaginary;
      const contribution = freezeObject({
        mode: mode,
        real: contributionReal,
        imaginary: contributionImaginary,
        magnitude: magnitude
      });
      contributions.push(contribution);
      if (magnitude > dominantMagnitude) {
        dominantMagnitude = magnitude;
        dominant = mode;
      }
    }
    return freezeObject({
      frequencyHz: frequency,
      forceNewtons: forceNewtons,
      observationPoint: observationPoint,
      real: real,
      imaginary: imaginary,
      magnitude: Math.hypot(real, imaginary),
      phaseRadians: Math.atan2(imaginary, real),
      dominantMode: dominant,
      contributions: contributions,
      units: 'm/N (linear modal compliance approximation)'
    });
  }

  function sampleFrequencyResponse(lab, options) {
    const plate = assertPlateLab(lab);
    const settings = options == null ? {} : options;
    if (!isPlainObject(settings)) throw new TypeError('frequency sweep options must be an object.');
    rejectUnknownKeys(settings, ['fromHz', 'toHz', 'steps', 'observationPoint', 'forceNewtons', 'modeCount'], 'frequency sweep options');
    const fromHz = finiteNumber(settings.fromHz, 'fromHz', 0, 200000);
    const toHz = finiteNumber(settings.toHz, 'toHz', fromHz + Number.EPSILON, 200000);
    if (!(toHz > fromHz)) throw new RangeError('toHz must be greater than fromHz.');
    const steps = integer(settings.steps, 'steps', 2, 4096);
    const responseOptions = {};
    ['observationPoint', 'forceNewtons', 'modeCount'].forEach(function copyOption(key) {
      if (own(settings, key)) responseOptions[key] = settings[key];
    });
    const samples = [];
    for (let index = 0; index < steps; index += 1) {
      const frequency = fromHz + (toHz - fromHz) * index / (steps - 1);
      samples.push(frequencyResponse(plate, frequency, responseOptions));
    }
    return freezeObject({ fromHz: fromHz, toHz: toHz, steps: steps, samples: samples });
  }

  /**
   * Creates a declarative, whitelisted adapter recipe for the existing
   * soundMotionNative surface. It does not execute native calls and does not
   * represent a physical granular-contact simulation.
   */
  function createSoundMotionNativeRecipe(lab, options) {
    const plate = assertPlateLab(lab);
    const settings = options == null ? {} : options;
    if (!isPlainObject(settings)) throw new TypeError('particle recipe options must be an object.');
    rejectUnknownKeys(settings, ['mode', 'style', 'nodeWidth'], 'particle recipe options');
    const mode = resolveMode(plate, settings.mode);
    const style = own(settings, 'style') ? settings.style : 'msand';
    if (['sand', 'msand', 'cosmic', 'dcosmic'].indexOf(style) === -1) {
      throw new RangeError('style must be sand, msand, cosmic, or dcosmic.');
    }
    const nodeWidth = own(settings, 'nodeWidth') ? finiteNumber(settings.nodeWidth, 'nodeWidth', 0.001, 0.5) : 0.075;
    const normalizedRank = plate.modes.length <= 1 ? 0 : mode.index / (plate.modes.length - 1);
    const detail = Number(clamp(0.75 + normalizedRank * 0.65, 0.5, 1.6).toFixed(3));
    const goal = Number(clamp(1.1 + normalizedRank * 7.2, 0.5, 10).toFixed(3));
    const excitation = plate.config.excitationPoint;
    const pattern = freezeObject({
      style: style,
      goal: goal,
      ex: freezeObject([
        Number((0.16 + excitation.x * 0.68).toFixed(3)),
        Number((0.16 + excitation.y * 0.68).toFixed(3)),
        Number((0.35 + 0.3 * mode.couplingMagnitude).toFixed(3))
      ]),
      shape: 'regular',
      polyN: 8,
      polySeed: 1,
      sym: false
    });
    const commands = [
      freezeObject({ method: 'setStyle', args: freezeObject([style]) }),
      freezeObject({ method: 'setSampleMode', args: freezeObject(['time']) }),
      freezeObject({ method: 'setRotationMode', args: freezeObject(['precess']) }),
      freezeObject({ method: 'setParam', args: freezeObject(['detail', detail]) }),
      freezeObject({ method: 'setParam', args: freezeObject(['rotationSpeed', Number((0.18 + normalizedRank * 0.24).toFixed(3))]) }),
      freezeObject({ method: 'applyPatternSpec', args: freezeObject([pattern]) })
    ];
    return freezeObject({
      schemaVersion: VERSION,
      kind: 'signal-field-plate-particle-recipe',
      target: 'soundMotionNative',
      allowedMethods: freezeObject(['setStyle', 'setSampleMode', 'setRotationMode', 'setParam', 'applyPatternSpec']),
      commands: freezeObject(commands),
      plateGuide: freezeObject({
        boundary: plate.config.boundary,
        mode: mode,
        potential: 'visual settling guide U = w^2',
        nodeWidth: nodeWidth,
        excitationPoint: excitation
      }),
      limitations: freezeObject([
        'This is a visual mapping into Signal Field’s existing 3D particle renderer.',
        'It does not simulate grain-to-grain contact, static friction, air coupling, or exact sand accumulation.',
        'No command is executed by this function; callers must explicitly choose whether to apply the whitelist.'
      ])
    });
  }

  return Object.freeze({
    VERSION: VERSION,
    KIND: KIND,
    MATERIALS: MATERIALS,
    normalizeConfig: normalizeConfig,
    createPlateLab: createPlateLab,
    resolveMode: resolveMode,
    modeShape: modeShape,
    sampleModeGrid: sampleModeGrid,
    frequencyResponse: frequencyResponse,
    sampleFrequencyResponse: sampleFrequencyResponse,
    createSoundMotionNativeRecipe: createSoundMotionNativeRecipe
  });
}));
