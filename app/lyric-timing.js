/*
 * Signal Field — local lyric timing draft
 *
 * Creates a deterministic, editable line-level timing draft from plain-text
 * lyrics and the existing local music analysis. This is intentionally not
 * speech recognition or word-level forced alignment.
 */
(function attachLyricTiming(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldLyricTiming = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLyricTiming() {
  'use strict';

  const VERSION = '1.0.0';
  const ANALYSIS_SCHEMA = 'signal-field/music-analysis';
  const MAX_LINES = 5000;
  const MAX_LINE_LENGTH = 500;
  const MIN_CUE_MS = 100;

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function finite(value, minimum, maximum, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    if (value < minimum || value > maximum) throw new RangeError(label + ' must be between ' + minimum + ' and ' + maximum + '.');
    return value;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeLines(serialized) {
    if (typeof serialized !== 'string') throw new TypeError('Plain-text lyrics must be a string.');
    const lines = [];
    serialized.split(/\r?\n/).forEach(function normalize(line, index) {
      const text = line.trim();
      if (!text) return;
      if (/^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(text)) {
        throw new Error('Timed LRC is already present; import it directly instead of generating a timing draft.');
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        throw new RangeError('Lyric line ' + (index + 1) + ' contains unsupported control characters.');
      }
      if (text.length > MAX_LINE_LENGTH) throw new RangeError('Lyric line ' + (index + 1) + ' exceeds ' + MAX_LINE_LENGTH + ' characters.');
      lines.push(text);
      if (lines.length > MAX_LINES) throw new RangeError('Plain-text lyrics exceed ' + MAX_LINES + ' lines.');
    });
    if (!lines.length) throw new RangeError('Paste at least one non-empty lyric line.');
    return lines;
  }

  function validateAnalysis(input) {
    if (!isPlainObject(input) || input.schema !== ANALYSIS_SCHEMA || input.version !== 1) {
      throw new TypeError('A local signal-field/music-analysis v1 result is required.');
    }
    const durationMs = Math.round(finite(input.durationMs, 1, 30 * 60 * 1000, 'analysis.durationMs'));
    if (!Array.isArray(input.frames) || !input.frames.length || input.frames.length > 24000) {
      throw new RangeError('analysis.frames must contain between 1 and 24000 entries.');
    }
    if (!Array.isArray(input.sections) || !input.sections.length || input.sections.length > 12) {
      throw new RangeError('analysis.sections must contain between 1 and 12 entries.');
    }
    const tempo = isPlainObject(input.tempo) ? input.tempo : {};
    const beatMs = finite(tempo.beatMs == null ? 0 : tempo.beatMs, 0, 1000, 'analysis.tempo.beatMs');
    const tempoConfidence = finite(tempo.confidence == null ? 0 : tempo.confidence, 0, 1, 'analysis.tempo.confidence');
    let previousTime = -1;
    input.frames.forEach(function validateFrame(frame, index) {
      if (!isPlainObject(frame)) throw new TypeError('analysis.frames[' + index + '] must be an object.');
      const timeMs = finite(frame.timeMs, 0, durationMs, 'analysis.frames[' + index + '].timeMs');
      finite(frame.energy, 0, 2, 'analysis.frames[' + index + '].energy');
      finite(frame.flux, 0, 1, 'analysis.frames[' + index + '].flux');
      if (timeMs < previousTime) throw new RangeError('analysis frame times must be ordered.');
      previousTime = timeMs;
    });
    let previousEnd = 0;
    input.sections.forEach(function validateSection(section, index) {
      if (!isPlainObject(section)) throw new TypeError('analysis.sections[' + index + '] must be an object.');
      const startMs = finite(section.startMs, 0, durationMs, 'analysis.sections[' + index + '].startMs');
      const endMs = finite(section.endMs, startMs, durationMs, 'analysis.sections[' + index + '].endMs');
      if (endMs <= startMs || startMs < previousEnd) throw new RangeError('analysis sections must be ordered, non-overlapping, and positive.');
      if (!['quiet', 'transition', 'percussive', 'bright', 'flowing'].includes(section.kind)) {
        throw new RangeError('analysis.sections[' + index + '].kind is invalid.');
      }
      previousEnd = endMs;
    });
    return { durationMs: durationMs, beatMs: beatMs, tempoConfidence: tempoConfidence };
  }

  function meaningfulWindow(analysis, durationMs, lineCount, options) {
    const frames = analysis.frames;
    const averageEnergy = frames.reduce(function sum(total, frame) { return total + frame.energy; }, 0) / frames.length;
    const threshold = Math.max(0.025, averageEnergy * 0.22);
    const active = frames.filter(function audible(frame) { return frame.energy >= threshold || frame.flux >= 0.035; });
    const frameStep = frames.length > 1 ? Math.max(1, frames[1].timeMs - frames[0].timeMs) : 100;
    let startMs = active.length ? active[0].timeMs : 0;
    let endMs = active.length ? Math.min(durationMs, active[active.length - 1].timeMs + frameStep) : durationMs;

    const firstSection = analysis.sections[0];
    const lastSection = analysis.sections[analysis.sections.length - 1];
    if (firstSection && firstSection.kind === 'quiet' && firstSection.endMs < durationMs * 0.45) {
      startMs = Math.max(startMs, firstSection.endMs);
    } else {
      startMs = Math.max(startMs, Math.min(8000, durationMs * 0.04));
    }
    if (lastSection && lastSection.kind === 'quiet' && lastSection.startMs > durationMs * 0.55) {
      endMs = Math.min(endMs, lastSection.startMs);
    } else {
      endMs = Math.min(endMs, durationMs - Math.min(4000, durationMs * 0.02));
    }

    if (own(options, 'introMs')) startMs = finite(options.introMs, 0, durationMs, 'introMs');
    if (own(options, 'outroMs')) endMs = durationMs - finite(options.outroMs, 0, durationMs, 'outroMs');
    startMs = Math.round(clamp(startMs, 0, Math.max(0, durationMs - MIN_CUE_MS)));
    endMs = Math.round(clamp(endMs, startMs + MIN_CUE_MS, durationMs));
    if (endMs - startMs < lineCount * MIN_CUE_MS) {
      startMs = 0;
      endMs = durationMs;
    }
    if (endMs - startMs < lineCount * MIN_CUE_MS) {
      throw new RangeError('The selected song range is too short for ' + lineCount + ' lyric lines.');
    }
    return { startMs: startMs, endMs: endMs, averageEnergy: averageEnergy };
  }

  function lineWeight(text) {
    const visibleLength = Array.from(text.replace(/\s+/g, '')).length;
    return 1 + Math.sqrt(Math.max(1, visibleLength));
  }

  function snapBoundary(value, beatMs, enabled) {
    if (!enabled || beatMs <= 0) return value;
    const snapped = Math.round(value / beatMs) * beatMs;
    return Math.abs(snapped - value) <= Math.min(180, beatMs * 0.24) ? snapped : value;
  }

  function createDraft(serialized, analysisInput, optionsInput) {
    const options = optionsInput == null ? {} : optionsInput;
    if (!isPlainObject(options)) throw new TypeError('Lyric timing options must be a plain object.');
    Object.keys(options).forEach(function rejectUnknown(key) {
      if (!['introMs', 'outroMs', 'snapToBeat'].includes(key)) throw new RangeError('Unknown lyric timing option: ' + key + '.');
    });
    if (own(options, 'snapToBeat') && typeof options.snapToBeat !== 'boolean') throw new TypeError('snapToBeat must be a boolean.');

    const lines = normalizeLines(serialized);
    const analysisInfo = validateAnalysis(analysisInput);
    const window = meaningfulWindow(analysisInput, analysisInfo.durationMs, lines.length, options);
    const weights = lines.map(lineWeight);
    const totalWeight = weights.reduce(function sum(total, value) { return total + value; }, 0);
    const boundaries = [window.startMs];
    let cumulative = 0;
    const snapEnabled = options.snapToBeat !== false && analysisInfo.tempoConfidence >= 0.25 && analysisInfo.beatMs > 0;

    for (let index = 1; index < lines.length; index += 1) {
      cumulative += weights[index - 1];
      const raw = window.startMs + (window.endMs - window.startMs) * cumulative / totalWeight;
      const snapped = snapBoundary(raw, analysisInfo.beatMs, snapEnabled);
      const minimum = boundaries[index - 1] + MIN_CUE_MS;
      const remaining = lines.length - index;
      const maximum = window.endMs - remaining * MIN_CUE_MS;
      boundaries.push(Math.round(clamp(snapped, minimum, maximum)));
    }
    boundaries.push(window.endMs);

    const lyrics = lines.map(function buildCue(text, index) {
      const startMs = boundaries[index];
      const nextStart = boundaries[index + 1];
      const available = nextStart - startMs;
      const gap = index + 1 < lines.length ? Math.min(120, Math.max(0, Math.floor(available * 0.06))) : 0;
      return { startMs: startMs, endMs: Math.max(startMs + MIN_CUE_MS, nextStart - gap), text: text };
    });
    const confidence = Math.round(clamp(
      0.2 + analysisInfo.tempoConfidence * 0.22 + (analysisInput.sections.length > 1 ? 0.1 : 0.03) +
      (window.averageEnergy > 0.03 ? 0.08 : 0),
      0.2,
      0.6
    ) * 100) / 100;

    return {
      lyrics: lyrics,
      diagnostics: {
        method: 'structure-and-line-weight',
        confidence: confidence,
        startMs: window.startMs,
        endMs: window.endMs,
        beatSnapped: snapEnabled,
        requiresReview: true,
        speechAligned: false
      }
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    MAX_LINES: MAX_LINES,
    createDraft: createDraft
  });
}));
