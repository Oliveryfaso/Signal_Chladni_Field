/*
 * Signal Field — bounded local production-session persistence
 *
 * Stores only a validated Production Spec, creator choices, canonical editor
 * values, and allowlisted audio identity metadata. Audio bytes, paths, PCM,
 * waveform peaks, DOM state, and object URLs are deliberately out of scope.
 */
(function attachProductionSession(globalScope, factory) {
  const production = typeof module === 'object' && module.exports
    ? require('./production-spec.js')
    : globalScope && globalScope.SignalFieldProductionSpec;
  const api = factory(production);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldProductionSession = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createProductionSessionCore(Production) {
  'use strict';

  if (!Production || typeof Production.import !== 'function' || typeof Production.export !== 'function') {
    throw new Error('SignalFieldProductionSpec must load before SignalFieldProductionSession.');
  }

  const VERSION = '1.0.0';
  const SCHEMA = 'signal-field-production-session/v1';
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'signalFieldProductionSessionV1';
  const MAX_SESSION_BYTES = 4 * 1024 * 1024;
  const MAX_AUDIO_NAME_LENGTH = 255;
  const MAX_AUDIO_TYPE_LENGTH = 120;
  const MAX_AUDIO_SIZE = Number.MAX_SAFE_INTEGER;
  const MAX_AUDIO_DURATION_MS = Production.MAX_DURATION_MS;
  const TEMPLATES = Object.freeze(['ambient-orbit', 'pulse-cut', 'sand-study']);
  const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function requirePlain(value, label) {
    if (!isPlainObject(value)) throw new TypeError(label + ' must be a plain object.');
    return value;
  }

  function rejectUnknown(object, allowed, label) {
    Object.keys(object).forEach(function checkKey(key) {
      if (allowed.indexOf(key) < 0) throw new RangeError('Unknown ' + label + ' property: ' + key + '.');
    });
  }

  function requireFinite(value, minimum, maximum, label, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    if ((integer && !Number.isInteger(value)) || value < minimum || value > maximum) {
      throw new RangeError(label + ' must be ' + (integer ? 'an integer ' : '') + 'between ' + minimum + ' and ' + maximum + '.');
    }
    return value;
  }

  function requireString(value, maximum, label, allowEmpty) {
    if (typeof value !== 'string') throw new TypeError(label + ' must be a string.');
    if (value.length > maximum) throw new RangeError(label + ' exceeds ' + maximum + ' characters.');
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new RangeError(label + ' contains unsupported control characters.');
    const normalized = value.trim();
    if (!allowEmpty && !normalized) throw new RangeError(label + ' cannot be empty.');
    return normalized;
  }

  function requireEnum(value, allowed, label) {
    if (allowed.indexOf(value) < 0) throw new RangeError(label + ' must be one of: ' + allowed.join(', ') + '.');
    return value;
  }

  function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) throw new RangeError('Session text contains an unpaired surrogate.');
        bytes += 4;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new RangeError('Session text contains an unpaired surrogate.');
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
      if (typeof item === 'string') { utf8ByteLength(item); return; }
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function equalJson(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every(function equalItem(value, index) { return equalJson(value, right[index]); });
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every(function equalKey(key) {
      return own(right, key) && equalJson(left[key], right[key]);
    });
  }

  function fingerprintText(value) {
    let first = 2166136261;
    let second = 2246822507;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619) >>> 0;
      second = Math.imul(second ^ code, 3266489909) >>> 0;
    }
    return 'sf1-' + first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
  }

  function normalizeAudioCore(input, label) {
    const source = requirePlain(input, label);
    rejectUnknown(source, ['name', 'size', 'type', 'lastModified', 'durationMs', 'fingerprint'], label);
    const result = {
      name: requireString(source.name, MAX_AUDIO_NAME_LENGTH, label + '.name', false),
      size: requireFinite(source.size, 0, MAX_AUDIO_SIZE, label + '.size', true),
      type: requireString(source.type, MAX_AUDIO_TYPE_LENGTH, label + '.type', true).toLowerCase(),
      lastModified: requireFinite(source.lastModified, 0, MAX_AUDIO_SIZE, label + '.lastModified', true),
      durationMs: requireFinite(source.durationMs, 0, MAX_AUDIO_DURATION_MS, label + '.durationMs', true)
    };
    const identity = [result.name, result.size, result.type, result.lastModified, result.durationMs].join('\u001f');
    result.fingerprint = fingerprintText(identity);
    if (own(source, 'fingerprint') && source.fingerprint !== result.fingerprint) {
      throw new RangeError(label + '.fingerprint does not match its audio metadata.');
    }
    return result;
  }

  function createAudioMetadata(fileLike, durationMs) {
    if (!fileLike || typeof fileLike !== 'object') throw new TypeError('Audio file must be an object.');
    return normalizeAudioCore({
      name: fileLike.name,
      size: fileLike.size,
      type: fileLike.type || '',
      lastModified: fileLike.lastModified || 0,
      durationMs: Math.round(durationMs)
    }, 'audio');
  }

  function normalizeEditor(input, productionSpec) {
    const source = input == null ? {} : requirePlain(input, 'editor');
    rejectUnknown(source, ['lyrics', 'manualBeatEdits'], 'editor');
    const lyrics = own(source, 'lyrics') ? source.lyrics : (productionSpec ? productionSpec.lyrics : []);
    const manualBeatEdits = own(source, 'manualBeatEdits') ? source.manualBeatEdits : null;
    if (!Array.isArray(lyrics)) throw new TypeError('editor.lyrics must be an array.');
    if (manualBeatEdits !== null && !Array.isArray(manualBeatEdits)) throw new TypeError('editor.manualBeatEdits must be null or an array.');
    if (!productionSpec && (lyrics.length || (manualBeatEdits && manualBeatEdits.length))) {
      throw new RangeError('Editor lyrics and beat edits require a Production Spec.');
    }
    if (productionSpec && !equalJson(lyrics, productionSpec.lyrics)) {
      throw new RangeError('editor.lyrics must match productionSpec.lyrics.');
    }
    if (productionSpec && manualBeatEdits !== null && !equalJson(manualBeatEdits, productionSpec.beatEdits)) {
      throw new RangeError('editor.manualBeatEdits must match productionSpec.beatEdits.');
    }
    return { lyrics: clone(lyrics), manualBeatEdits: manualBeatEdits === null ? null : clone(manualBeatEdits) };
  }

  function create(input) {
    const source = input == null ? {} : requirePlain(input, 'Production session');
    assertSafeJson(source, 'Production session');
    rejectUnknown(source, ['schema', 'version', 'productionSpec', 'selectedTemplate', 'selectedAspect', 'editor', 'audio'], 'production session');
    if (own(source, 'schema') && source.schema !== SCHEMA) throw new RangeError('Unsupported production session schema.');
    if (own(source, 'version') && source.version !== SCHEMA_VERSION) throw new RangeError('Unsupported production session version.');
    const productionSpec = source.productionSpec == null ? null : Production.import(source.productionSpec);
    const selectedTemplate = requireEnum(own(source, 'selectedTemplate') ? source.selectedTemplate : 'ambient-orbit', TEMPLATES, 'selectedTemplate');
    const selectedAspect = requireEnum(
      own(source, 'selectedAspect') ? source.selectedAspect : (productionSpec ? productionSpec.aspect : '16:9'),
      Production.ASPECTS,
      'selectedAspect'
    );
    if (productionSpec && selectedAspect !== productionSpec.aspect) {
      throw new RangeError('selectedAspect must match productionSpec.aspect.');
    }
    const editor = normalizeEditor(source.editor, productionSpec);
    const audio = source.audio == null ? null : normalizeAudioCore(source.audio, 'audio');
    const session = {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      productionSpec: productionSpec,
      selectedTemplate: selectedTemplate,
      selectedAspect: selectedAspect,
      editor: editor,
      audio: audio
    };
    const serialized = JSON.stringify(session);
    if (utf8ByteLength(serialized) > MAX_SESSION_BYTES) throw new RangeError('Production session exceeds the 4 MB local-storage limit.');
    return clone(session);
  }

  function parse(input) {
    let parsed = input;
    if (typeof input === 'string') {
      if (utf8ByteLength(input) > MAX_SESSION_BYTES) throw new RangeError('Production session JSON exceeds the 4 MB local-storage limit.');
      try { parsed = JSON.parse(input); } catch (error) { throw new SyntaxError('Invalid production session JSON: ' + error.message); }
    }
    assertSafeJson(parsed, 'Production session');
    const canonical = create(parsed);
    if (!equalJson(parsed, canonical)) throw new TypeError('Production session is not in canonical form.');
    return canonical;
  }

  function serialize(input, options) {
    const session = create(input);
    const settings = options == null ? {} : requirePlain(options, 'Serialization options');
    rejectUnknown(settings, ['pretty'], 'serialization option');
    if (own(settings, 'pretty') && typeof settings.pretty !== 'boolean') throw new TypeError('serialization option pretty must be a boolean.');
    const output = JSON.stringify(session, null, settings.pretty ? 2 : 0);
    if (utf8ByteLength(output) > MAX_SESSION_BYTES) throw new RangeError('Production session exceeds the 4 MB local-storage limit.');
    return output;
  }

  function matchesAudio(savedAudio, fileLike, durationMs) {
    if (savedAudio == null) return false;
    let saved;
    let candidate;
    try {
      saved = normalizeAudioCore(savedAudio, 'saved audio');
      candidate = createAudioMetadata(fileLike, durationMs);
    } catch (_error) {
      return false;
    }
    return equalJson(saved, candidate);
  }

  function requireStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      throw new TypeError('Storage must provide getItem, setItem, and removeItem.');
    }
    return storage;
  }

  function save(storage, input, key) {
    try {
      const target = requireStorage(storage);
      const storageKey = key == null ? STORAGE_KEY : requireString(key, 160, 'Storage key', false);
      const serialized = serialize(input);
      target.setItem(storageKey, serialized);
      return { ok: true, session: parse(serialized), error: null };
    } catch (error) {
      return { ok: false, session: null, error: error && error.message ? error.message : String(error) };
    }
  }

  function load(storage, key) {
    try {
      const target = requireStorage(storage);
      const storageKey = key == null ? STORAGE_KEY : requireString(key, 160, 'Storage key', false);
      const serialized = target.getItem(storageKey);
      if (serialized == null) return { ok: true, status: 'empty', session: null, error: null };
      return { ok: true, status: 'restored', session: parse(serialized), error: null };
    } catch (error) {
      return { ok: false, status: 'invalid', session: null, error: error && error.message ? error.message : String(error) };
    }
  }

  function clear(storage, key) {
    try {
      const target = requireStorage(storage);
      const storageKey = key == null ? STORAGE_KEY : requireString(key, 160, 'Storage key', false);
      target.removeItem(storageKey);
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }

  return Object.freeze({
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    MAX_SESSION_BYTES: MAX_SESSION_BYTES,
    TEMPLATES: TEMPLATES,
    create: create,
    parse: parse,
    serialize: serialize,
    save: save,
    load: load,
    clear: clear,
    createAudioMetadata: createAudioMetadata,
    matchesAudio: matchesAudio
  });
}));
