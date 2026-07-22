/*
 * Signal Field — scene, project, and timeline core
 *
 * Dependency-free state utilities for building a scene studio without coupling
 * project data to the renderer or DOM. The public recipe layer is deliberately
 * restricted to the methods exposed by window.soundMotionNative.
 */
(function attachSceneStudio(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldSceneStudio = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSceneStudio() {
  'use strict';

  const VERSION = '1.0.0';
  const SNAPSHOT_SCHEMA = 'signal-field/scene-snapshot';
  const PROJECT_SCHEMA = 'signal-field/scene-project';
  const SCHEMA_VERSION = 1;
  const MAX_SCENES = 100;
  const MAX_KEYFRAMES = 1000;
  const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
  const MAX_TEXT_LENGTH = 120;
  const STYLE_VALUES = ['sand', 'msand', 'cosmic', 'dcosmic'];
  const SAMPLE_MODE_VALUES = ['beat', 'time'];
  const ROTATION_MODE_VALUES = ['single', 'tumble', 'precess'];
  const SOLID_SHAPE_VALUES = ['regular', 'random', 'sphere'];
  const PUBLIC_METHODS = new Set([
    'setStyle', 'setSampleMode', 'setRotationMode', 'setSolidShape', 'setParam',
    'setBoolean', 'setTransparent', 'applyPatternSpec'
  ]);
  const PARAMETER_LIMITS = {
    detail: [0.55, 3],
    particles: [0.05, 1],
    evolve: [0.12, 1],
    zoom: [0.25, 8],
    rotationSpeed: [0, 4],
    faces: [4, 32],
    light: [0, 9],
    patternInterval: [0.25, 30]
  };
  const DEFAULT_SNAPSHOT = {
    schema: SNAPSHOT_SCHEMA,
    version: SCHEMA_VERSION,
    style: 'cosmic',
    sampleMode: 'beat',
    rotationMode: 'precess',
    solidShape: 'regular',
    parameters: {
      detail: 1,
      particles: 0.15,
      evolve: 0.5,
      zoom: 3,
      rotationSpeed: 1,
      faces: 8,
      light: 9,
      patternInterval: 2
    },
    toggles: {
      rotation: true,
      symmetry: false,
      frame: false,
      transparent: false
    },
    pattern: {
      style: 'cosmic',
      goal: 10.698082,
      ex: [0.831442, 0.372237, 0.799461],
      detail: 1,
      shape: 'regular',
      polyN: 8,
      polySeed: 1,
      sym: false
    }
  };

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
  }

  function round(value, places) {
    const multiplier = Math.pow(10, places == null ? 6 : places);
    return Math.round(finite(value, 0) * multiplier) / multiplier;
  }

  function string(value, maximum) {
    return value == null ? '' : String(value).trim().slice(0, maximum || MAX_TEXT_LENGTH);
  }

  function enumValue(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function safeId(value, fallback) {
    const normalized = string(value, 96).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return normalized || fallback;
  }

  function requirePlainObject(value, label) {
    if (!isPlainObject(value)) throw new TypeError((label || 'Value') + ' must be a plain object.');
    return value;
  }

  function defaultSnapshot() {
    return clone(DEFAULT_SNAPSHOT);
  }

  function parameterSource(input) {
    return isPlainObject(input.parameters) ? input.parameters : (isPlainObject(input.params) ? input.params : {});
  }

  function toggleSource(input) {
    return isPlainObject(input.toggles) ? input.toggles : {};
  }

  function patternSource(input) {
    return isPlainObject(input.pattern) ? input.pattern : (isPlainObject(input.patternSpec) ? input.patternSpec : {});
  }

  function sourceValue(input, parameters, key, fallback) {
    if (own(parameters, key)) return parameters[key];
    return own(input, key) ? input[key] : fallback;
  }

  /**
   * Creates a complete, JSON-safe snapshot from either a renderer state or a
   * partial scene form. Unknown fields are discarded and the input is not read
   * after construction, so callers cannot mutate stored state by reference.
   */
  function createSnapshot(input) {
    const source = input == null ? {} : requirePlainObject(input, 'Snapshot input');
    const parameters = parameterSource(source);
    const toggles = toggleSource(source);
    const patternInput = patternSource(source);
    const style = enumValue(source.style, STYLE_VALUES, DEFAULT_SNAPSHOT.style);
    const sampleMode = enumValue(source.sampleMode, SAMPLE_MODE_VALUES, DEFAULT_SNAPSHOT.sampleMode);
    const rotationMode = enumValue(source.rotationMode, ROTATION_MODE_VALUES, DEFAULT_SNAPSHOT.rotationMode);
    const solidShape = enumValue(source.solidShape || source.shape, SOLID_SHAPE_VALUES, DEFAULT_SNAPSHOT.solidShape);
    const normalizedParameters = {};

    Object.keys(PARAMETER_LIMITS).forEach(function normaliseParameter(key) {
      const limits = PARAMETER_LIMITS[key];
      const defaultValue = DEFAULT_SNAPSHOT.parameters[key];
      const raw = sourceValue(source, parameters, key, defaultValue);
      const rounded = key === 'faces' || key === 'light' ? Math.round(clamp(raw, limits[0], limits[1])) : round(clamp(raw, limits[0], limits[1]));
      normalizedParameters[key] = rounded;
    });

    const normalizedToggles = {
      rotation: own(toggles, 'rotation') ? Boolean(toggles.rotation) : (own(source, 'rotation') ? Boolean(source.rotation) : DEFAULT_SNAPSHOT.toggles.rotation),
      symmetry: own(toggles, 'symmetry') ? Boolean(toggles.symmetry) : (own(source, 'symmetric') ? Boolean(source.symmetric) : DEFAULT_SNAPSHOT.toggles.symmetry),
      frame: own(toggles, 'frame') ? Boolean(toggles.frame) : (own(source, 'frame') ? Boolean(source.frame) : DEFAULT_SNAPSHOT.toggles.frame),
      transparent: own(toggles, 'transparent') ? Boolean(toggles.transparent) : (own(source, 'transparent') ? Boolean(source.transparent) : DEFAULT_SNAPSHOT.toggles.transparent)
    };
    const exInput = Array.isArray(patternInput.ex) ? patternInput.ex : DEFAULT_SNAPSHOT.pattern.ex;
    const pattern = {
      style: enumValue(patternInput.style, STYLE_VALUES, style),
      goal: round(clamp(patternInput.goal, 0.25, 20)),
      ex: [0, 1, 2].map(function normaliseAxis(index) { return round(clamp(exInput[index], 0, 1)); }),
      detail: round(clamp(patternInput.detail, PARAMETER_LIMITS.detail[0], PARAMETER_LIMITS.detail[1])),
      shape: enumValue(patternInput.shape, SOLID_SHAPE_VALUES, solidShape),
      polyN: Math.round(clamp(patternInput.polyN, 4, 32)),
      polySeed: Math.max(1, Math.round(finite(patternInput.polySeed, DEFAULT_SNAPSHOT.pattern.polySeed))),
      sym: own(patternInput, 'sym') ? Boolean(patternInput.sym) : normalizedToggles.symmetry
    };

    if (!own(patternInput, 'goal')) pattern.goal = DEFAULT_SNAPSHOT.pattern.goal;
    if (!own(patternInput, 'detail')) pattern.detail = normalizedParameters.detail;
    if (!own(patternInput, 'polyN')) pattern.polyN = normalizedParameters.faces;

    return {
      schema: SNAPSHOT_SCHEMA,
      version: SCHEMA_VERSION,
      style: style,
      sampleMode: sampleMode,
      rotationMode: rotationMode,
      solidShape: solidShape,
      parameters: normalizedParameters,
      toggles: normalizedToggles,
      pattern: pattern
    };
  }

  function validationError(errors, message) {
    errors.push(message);
  }

  function validEnum(value, allowed) {
    return allowed.indexOf(value) >= 0;
  }

  function validFiniteInRange(value, limits, integer) {
    return typeof value === 'number' && Number.isFinite(value) && value >= limits[0] && value <= limits[1] && (!integer || Math.floor(value) === value);
  }

  /** Strict validation for imported snapshots. It does not coerce malformed data. */
  function validateSnapshot(input) {
    const errors = [];
    if (!isPlainObject(input)) return { valid: false, errors: ['Snapshot must be a plain object.'] };
    if (input.schema !== SNAPSHOT_SCHEMA) validationError(errors, 'Unexpected snapshot schema.');
    if (input.version !== SCHEMA_VERSION) validationError(errors, 'Unsupported snapshot version.');
    if (!validEnum(input.style, STYLE_VALUES)) validationError(errors, 'Invalid snapshot style.');
    if (!validEnum(input.sampleMode, SAMPLE_MODE_VALUES)) validationError(errors, 'Invalid sample mode.');
    if (!validEnum(input.rotationMode, ROTATION_MODE_VALUES)) validationError(errors, 'Invalid rotation mode.');
    if (!validEnum(input.solidShape, SOLID_SHAPE_VALUES)) validationError(errors, 'Invalid solid shape.');
    if (!isPlainObject(input.parameters)) validationError(errors, 'Snapshot parameters are required.');
    if (!isPlainObject(input.toggles)) validationError(errors, 'Snapshot toggles are required.');
    if (!isPlainObject(input.pattern)) validationError(errors, 'Snapshot pattern is required.');
    if (isPlainObject(input.parameters)) {
      Object.keys(PARAMETER_LIMITS).forEach(function checkParameter(key) {
        if (!validFiniteInRange(input.parameters[key], PARAMETER_LIMITS[key], key === 'faces' || key === 'light')) {
          validationError(errors, 'Invalid parameter: ' + key + '.');
        }
      });
    }
    if (isPlainObject(input.toggles)) {
      ['rotation', 'symmetry', 'frame', 'transparent'].forEach(function checkToggle(key) {
        if (typeof input.toggles[key] !== 'boolean') validationError(errors, 'Invalid toggle: ' + key + '.');
      });
    }
    if (isPlainObject(input.pattern)) {
      if (!validEnum(input.pattern.style, STYLE_VALUES)) validationError(errors, 'Invalid pattern style.');
      if (!validFiniteInRange(input.pattern.goal, [0.25, 20])) validationError(errors, 'Invalid pattern goal.');
      if (!Array.isArray(input.pattern.ex) || input.pattern.ex.length !== 3 || input.pattern.ex.some(function invalidAxis(value) { return !validFiniteInRange(value, [0, 1]); })) validationError(errors, 'Invalid pattern axes.');
      if (!validFiniteInRange(input.pattern.detail, PARAMETER_LIMITS.detail)) validationError(errors, 'Invalid pattern detail.');
      if (!validEnum(input.pattern.shape, SOLID_SHAPE_VALUES)) validationError(errors, 'Invalid pattern shape.');
      if (!validFiniteInRange(input.pattern.polyN, [4, 32], true)) validationError(errors, 'Invalid pattern polyN.');
      if (!validFiniteInRange(input.pattern.polySeed, [1, Number.MAX_SAFE_INTEGER], true)) validationError(errors, 'Invalid pattern polySeed.');
      if (typeof input.pattern.sym !== 'boolean') validationError(errors, 'Invalid pattern symmetry.');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function assertValidSnapshot(input) {
    const result = validateSnapshot(input);
    if (!result.valid) throw new TypeError('Invalid scene snapshot: ' + result.errors.join(' '));
    return createSnapshot(input);
  }

  function createScene(input, fallbackId) {
    const source = input == null ? {} : requirePlainObject(input, 'Scene input');
    const id = safeId(source.id, fallbackId || 'scene');
    const name = string(source.name, MAX_TEXT_LENGTH) || 'Untitled scene';
    const snapshot = source.snapshot == null ? defaultSnapshot() : createSnapshot(source.snapshot);
    return { id: id, name: name, snapshot: snapshot };
  }

  function createKeyframe(input, fallbackId, durationMs) {
    const source = requirePlainObject(input, 'Keyframe input');
    const timeMs = finite(source.timeMs, NaN);
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > durationMs) throw new RangeError('Keyframe time is outside the timeline duration.');
    return {
      id: safeId(source.id, fallbackId || 'keyframe'),
      timeMs: Math.round(timeMs),
      snapshot: source.snapshot == null ? defaultSnapshot() : createSnapshot(source.snapshot)
    };
  }

  function sortKeyframes(keyframes) {
    return keyframes.slice().sort(function byTime(a, b) {
      return a.timeMs - b.timeMs || a.id.localeCompare(b.id);
    });
  }

  function createProject(input) {
    const source = input == null ? {} : requirePlainObject(input, 'Project input');
    const durationMs = Math.round(clamp(source.timeline && source.timeline.durationMs, 0, MAX_DURATION_MS));
    const rawScenes = Array.isArray(source.scenes) ? source.scenes : [];
    if (rawScenes.length > MAX_SCENES) throw new RangeError('Project has too many scenes.');
    const usedSceneIds = new Set();
    const scenes = rawScenes.map(function buildScene(scene, index) {
      const result = createScene(scene, 'scene-' + (index + 1));
      if (usedSceneIds.has(result.id)) throw new TypeError('Scene IDs must be unique.');
      usedSceneIds.add(result.id);
      return result;
    });
    const rawKeyframes = source.timeline && Array.isArray(source.timeline.keyframes) ? source.timeline.keyframes : [];
    if (rawKeyframes.length > MAX_KEYFRAMES) throw new RangeError('Timeline has too many keyframes.');
    const usedKeyframeIds = new Set();
    const keyframes = rawKeyframes.map(function buildKeyframe(keyframe, index) {
      const result = createKeyframe(keyframe, 'keyframe-' + (index + 1), durationMs);
      if (usedKeyframeIds.has(result.id)) throw new TypeError('Keyframe IDs must be unique.');
      usedKeyframeIds.add(result.id);
      return result;
    });
    return {
      schema: PROJECT_SCHEMA,
      version: SCHEMA_VERSION,
      title: string(source.title, MAX_TEXT_LENGTH) || 'Untitled Signal Field project',
      scenes: scenes,
      timeline: {
        durationMs: durationMs,
        keyframes: sortKeyframes(keyframes)
      }
    };
  }

  /** Strict validation for JSON imports. */
  function validateProject(input) {
    const errors = [];
    if (!isPlainObject(input)) return { valid: false, errors: ['Project must be a plain object.'] };
    if (input.schema !== PROJECT_SCHEMA) validationError(errors, 'Unexpected project schema.');
    if (input.version !== SCHEMA_VERSION) validationError(errors, 'Unsupported project version.');
    if (typeof input.title !== 'string' || input.title.length > MAX_TEXT_LENGTH) validationError(errors, 'Invalid project title.');
    if (!Array.isArray(input.scenes) || input.scenes.length > MAX_SCENES) validationError(errors, 'Invalid scenes collection.');
    if (!isPlainObject(input.timeline)) validationError(errors, 'Timeline is required.');
    const sceneIds = new Set();
    if (Array.isArray(input.scenes)) {
      input.scenes.forEach(function checkScene(scene) {
        if (!isPlainObject(scene) || !safeId(scene.id, '') || typeof scene.name !== 'string' || scene.name.length > MAX_TEXT_LENGTH) {
          validationError(errors, 'Invalid scene metadata.');
          return;
        }
        if (sceneIds.has(scene.id)) validationError(errors, 'Duplicate scene ID: ' + scene.id + '.');
        sceneIds.add(scene.id);
        const validation = validateSnapshot(scene.snapshot);
        if (!validation.valid) validationError(errors, 'Invalid scene "' + scene.id + '": ' + validation.errors.join(' '));
      });
    }
    if (isPlainObject(input.timeline)) {
      if (!validFiniteInRange(input.timeline.durationMs, [0, MAX_DURATION_MS], true)) validationError(errors, 'Invalid timeline duration.');
      if (!Array.isArray(input.timeline.keyframes) || input.timeline.keyframes.length > MAX_KEYFRAMES) validationError(errors, 'Invalid keyframe collection.');
      const keyframeIds = new Set();
      if (Array.isArray(input.timeline.keyframes)) {
        input.timeline.keyframes.forEach(function checkKeyframe(keyframe) {
          if (!isPlainObject(keyframe) || !safeId(keyframe.id, '') || !validFiniteInRange(keyframe.timeMs, [0, input.timeline.durationMs || 0], true)) {
            validationError(errors, 'Invalid keyframe metadata.');
            return;
          }
          if (keyframeIds.has(keyframe.id)) validationError(errors, 'Duplicate keyframe ID: ' + keyframe.id + '.');
          keyframeIds.add(keyframe.id);
          const validation = validateSnapshot(keyframe.snapshot);
          if (!validation.valid) validationError(errors, 'Invalid keyframe "' + keyframe.id + '": ' + validation.errors.join(' '));
        });
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function assertValidProject(input) {
    const validation = validateProject(input);
    if (!validation.valid) throw new TypeError('Invalid scene project: ' + validation.errors.join(' '));
    return createProject(input);
  }

  function exportProject(input, options) {
    const project = assertValidProject(input);
    const settings = options || {};
    return JSON.stringify(project, null, settings.pretty === false ? 0 : 2);
  }

  function importProject(serialized) {
    let parsed = serialized;
    if (typeof serialized === 'string') {
      try {
        parsed = JSON.parse(serialized);
      } catch (error) {
        throw new SyntaxError('Invalid project JSON: ' + error.message);
      }
    }
    return assertValidProject(parsed);
  }

  function interpolateValue(from, to, progress) {
    if (typeof from === 'number' && typeof to === 'number') return round(from + (to - from) * progress);
    if (Array.isArray(from) && Array.isArray(to) && from.length === to.length && from.every(function numeric(value) { return typeof value === 'number'; }) && to.every(function numeric(value) { return typeof value === 'number'; })) {
      return from.map(function interpolateArray(value, index) { return interpolateValue(value, to[index], progress); });
    }
    return progress < 1 ? clone(from) : clone(to);
  }

  /** Numeric values interpolate linearly; booleans and enums step at the next keyframe. */
  function interpolateSnapshots(fromInput, toInput, progress) {
    const from = createSnapshot(fromInput);
    const to = createSnapshot(toInput);
    const t = clamp(progress, 0, 1);
    const parameters = {};
    Object.keys(PARAMETER_LIMITS).forEach(function interpolateParameter(key) {
      const integer = key === 'faces' || key === 'light';
      const value = interpolateValue(from.parameters[key], to.parameters[key], t);
      parameters[key] = integer ? Math.round(value) : value;
    });
    const pattern = {
      style: t < 1 ? from.pattern.style : to.pattern.style,
      goal: interpolateValue(from.pattern.goal, to.pattern.goal, t),
      ex: interpolateValue(from.pattern.ex, to.pattern.ex, t),
      detail: interpolateValue(from.pattern.detail, to.pattern.detail, t),
      shape: t < 1 ? from.pattern.shape : to.pattern.shape,
      polyN: Math.round(interpolateValue(from.pattern.polyN, to.pattern.polyN, t)),
      polySeed: Math.max(1, Math.round(interpolateValue(from.pattern.polySeed, to.pattern.polySeed, t))),
      sym: t < 1 ? from.pattern.sym : to.pattern.sym
    };
    return createSnapshot({
      style: t < 1 ? from.style : to.style,
      sampleMode: t < 1 ? from.sampleMode : to.sampleMode,
      rotationMode: t < 1 ? from.rotationMode : to.rotationMode,
      solidShape: t < 1 ? from.solidShape : to.solidShape,
      parameters: parameters,
      toggles: {
        rotation: t < 1 ? from.toggles.rotation : to.toggles.rotation,
        symmetry: t < 1 ? from.toggles.symmetry : to.toggles.symmetry,
        frame: t < 1 ? from.toggles.frame : to.toggles.frame,
        transparent: t < 1 ? from.toggles.transparent : to.toggles.transparent
      },
      pattern: pattern
    });
  }

  function seekTimeline(projectInput, timeMs) {
    const project = assertValidProject(projectInput);
    const keyframes = project.timeline.keyframes;
    const requested = finite(timeMs, NaN);
    if (!Number.isFinite(requested)) throw new TypeError('Timeline seek time must be finite.');
    const time = Math.round(clamp(requested, 0, project.timeline.durationMs));
    if (!keyframes.length) return { timeMs: time, durationMs: project.timeline.durationMs, fromId: null, toId: null, progress: 0, snapshot: null };
    if (time <= keyframes[0].timeMs) return { timeMs: time, durationMs: project.timeline.durationMs, fromId: keyframes[0].id, toId: keyframes[0].id, progress: 0, snapshot: clone(keyframes[0].snapshot) };
    const last = keyframes[keyframes.length - 1];
    if (time >= last.timeMs) return { timeMs: time, durationMs: project.timeline.durationMs, fromId: last.id, toId: last.id, progress: 1, snapshot: clone(last.snapshot) };
    for (let index = 1; index < keyframes.length; index += 1) {
      const next = keyframes[index];
      if (time <= next.timeMs) {
        const previous = keyframes[index - 1];
        const span = Math.max(1, next.timeMs - previous.timeMs);
        const progress = round((time - previous.timeMs) / span);
        return {
          timeMs: time,
          durationMs: project.timeline.durationMs,
          fromId: previous.id,
          toId: next.id,
          progress: progress,
          snapshot: interpolateSnapshots(previous.snapshot, next.snapshot, progress)
        };
      }
    }
    return { timeMs: time, durationMs: project.timeline.durationMs, fromId: last.id, toId: last.id, progress: 1, snapshot: clone(last.snapshot) };
  }

  /** Generates an allowlisted soundMotionNative command recipe from a snapshot. */
  function createSoundMotionRecipe(snapshotInput) {
    const snapshot = createSnapshot(snapshotInput);
    const parameters = snapshot.parameters;
    const commands = [
      { type: 'call', method: 'setStyle', args: [snapshot.style] },
      { type: 'call', method: 'setSampleMode', args: [snapshot.sampleMode] },
      { type: 'call', method: 'setRotationMode', args: [snapshot.rotationMode] },
      { type: 'call', method: 'setSolidShape', args: [snapshot.solidShape, parameters.faces, false] },
      { type: 'call', method: 'setParam', args: ['detail', parameters.detail] },
      { type: 'call', method: 'setParam', args: ['particles', parameters.particles] },
      { type: 'call', method: 'setParam', args: ['evolve', parameters.evolve] },
      { type: 'call', method: 'setParam', args: ['zoom', parameters.zoom] },
      { type: 'call', method: 'setParam', args: ['rotationSpeed', parameters.rotationSpeed] },
      { type: 'call', method: 'setParam', args: ['faces', parameters.faces] },
      { type: 'call', method: 'setParam', args: ['light', parameters.light] },
      { type: 'call', method: 'setParam', args: ['patternInterval', parameters.patternInterval] },
      { type: 'call', method: 'setBoolean', args: ['rotation', snapshot.toggles.rotation] },
      { type: 'call', method: 'setBoolean', args: ['symmetry', snapshot.toggles.symmetry] },
      { type: 'call', method: 'setBoolean', args: ['frame', snapshot.toggles.frame] },
      { type: 'call', method: 'setTransparent', args: [snapshot.toggles.transparent] },
      { type: 'call', method: 'applyPatternSpec', args: [clone(snapshot.pattern)] }
    ];
    return {
      schema: 'signal-field/sound-motion-recipe',
      version: SCHEMA_VERSION,
      snapshot: clone(snapshot),
      commands: commands
    };
  }

  function validateSoundMotionRecipe(recipe) {
    const errors = [];
    if (!isPlainObject(recipe) || recipe.schema !== 'signal-field/sound-motion-recipe' || recipe.version !== SCHEMA_VERSION || !Array.isArray(recipe.commands)) {
      return { valid: false, errors: ['Invalid soundMotionNative recipe envelope.'] };
    }
    const snapshotValidation = validateSnapshot(recipe.snapshot);
    if (!snapshotValidation.valid) validationError(errors, 'Invalid recipe snapshot.');
    recipe.commands.forEach(function validateCommand(command) {
      if (!isPlainObject(command) || command.type !== 'call' || !PUBLIC_METHODS.has(command.method) || !Array.isArray(command.args)) {
        validationError(errors, 'Recipe contains a non-public command.');
      }
    });
    if (!errors.length) {
      const expected = createSoundMotionRecipe(recipe.snapshot).commands;
      if (JSON.stringify(recipe.commands) !== JSON.stringify(expected)) {
        validationError(errors, 'Recipe commands do not match the approved snapshot mapping.');
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function applySoundMotionRecipe(recipe, target) {
    const validation = validateSoundMotionRecipe(recipe);
    if (!validation.valid) return { applied: [], skipped: [], error: validation.errors.join(' ') };
    const receiver = target || (typeof window !== 'undefined' ? window.soundMotionNative : null);
    const result = { applied: [], skipped: [], error: null };
    recipe.commands.forEach(function applyCommand(command) {
      if (!receiver || typeof receiver[command.method] !== 'function') {
        result.skipped.push(command.method);
        return;
      }
      receiver[command.method].apply(receiver, clone(command.args));
      result.applied.push(command.method);
    });
    return result;
  }

  function SceneStudioStore(initialProject) {
    this._project = initialProject == null ? createProject({}) : assertValidProject(initialProject);
    this._nextScene = this._project.scenes.length + 1;
    this._nextKeyframe = this._project.timeline.keyframes.length + 1;
  }

  SceneStudioStore.prototype.getProject = function getProject() {
    return clone(this._project);
  };

  SceneStudioStore.prototype._sceneId = function sceneId() {
    let candidate;
    do { candidate = 'scene-' + this._nextScene++; } while (this._project.scenes.some(function hasId(scene) { return scene.id === candidate; }));
    return candidate;
  };

  SceneStudioStore.prototype._keyframeId = function keyframeId() {
    let candidate;
    do { candidate = 'keyframe-' + this._nextKeyframe++; } while (this._project.timeline.keyframes.some(function hasId(keyframe) { return keyframe.id === candidate; }));
    return candidate;
  };

  SceneStudioStore.prototype.addScene = function addScene(input) {
    const source = input == null ? {} : requirePlainObject(input, 'Scene input');
    const suppliedId = safeId(source.id, '');
    const scene = createScene(source, suppliedId || this._sceneId());
    if (this._project.scenes.some(function hasId(item) { return item.id === scene.id; })) throw new TypeError('Scene ID already exists: ' + scene.id + '.');
    this._project.scenes.push(scene);
    return clone(scene);
  };

  SceneStudioStore.prototype.updateScene = function updateScene(id, patch) {
    const sceneId = safeId(id, '');
    const source = requirePlainObject(patch, 'Scene patch');
    const index = this._project.scenes.findIndex(function findScene(scene) { return scene.id === sceneId; });
    if (index < 0) throw new RangeError('Unknown scene: ' + sceneId + '.');
    const current = this._project.scenes[index];
    const next = {
      id: current.id,
      name: own(source, 'name') ? (string(source.name, MAX_TEXT_LENGTH) || current.name) : current.name,
      snapshot: own(source, 'snapshot') ? createSnapshot(source.snapshot) : current.snapshot
    };
    this._project.scenes[index] = next;
    return clone(next);
  };

  SceneStudioStore.prototype.getScene = function getScene(id) {
    const sceneId = safeId(id, '');
    const scene = this._project.scenes.find(function findScene(item) { return item.id === sceneId; });
    return scene ? clone(scene) : null;
  };

  SceneStudioStore.prototype.saveSceneSnapshot = function saveSceneSnapshot(id, snapshot) {
    return this.updateScene(id, { snapshot: snapshot });
  };

  SceneStudioStore.prototype.removeScene = function removeScene(id) {
    const sceneId = safeId(id, '');
    const index = this._project.scenes.findIndex(function findScene(scene) { return scene.id === sceneId; });
    if (index < 0) return null;
    return clone(this._project.scenes.splice(index, 1)[0]);
  };

  SceneStudioStore.prototype.reorderScenes = function reorderScenes(ids) {
    if (!Array.isArray(ids) || ids.length !== this._project.scenes.length) throw new TypeError('Scene order must include every scene exactly once.');
    const requested = ids.map(function normaliseId(id) { return safeId(id, ''); });
    const known = new Set(this._project.scenes.map(function sceneId(scene) { return scene.id; }));
    if (new Set(requested).size !== requested.length || requested.some(function unknown(id) { return !known.has(id); })) {
      throw new TypeError('Scene order must include every scene exactly once.');
    }
    const byId = new Map(this._project.scenes.map(function pair(scene) { return [scene.id, scene]; }));
    this._project.scenes = requested.map(function selectScene(id) { return byId.get(id); });
    return this.getProject().scenes;
  };

  SceneStudioStore.prototype.restoreScene = function restoreScene(id, target) {
    const sceneId = safeId(id, '');
    const scene = this._project.scenes.find(function findScene(item) { return item.id === sceneId; });
    if (!scene) throw new RangeError('Unknown scene: ' + sceneId + '.');
    const snapshot = clone(scene.snapshot);
    const recipe = createSoundMotionRecipe(snapshot);
    return { scene: clone(scene), snapshot: snapshot, recipe: recipe, applied: target ? applySoundMotionRecipe(recipe, target) : null };
  };

  SceneStudioStore.prototype.setTimelineDuration = function setTimelineDuration(durationMs) {
    const duration = finite(durationMs, NaN);
    if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_MS) throw new RangeError('Invalid timeline duration.');
    const nextDuration = Math.round(duration);
    if (this._project.timeline.keyframes.some(function outside(keyframe) { return keyframe.timeMs > nextDuration; })) {
      throw new RangeError('Timeline duration cannot exclude existing keyframes.');
    }
    this._project.timeline.durationMs = nextDuration;
    return nextDuration;
  };

  SceneStudioStore.prototype.upsertKeyframe = function upsertKeyframe(input) {
    const source = requirePlainObject(input, 'Keyframe input');
    const suppliedId = safeId(source.id, '');
    const id = suppliedId || this._keyframeId();
    const next = createKeyframe(Object.assign({}, source, { id: id }), id, this._project.timeline.durationMs);
    const index = this._project.timeline.keyframes.findIndex(function findKeyframe(keyframe) { return keyframe.id === id; });
    if (index >= 0) this._project.timeline.keyframes[index] = next;
    else this._project.timeline.keyframes.push(next);
    this._project.timeline.keyframes = sortKeyframes(this._project.timeline.keyframes);
    return clone(next);
  };

  SceneStudioStore.prototype.removeKeyframe = function removeKeyframe(id) {
    const keyframeId = safeId(id, '');
    const index = this._project.timeline.keyframes.findIndex(function findKeyframe(keyframe) { return keyframe.id === keyframeId; });
    if (index < 0) return null;
    return clone(this._project.timeline.keyframes.splice(index, 1)[0]);
  };

  SceneStudioStore.prototype.seek = function seek(timeMs) {
    return seekTimeline(this._project, timeMs);
  };

  SceneStudioStore.prototype.exportJSON = function exportJSON(options) {
    return exportProject(this._project, options);
  };

  SceneStudioStore.prototype.importJSON = function importJSON(serialized) {
    const replacement = importProject(serialized);
    this._project = replacement;
    this._nextScene = this._project.scenes.length + 1;
    this._nextKeyframe = this._project.timeline.keyframes.length + 1;
    return this.getProject();
  };

  SceneStudioStore.prototype.tryImportJSON = function tryImportJSON(serialized) {
    try {
      return { ok: true, project: this.importJSON(serialized), error: null };
    } catch (error) {
      return { ok: false, project: this.getProject(), error: error.message };
    }
  };

  return {
    VERSION: VERSION,
    SNAPSHOT_SCHEMA: SNAPSHOT_SCHEMA,
    PROJECT_SCHEMA: PROJECT_SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    PUBLIC_METHODS: Array.from(PUBLIC_METHODS),
    defaultSnapshot: defaultSnapshot,
    createSnapshot: createSnapshot,
    validateSnapshot: validateSnapshot,
    createScene: createScene,
    createProject: createProject,
    validateProject: validateProject,
    exportProject: exportProject,
    importProject: importProject,
    interpolateSnapshots: interpolateSnapshots,
    seekTimeline: seekTimeline,
    createSoundMotionRecipe: createSoundMotionRecipe,
    validateSoundMotionRecipe: validateSoundMotionRecipe,
    applySoundMotionRecipe: applySoundMotionRecipe,
    SceneStudioStore: SceneStudioStore,
    createStore: function createStore(project) { return new SceneStudioStore(project); }
  };
}));
