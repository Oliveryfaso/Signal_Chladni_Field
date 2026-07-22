/*
 * Signal Field — music-video production specification core
 *
 * Dependency-free, deterministic data utilities shared by the web editor,
 * desktop render queue, and command-line exporter. This module performs no
 * rendering, file-system access, or DOM work.
 */
(function attachProductionSpec(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldProductionSpec = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createProductionSpecCore() {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'signal-field-production/v1';
  const SCHEMA_VERSION = 1;
  const PROJECT_SCHEMA = 'signal-field/scene-project';
  const SNAPSHOT_SCHEMA = 'signal-field/scene-snapshot';
  const ASPECTS = Object.freeze(['16:9', '9:16', '1:1']);
  const TITLE_TEMPLATES = Object.freeze(['none', 'minimal', 'cinematic', 'kinetic']);
  const BEAT_ACTIONS = Object.freeze(['cut', 'accent', 'hold']);
  const OUTPUT_CODECS = Object.freeze(['h264', 'prores']);
  const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
  const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
  const MAX_TITLE_LENGTH = 120;
  const MAX_SUBTITLE_LENGTH = 180;
  const MAX_LYRIC_LENGTH = 500;
  const MAX_LYRIC_TOTAL_LENGTH = 200000;
  const MAX_LYRICS = 5000;
  const MAX_LYRIC_DURATION_MS = 2 * 60 * 1000;
  const MAX_BEAT_EDITS = 20000;
  const MAX_FILE_NAME_LENGTH = 160;
  const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);
  const STYLE_VALUES = ['sand', 'msand', 'cosmic', 'dcosmic'];
  const SAMPLE_MODE_VALUES = ['beat', 'time'];
  const ROTATION_MODE_VALUES = ['single', 'tumble', 'precess'];
  const SHAPE_VALUES = ['regular', 'random', 'sphere'];
  const PARAMETER_LIMITS = {
    detail: [0.55, 3], particles: [0.05, 1], evolve: [0.12, 1], zoom: [0.25, 8],
    rotationSpeed: [0, 4], faces: [4, 32], light: [0, 9], patternInterval: [0.25, 30]
  };

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function rejectUnknown(object, allowed, label) {
    Object.keys(object).forEach(function checkUnknown(key) {
      if (allowed.indexOf(key) < 0) throw new RangeError('Unknown ' + label + ' property: ' + key + '.');
    });
  }

  function requirePlain(value, label) {
    if (!isPlainObject(value)) throw new TypeError(label + ' must be a plain object.');
    return value;
  }

  function requireEnum(value, allowed, label) {
    if (allowed.indexOf(value) < 0) throw new RangeError(label + ' must be one of: ' + allowed.join(', ') + '.');
    return value;
  }

  function requireFinite(value, minimum, maximum, label, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    if ((integer && !Number.isInteger(value)) || value < minimum || value > maximum) {
      throw new RangeError(label + ' must be ' + (integer ? 'an integer ' : '') + 'between ' + minimum + ' and ' + maximum + '.');
    }
    return value;
  }

  function requireBoolean(value, label) {
    if (typeof value !== 'boolean') throw new TypeError(label + ' must be a boolean.');
    return value;
  }

  function requireString(value, maximum, label, allowEmpty, multiline) {
    if (typeof value !== 'string') throw new TypeError(label + ' must be a string.');
    if (value.length > maximum) throw new RangeError(label + ' exceeds ' + maximum + ' characters.');
    if (/\u0000/.test(value) || (multiline ? /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0001-\u001f\u007f]/).test(value)) {
      throw new RangeError(label + ' contains unsupported control characters.');
    }
    const normalized = value.trim();
    if (!allowEmpty && !normalized) throw new RangeError(label + ' cannot be empty.');
    return normalized;
  }

  function requireSafeId(value, label) {
    const id = requireString(value, 96, label, false, false);
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new RangeError(label + ' contains unsupported characters.');
    return id;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function equalJson(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every(function equalArrayValue(value, index) { return equalJson(value, right[index]); });
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(function equalProperty(key) { return own(right, key) && equalJson(left[key], right[key]); });
  }

  function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) throw new RangeError('JSON text contains an unpaired surrogate.');
        bytes += 4;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new RangeError('JSON text contains an unpaired surrogate.');
      } else bytes += 3;
    }
    return bytes;
  }

  function assertSafeJson(value, label) {
    const state = { nodes: 0 };
    function visit(item, path, depth) {
      state.nodes += 1;
      if (state.nodes > 300000) throw new RangeError(label + ' exceeds the safe node budget.');
      if (depth > 48) throw new RangeError(label + ' exceeds the safe nesting depth.');
      if (item === null || typeof item === 'boolean') return;
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) throw new TypeError(path + ' must be finite.');
        return;
      }
      if (typeof item === 'string') {
        utf8ByteLength(item);
        return;
      }
      if (typeof item !== 'object') throw new TypeError(path + ' is not JSON-safe.');
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError(path + ' cannot contain symbol properties.');
      if (Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length !== item.length) throw new TypeError(path + ' must be a dense array without custom properties.');
        for (let index = 0; index < item.length; index += 1) {
          if (!own(item, String(index))) throw new TypeError(path + ' must not contain sparse entries.');
          visit(item[index], path + '[' + index + ']', depth + 1);
        }
        return;
      }
      if (!isPlainObject(item)) throw new TypeError(path + ' must contain only plain objects.');
      Object.keys(item).forEach(function visitKey(key) {
        if (FORBIDDEN_KEYS.indexOf(key) >= 0) throw new TypeError(path + ' contains forbidden key: ' + key + '.');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || own(descriptor, 'get') || own(descriptor, 'set')) throw new TypeError(path + '.' + key + ' must be a data property.');
        visit(descriptor.value, path + '.' + key, depth + 1);
      });
    }
    visit(value, label, 0);
    return value;
  }

  function validateSnapshot(snapshot, label) {
    requirePlain(snapshot, label);
    rejectUnknown(snapshot, ['schema', 'version', 'style', 'sampleMode', 'rotationMode', 'solidShape', 'parameters', 'toggles', 'pattern'], label);
    if (snapshot.schema !== SNAPSHOT_SCHEMA || snapshot.version !== 1) throw new RangeError(label + ' has an unsupported schema or version.');
    requireEnum(snapshot.style, STYLE_VALUES, label + '.style');
    requireEnum(snapshot.sampleMode, SAMPLE_MODE_VALUES, label + '.sampleMode');
    requireEnum(snapshot.rotationMode, ROTATION_MODE_VALUES, label + '.rotationMode');
    requireEnum(snapshot.solidShape, SHAPE_VALUES, label + '.solidShape');
    requirePlain(snapshot.parameters, label + '.parameters');
    rejectUnknown(snapshot.parameters, Object.keys(PARAMETER_LIMITS), label + '.parameters');
    Object.keys(PARAMETER_LIMITS).forEach(function checkParameter(key) {
      const integer = key === 'faces' || key === 'light';
      requireFinite(snapshot.parameters[key], PARAMETER_LIMITS[key][0], PARAMETER_LIMITS[key][1], label + '.parameters.' + key, integer);
    });
    requirePlain(snapshot.toggles, label + '.toggles');
    rejectUnknown(snapshot.toggles, ['rotation', 'symmetry', 'frame', 'transparent'], label + '.toggles');
    ['rotation', 'symmetry', 'frame', 'transparent'].forEach(function checkToggle(key) {
      requireBoolean(snapshot.toggles[key], label + '.toggles.' + key);
    });
    requirePlain(snapshot.pattern, label + '.pattern');
    rejectUnknown(snapshot.pattern, ['style', 'goal', 'ex', 'detail', 'shape', 'polyN', 'polySeed', 'sym'], label + '.pattern');
    requireEnum(snapshot.pattern.style, STYLE_VALUES, label + '.pattern.style');
    requireFinite(snapshot.pattern.goal, 0.25, 20, label + '.pattern.goal', false);
    if (!Array.isArray(snapshot.pattern.ex) || snapshot.pattern.ex.length !== 3) throw new RangeError(label + '.pattern.ex must contain three axes.');
    snapshot.pattern.ex.forEach(function checkAxis(value, index) { requireFinite(value, 0, 1, label + '.pattern.ex[' + index + ']', false); });
    requireFinite(snapshot.pattern.detail, 0.55, 3, label + '.pattern.detail', false);
    requireEnum(snapshot.pattern.shape, SHAPE_VALUES, label + '.pattern.shape');
    requireFinite(snapshot.pattern.polyN, 4, 32, label + '.pattern.polyN', true);
    requireFinite(snapshot.pattern.polySeed, 1, Number.MAX_SAFE_INTEGER, label + '.pattern.polySeed', true);
    requireBoolean(snapshot.pattern.sym, label + '.pattern.sym');
  }

  function normalizeProject(input) {
    let project = input;
    if (typeof input === 'string') {
      if (utf8ByteLength(input) > MAX_PROJECT_BYTES) throw new RangeError('Embedded project JSON exceeds the 5 MB limit.');
      try { project = JSON.parse(input); } catch (error) { throw new SyntaxError('Invalid embedded project JSON: ' + error.message); }
    }
    assertSafeJson(project, 'Embedded project');
    requirePlain(project, 'Embedded project');
    rejectUnknown(project, ['schema', 'version', 'title', 'scenes', 'timeline'], 'embedded project');
    if (project.schema !== PROJECT_SCHEMA || project.version !== 1) throw new RangeError('Embedded project has an unsupported schema or version.');
    requireString(project.title, 120, 'Embedded project title', true, false);
    if (!Array.isArray(project.scenes) || project.scenes.length > 100) throw new RangeError('Embedded project scenes must contain at most 100 entries.');
    const sceneIds = new Set();
    project.scenes.forEach(function checkScene(scene, index) {
      const label = 'Embedded project scene[' + index + ']';
      requirePlain(scene, label);
      rejectUnknown(scene, ['id', 'name', 'snapshot'], label);
      const id = requireSafeId(scene.id, label + '.id');
      if (sceneIds.has(id)) throw new RangeError('Embedded project scene IDs must be unique.');
      sceneIds.add(id);
      requireString(scene.name, 120, label + '.name', true, false);
      validateSnapshot(scene.snapshot, label + '.snapshot');
    });
    requirePlain(project.timeline, 'Embedded project timeline');
    rejectUnknown(project.timeline, ['durationMs', 'keyframes'], 'embedded project timeline');
    const durationMs = requireFinite(project.timeline.durationMs, 0, MAX_DURATION_MS, 'Embedded project timeline.durationMs', true);
    if (!Array.isArray(project.timeline.keyframes) || project.timeline.keyframes.length > 1000) {
      throw new RangeError('Embedded project keyframes must contain at most 1000 entries.');
    }
    const keyframeIds = new Set();
    let previousTime = -1;
    project.timeline.keyframes.forEach(function checkKeyframe(keyframe, index) {
      const label = 'Embedded project keyframe[' + index + ']';
      requirePlain(keyframe, label);
      rejectUnknown(keyframe, ['id', 'timeMs', 'snapshot'], label);
      const id = requireSafeId(keyframe.id, label + '.id');
      if (keyframeIds.has(id)) throw new RangeError('Embedded project keyframe IDs must be unique.');
      keyframeIds.add(id);
      const timeMs = requireFinite(keyframe.timeMs, 0, durationMs, label + '.timeMs', true);
      if (timeMs < previousTime) throw new RangeError('Embedded project keyframes must be ordered by time.');
      previousTime = timeMs;
      validateSnapshot(keyframe.snapshot, label + '.snapshot');
    });
    const serialized = JSON.stringify(project);
    if (utf8ByteLength(serialized) > MAX_PROJECT_BYTES) throw new RangeError('Embedded project exceeds the 5 MB limit.');
    return clone(project);
  }

  function normalizeTitleCard(input, durationMs) {
    const source = input == null ? {} : requirePlain(input, 'titleCard');
    rejectUnknown(source, ['template', 'mainTitle', 'subtitle', 'durationMs'], 'titleCard');
    const template = own(source, 'template') ? requireEnum(source.template, TITLE_TEMPLATES, 'titleCard.template') : 'none';
    const mainTitle = requireString(own(source, 'mainTitle') ? source.mainTitle : '', MAX_TITLE_LENGTH, 'titleCard.mainTitle', true, false);
    const subtitle = requireString(own(source, 'subtitle') ? source.subtitle : '', MAX_SUBTITLE_LENGTH, 'titleCard.subtitle', true, false);
    const defaultDuration = template === 'none' ? 0 : Math.min(2500, durationMs);
    const titleDuration = own(source, 'durationMs')
      ? requireFinite(source.durationMs, 0, Math.min(30000, durationMs), 'titleCard.durationMs', true)
      : defaultDuration;
    if (template === 'none' && titleDuration !== 0) throw new RangeError('titleCard.durationMs must be 0 for the none template.');
    if (template !== 'none' && titleDuration < 1) throw new RangeError('A visible title template requires a positive titleCard.durationMs.');
    return { template: template, mainTitle: mainTitle, subtitle: subtitle, durationMs: titleDuration };
  }

  function normalizeLyrics(input, durationMs) {
    const source = input == null ? [] : input;
    if (!Array.isArray(source) || source.length > MAX_LYRICS) throw new RangeError('lyrics must contain at most ' + MAX_LYRICS + ' cues.');
    let previousEnd = 0;
    let totalLength = 0;
    return source.map(function normalizeCue(cue, index) {
      const label = 'lyrics[' + index + ']';
      requirePlain(cue, label);
      rejectUnknown(cue, ['startMs', 'endMs', 'text'], label);
      const startMs = requireFinite(cue.startMs, 0, durationMs, label + '.startMs', true);
      const endMs = requireFinite(cue.endMs, 0, durationMs, label + '.endMs', true);
      if (endMs <= startMs) throw new RangeError(label + '.endMs must be after startMs.');
      if (endMs - startMs > MAX_LYRIC_DURATION_MS) throw new RangeError(label + ' exceeds the maximum cue duration.');
      if (index > 0 && startMs < previousEnd) throw new RangeError('lyrics must be ordered and must not overlap.');
      const text = requireString(cue.text, MAX_LYRIC_LENGTH, label + '.text', false, true);
      totalLength += text.length;
      if (totalLength > MAX_LYRIC_TOTAL_LENGTH) throw new RangeError('lyrics exceed the total text limit.');
      previousEnd = endMs;
      return { startMs: startMs, endMs: endMs, text: text };
    });
  }

  function normalizeBeatEdits(input, durationMs, sceneIds) {
    const source = input == null ? [] : input;
    if (!Array.isArray(source) || source.length > MAX_BEAT_EDITS) throw new RangeError('beatEdits must contain at most ' + MAX_BEAT_EDITS + ' entries.');
    let previousTime = -1;
    return source.map(function normalizeEdit(edit, index) {
      const label = 'beatEdits[' + index + ']';
      requirePlain(edit, label);
      rejectUnknown(edit, ['timeMs', 'action', 'intensity', 'targetSceneId'], label);
      const timeMs = requireFinite(edit.timeMs, 0, durationMs, label + '.timeMs', true);
      if (timeMs <= previousTime) throw new RangeError('beatEdits must be strictly ordered with unique timeMs values.');
      previousTime = timeMs;
      const action = requireEnum(edit.action, BEAT_ACTIONS, label + '.action');
      const intensity = own(edit, 'intensity') ? requireFinite(edit.intensity, 0, 1, label + '.intensity', false) : 1;
      let targetSceneId = null;
      if (own(edit, 'targetSceneId') && edit.targetSceneId != null) {
        targetSceneId = requireSafeId(edit.targetSceneId, label + '.targetSceneId');
        if (!sceneIds.has(targetSceneId)) throw new RangeError(label + '.targetSceneId does not reference an embedded scene.');
      }
      return { timeMs: timeMs, action: action, intensity: intensity, targetSceneId: targetSceneId };
    });
  }

  function normalizeFileName(value, codec) {
    const extension = codec === 'prores' ? '.mov' : '.mp4';
    let name = value == null ? 'signal-field-video' + extension : requireString(value, MAX_FILE_NAME_LENGTH, 'output.fileName', false, false);
    if (/[<>:\"/\\|?*]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || name.indexOf('..') >= 0) {
      throw new RangeError('output.fileName must be a safe base file name without a path.');
    }
    if (!/\.[a-zA-Z0-9]+$/.test(name)) name += extension;
    if (!name.toLowerCase().endsWith(extension)) throw new RangeError('output.fileName extension must match output.codec.');
    if (name.length > MAX_FILE_NAME_LENGTH) throw new RangeError('output.fileName exceeds ' + MAX_FILE_NAME_LENGTH + ' characters.');
    return name;
  }

  function normalizeOutput(input) {
    const source = input == null ? {} : requirePlain(input, 'output');
    rejectUnknown(source, ['codec', 'fileName'], 'output');
    const codec = own(source, 'codec') ? requireEnum(source.codec, OUTPUT_CODECS, 'output.codec') : 'h264';
    return { codec: codec, fileName: normalizeFileName(source.fileName, codec) };
  }

  function create(input) {
    const source = requirePlain(input, 'Production specification input');
    assertSafeJson(source, 'Production specification input');
    rejectUnknown(source, ['schema', 'version', 'project', 'aspect', 'titleCard', 'lyrics', 'beatEdits', 'output'], 'production specification');
    if (own(source, 'schema') && source.schema !== SCHEMA) throw new RangeError('Unsupported production specification schema.');
    if (own(source, 'version') && source.version !== SCHEMA_VERSION) throw new RangeError('Unsupported production specification version.');
    if (!own(source, 'project')) throw new TypeError('Production specification requires an embedded project object or project JSON.');
    const project = normalizeProject(source.project);
    const durationMs = project.timeline.durationMs;
    const aspect = own(source, 'aspect') ? requireEnum(source.aspect, ASPECTS, 'aspect') : '16:9';
    const sceneIds = new Set(project.scenes.map(function sceneId(scene) { return scene.id; }));
    const result = {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      project: project,
      aspect: aspect,
      titleCard: normalizeTitleCard(source.titleCard, durationMs),
      lyrics: normalizeLyrics(source.lyrics, durationMs),
      beatEdits: normalizeBeatEdits(source.beatEdits, durationMs, sceneIds),
      output: normalizeOutput(source.output)
    };
    assertSafeJson(result, 'Production specification');
    return result;
  }

  function assertCanonical(input) {
    const source = requirePlain(input, 'Production specification');
    assertSafeJson(source, 'Production specification');
    rejectUnknown(source, ['schema', 'version', 'project', 'aspect', 'titleCard', 'lyrics', 'beatEdits', 'output'], 'production specification');
    if (source.schema !== SCHEMA) throw new RangeError('Unsupported production specification schema.');
    if (source.version !== SCHEMA_VERSION) throw new RangeError('Unsupported production specification version.');
    const canonical = create(source);
    if (!equalJson(canonical, source)) throw new TypeError('Production specification is not in canonical form.');
    return canonical;
  }

  function validate(input) {
    try {
      assertCanonical(input);
      return { valid: true, errors: [] };
    } catch (error) {
      return { valid: false, errors: [error.message] };
    }
  }

  function importSpec(input) {
    let parsed = input;
    if (typeof input === 'string') {
      if (utf8ByteLength(input) > MAX_PROJECT_BYTES + 1024 * 1024) throw new RangeError('Production specification JSON exceeds the 6 MB limit.');
      try { parsed = JSON.parse(input); } catch (error) { throw new SyntaxError('Invalid production specification JSON: ' + error.message); }
    }
    assertSafeJson(parsed, 'Production specification');
    return assertCanonical(parsed);
  }

  function exportSpec(input, options) {
    const spec = assertCanonical(input);
    const settings = options == null ? {} : requirePlain(options, 'Export options');
    rejectUnknown(settings, ['pretty'], 'export option');
    if (own(settings, 'pretty') && typeof settings.pretty !== 'boolean') throw new TypeError('export option pretty must be a boolean.');
    return JSON.stringify(spec, null, settings.pretty === false ? 0 : 2);
  }

  function queryTime(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    return value;
  }

  function activeLyricsAt(input, timeMs) {
    const spec = assertCanonical(input);
    const time = queryTime(timeMs, 'Lyric query time');
    let low = 0;
    let high = spec.lyrics.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const cue = spec.lyrics[middle];
      if (time < cue.startMs) high = middle - 1;
      else if (time >= cue.endMs) low = middle + 1;
      else return clone(cue);
    }
    return null;
  }

  function beatEditAt(input, timeMs) {
    const spec = assertCanonical(input);
    const time = queryTime(timeMs, 'Beat edit query time');
    let low = 0;
    let high = spec.beatEdits.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const edit = spec.beatEdits[middle];
      if (time < edit.timeMs) high = middle - 1;
      else if (time > edit.timeMs) low = middle + 1;
      else return clone(edit);
    }
    return null;
  }

  function nearbyBeatEdits(input, timeMs, windowMs) {
    const spec = assertCanonical(input);
    const time = queryTime(timeMs, 'Beat edit query time');
    const radius = windowMs == null ? 100 : requireFinite(windowMs, 0, 60000, 'Beat edit query window', false);
    const minimum = time - radius;
    const maximum = time + radius;
    return spec.beatEdits.filter(function within(edit) {
      return edit.timeMs >= minimum && edit.timeMs <= maximum;
    }).map(clone);
  }

  return Object.freeze({
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    PROJECT_SCHEMA: PROJECT_SCHEMA,
    ASPECTS: ASPECTS,
    TITLE_TEMPLATES: TITLE_TEMPLATES,
    BEAT_ACTIONS: BEAT_ACTIONS,
    OUTPUT_CODECS: OUTPUT_CODECS,
    MAX_PROJECT_BYTES: MAX_PROJECT_BYTES,
    MAX_DURATION_MS: MAX_DURATION_MS,
    MAX_TITLE_LENGTH: MAX_TITLE_LENGTH,
    MAX_SUBTITLE_LENGTH: MAX_SUBTITLE_LENGTH,
    MAX_LYRIC_LENGTH: MAX_LYRIC_LENGTH,
    MAX_LYRIC_TOTAL_LENGTH: MAX_LYRIC_TOTAL_LENGTH,
    MAX_LYRICS: MAX_LYRICS,
    MAX_LYRIC_DURATION_MS: MAX_LYRIC_DURATION_MS,
    MAX_BEAT_EDITS: MAX_BEAT_EDITS,
    create: create,
    validate: validate,
    import: importSpec,
    export: exportSpec,
    createProductionSpec: create,
    validateProductionSpec: validate,
    importProductionSpec: importSpec,
    exportProductionSpec: exportSpec,
    activeLyricsAt: activeLyricsAt,
    beatEditAt: beatEditAt,
    nearbyBeatEdits: nearbyBeatEdits
  });
}));
