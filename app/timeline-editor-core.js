/*
 * Signal Field — timeline editor core
 *
 * Dependency-free waveform, coordinate, and constrained edit utilities.
 * This module does not mutate or extend the Production Spec schema.
 */
(function attachTimelineEditorCore(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldTimelineEditorCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTimelineEditorCore() {
  'use strict';

  const VERSION = '1.0.0';
  const WAVEFORM_SCHEMA = 'signal-field/timeline-waveform';
  const WAVEFORM_VERSION = 1;
  const PRODUCTION_SCHEMA = 'signal-field-production/v1';
  const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
  const MAX_BUCKETS = 8192;
  const MAX_CHANNELS = 32;
  const MAX_SAMPLES_PER_CHANNEL = 250000000;
  const MAX_BEAT_GRID_POINTS = 100000;
  const MAX_LYRICS = 5000;
  const MAX_BEAT_EDITS = 20000;
  const HANDLES = Object.freeze(['start', 'end', 'range']);
  const BEAT_ACTIONS = Object.freeze(['cut', 'accent', 'hold']);

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function requirePlain(value, label) {
    if (!isPlainObject(value)) throw new TypeError(label + ' must be a plain object.');
    return value;
  }

  function rejectUnknown(object, allowed, label) {
    Object.keys(object).forEach(function rejectKey(key) {
      if (allowed.indexOf(key) < 0) throw new RangeError('Unknown ' + label + ' property: ' + key + '.');
    });
  }

  function finite(value, minimum, maximum, label, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    if ((integer && !Number.isInteger(value)) || value < minimum || value > maximum) {
      throw new RangeError(label + ' must be ' + (integer ? 'an integer ' : '') + 'between ' + minimum + ' and ' + maximum + '.');
    }
    return value;
  }

  function enumValue(value, allowed, label) {
    if (allowed.indexOf(value) < 0) throw new RangeError(label + ' must be one of: ' + allowed.join(', ') + '.');
    return value;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function round(value, places) {
    const multiplier = Math.pow(10, places == null ? 6 : places);
    return Math.round(value * multiplier) / multiplier;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requireDenseArray(value, maximum, label) {
    if (!Array.isArray(value) || value.length > maximum) throw new RangeError(label + ' must be an array with at most ' + maximum + ' entries.');
    if (Object.keys(value).length !== value.length) throw new TypeError(label + ' must be a dense array without custom properties.');
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, String(index))) throw new TypeError(label + ' must not contain sparse entries.');
    }
    return value;
  }

  function isSampleChannel(value) {
    return value instanceof Float32Array || value instanceof Float64Array || Array.isArray(value);
  }

  function isTypedSampleChannel(value) {
    return value instanceof Float32Array || value instanceof Float64Array;
  }

  function normalizeAudioInput(input, options) {
    let channels;
    let sampleRate;
    let declaredLength = null;
    const audioBufferLike = input && typeof input === 'object' &&
      typeof input.getChannelData === 'function' && own(Object(input), 'numberOfChannels') ||
      (input && typeof input === 'object' && typeof input.getChannelData === 'function' && Number.isFinite(input.numberOfChannels));

    if (audioBufferLike) {
      const count = finite(input.numberOfChannels, 1, MAX_CHANNELS, 'AudioBuffer.numberOfChannels', true);
      declaredLength = finite(input.length, 1, MAX_SAMPLES_PER_CHANNEL, 'AudioBuffer.length', true);
      sampleRate = finite(input.sampleRate, 8000, 384000, 'AudioBuffer.sampleRate', false);
      channels = [];
      for (let index = 0; index < count; index += 1) {
        const channel = input.getChannelData(index);
        if (!(channel instanceof Float32Array) || channel.length !== declaredLength) {
          throw new TypeError('AudioBuffer.getChannelData(' + index + ') must return a matching Float32Array.');
        }
        channels.push(channel);
      }
    } else {
      const source = requirePlain(input, 'PCM input');
      rejectUnknown(source, ['samples', 'channels', 'sampleRate'], 'PCM input');
      sampleRate = finite(source.sampleRate, 8000, 384000, 'PCM sampleRate', false);
      if (own(source, 'samples') === own(source, 'channels')) {
        throw new TypeError('PCM input requires exactly one of samples or channels.');
      }
      if (own(source, 'samples')) channels = [source.samples];
      else if (isTypedSampleChannel(source.channels) || (Array.isArray(source.channels) && typeof source.channels[0] === 'number')) {
        channels = [source.channels];
      } else channels = source.channels;
      requireDenseArray(channels, MAX_CHANNELS, 'PCM channels');
      if (!channels.length) throw new RangeError('PCM channels cannot be empty.');
      channels.forEach(function checkChannel(channel, index) {
        if (!isSampleChannel(channel) || !channel.length) throw new TypeError('PCM channel[' + index + '] must be a non-empty normalized numeric channel.');
        if (Array.isArray(channel)) requireDenseArray(channel, MAX_SAMPLES_PER_CHANNEL, 'PCM channel[' + index + ']');
        if (index === 0) declaredLength = channel.length;
        if (channel.length !== declaredLength) throw new RangeError('PCM channels must have matching lengths.');
      });
      finite(declaredLength, 1, MAX_SAMPLES_PER_CHANNEL, 'PCM channel length', true);
    }

    const actualDurationMs = declaredLength / sampleRate * 1000;
    if (actualDurationMs > MAX_DURATION_MS) throw new RangeError('Audio exceeds the maximum timeline duration of ' + MAX_DURATION_MS + ' ms.');
    const requestedDuration = own(options, 'durationMs')
      ? finite(options.durationMs, 1 / sampleRate * 1000, actualDurationMs, 'durationMs', false)
      : actualDurationMs;
    const sampleCount = Math.min(declaredLength, Math.max(1, Math.ceil(requestedDuration / 1000 * sampleRate)));
    return { channels: channels, sampleRate: sampleRate, sampleCount: sampleCount, durationMs: requestedDuration };
  }

  function buildWaveform(input, optionsInput) {
    const options = optionsInput == null ? {} : requirePlain(optionsInput, 'Waveform options');
    rejectUnknown(options, ['bucketCount', 'durationMs'], 'waveform option');
    const audio = normalizeAudioInput(input, options);
    const requestedBuckets = own(options, 'bucketCount')
      ? finite(options.bucketCount, 1, MAX_BUCKETS, 'bucketCount', true)
      : Math.min(1024, audio.sampleCount);
    const bucketCount = Math.min(requestedBuckets, audio.sampleCount);
    const buckets = [];

    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
      const startSample = Math.floor(bucketIndex * audio.sampleCount / bucketCount);
      const endSample = Math.max(startSample + 1, Math.floor((bucketIndex + 1) * audio.sampleCount / bucketCount));
      let minimum = 1;
      let maximum = -1;
      for (let channelIndex = 0; channelIndex < audio.channels.length; channelIndex += 1) {
        const channel = audio.channels[channelIndex];
        for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
          const sample = channel[sampleIndex];
          if (typeof sample !== 'number' || !Number.isFinite(sample)) {
            throw new TypeError('PCM sample [' + channelIndex + '][' + sampleIndex + '] must be finite.');
          }
          if (sample < -1 || sample > 1) throw new RangeError('PCM samples must be normalized between -1 and 1.');
          minimum = Math.min(minimum, sample);
          maximum = Math.max(maximum, sample);
        }
      }
      buckets.push({
        index: bucketIndex,
        startMs: round(startSample / audio.sampleRate * 1000),
        endMs: round(Math.min(audio.durationMs, endSample / audio.sampleRate * 1000)),
        min: round(minimum),
        max: round(maximum)
      });
    }

    return {
      schema: WAVEFORM_SCHEMA,
      version: WAVEFORM_VERSION,
      sampleRate: audio.sampleRate,
      channelCount: audio.channels.length,
      sampleCount: audio.sampleCount,
      durationMs: round(audio.durationMs),
      bucketCount: bucketCount,
      buckets: buckets
    };
  }

  function timelineDimensions(durationMs, width) {
    return {
      durationMs: finite(durationMs, 1, MAX_DURATION_MS, 'durationMs', true),
      width: finite(width, 1, 16384, 'width', false)
    };
  }

  function timeToX(timeMs, durationMs, width) {
    const timeline = timelineDimensions(durationMs, width);
    const time = finite(timeMs, -MAX_DURATION_MS, MAX_DURATION_MS * 2, 'timeMs', false);
    return round(clamp(time, 0, timeline.durationMs) / timeline.durationMs * timeline.width);
  }

  function xToTime(x, durationMs, width) {
    const timeline = timelineDimensions(durationMs, width);
    const position = finite(x, -16384, 32768, 'x', false);
    return Math.round(clamp(position, 0, timeline.width) / timeline.width * timeline.durationMs);
  }

  function validateLyrics(lyricsInput, durationMs, minimumDurationMs) {
    const lyrics = requireDenseArray(lyricsInput, MAX_LYRICS, 'lyrics');
    let previousEnd = 0;
    lyrics.forEach(function validateCue(cue, index) {
      const label = 'lyrics[' + index + ']';
      requirePlain(cue, label);
      rejectUnknown(cue, ['startMs', 'endMs', 'text'], label);
      const startMs = finite(cue.startMs, 0, durationMs, label + '.startMs', true);
      const endMs = finite(cue.endMs, 0, durationMs, label + '.endMs', true);
      if (endMs - startMs < minimumDurationMs) throw new RangeError(label + ' must be at least ' + minimumDurationMs + ' ms long.');
      if (index && startMs < previousEnd) throw new RangeError('lyrics must be ordered and must not overlap.');
      if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 500) throw new RangeError(label + '.text must contain 1 to 500 characters.');
      previousEnd = endMs;
    });
    return lyrics;
  }

  function validateBeatEdits(editsInput, durationMs) {
    const edits = requireDenseArray(editsInput, MAX_BEAT_EDITS, 'beatEdits');
    let previousTime = -1;
    edits.forEach(function validateEdit(edit, index) {
      const label = 'beatEdits[' + index + ']';
      requirePlain(edit, label);
      rejectUnknown(edit, ['timeMs', 'action', 'intensity', 'targetSceneId'], label);
      const timeMs = finite(edit.timeMs, 0, durationMs, label + '.timeMs', true);
      if (timeMs <= previousTime) throw new RangeError('beatEdits must be strictly ordered with unique times.');
      enumValue(edit.action, BEAT_ACTIONS, label + '.action');
      if (own(edit, 'intensity')) finite(edit.intensity, 0, 1, label + '.intensity', false);
      if (own(edit, 'targetSceneId') && edit.targetSceneId !== null && (typeof edit.targetSceneId !== 'string' || !/^[a-zA-Z0-9._-]{1,96}$/.test(edit.targetSceneId))) {
        throw new RangeError(label + '.targetSceneId is invalid.');
      }
      previousTime = timeMs;
    });
    return edits;
  }

  function mapLyrics(lyrics, durationMs, width) {
    const timeline = timelineDimensions(durationMs, width);
    return validateLyrics(lyrics, timeline.durationMs, 1).map(function mapCue(cue, index) {
      const xStart = timeToX(cue.startMs, timeline.durationMs, timeline.width);
      const xEnd = timeToX(cue.endMs, timeline.durationMs, timeline.width);
      return { index: index, startMs: cue.startMs, endMs: cue.endMs, text: cue.text, xStart: xStart, xEnd: xEnd, width: round(xEnd - xStart) };
    });
  }

  function mapBeatEdits(edits, durationMs, width) {
    const timeline = timelineDimensions(durationMs, width);
    return validateBeatEdits(edits, timeline.durationMs).map(function mapEdit(edit, index) {
      return Object.assign({ index: index, x: timeToX(edit.timeMs, timeline.durationMs, timeline.width) }, clone(edit));
    });
  }

  function mapProduction(spec, width) {
    const source = requirePlain(spec, 'Production specification');
    if (source.schema !== PRODUCTION_SCHEMA || source.version !== 1 || !isPlainObject(source.project) || !isPlainObject(source.project.timeline)) {
      throw new TypeError('A canonical signal-field-production/v1 specification is required.');
    }
    const durationMs = finite(source.project.timeline.durationMs, 1, MAX_DURATION_MS, 'Production durationMs', true);
    const timeline = timelineDimensions(durationMs, width);
    return {
      durationMs: durationMs,
      width: timeline.width,
      lyrics: mapLyrics(source.lyrics, durationMs, timeline.width),
      beatEdits: mapBeatEdits(source.beatEdits, durationMs, timeline.width)
    };
  }

  function normalizeLyricMove(operationInput) {
    const operation = requirePlain(operationInput, 'Lyric move operation');
    if (operation.type === 'drag') {
      rejectUnknown(operation, ['type', 'handle', 'deltaMs'], 'lyric drag operation');
      return {
        handle: enumValue(operation.handle, HANDLES, 'Lyric drag handle'),
        deltaMs: Math.round(finite(operation.deltaMs, -MAX_DURATION_MS, MAX_DURATION_MS, 'Lyric drag deltaMs', false))
      };
    }
    if (operation.type === 'keyboard') {
      rejectUnknown(operation, ['type', 'handle', 'direction', 'stepMs'], 'lyric keyboard operation');
      const direction = finite(operation.direction, -1, 1, 'Lyric keyboard direction', true);
      if (direction !== -1 && direction !== 1) throw new RangeError('Lyric keyboard direction must be -1 or 1.');
      const stepMs = own(operation, 'stepMs') ? finite(operation.stepMs, 1, 60000, 'Lyric keyboard stepMs', true) : 10;
      return { handle: enumValue(operation.handle, HANDLES, 'Lyric keyboard handle'), deltaMs: direction * stepMs };
    }
    throw new RangeError('Lyric move type must be drag or keyboard.');
  }

  function moveLyric(lyricsInput, indexInput, operation, optionsInput) {
    const options = requirePlain(optionsInput, 'Lyric move options');
    rejectUnknown(options, ['durationMs', 'minimumDurationMs'], 'lyric move option');
    const durationMs = finite(options.durationMs, 1, MAX_DURATION_MS, 'Lyric move durationMs', true);
    const minimumDurationMs = own(options, 'minimumDurationMs')
      ? finite(options.minimumDurationMs, 1, durationMs, 'minimumDurationMs', true)
      : 100;
    const lyrics = validateLyrics(lyricsInput, durationMs, minimumDurationMs);
    const index = finite(indexInput, 0, Math.max(0, lyrics.length - 1), 'Lyric index', true);
    if (!lyrics.length) throw new RangeError('Cannot move a lyric in an empty collection.');
    const move = normalizeLyricMove(operation);
    const result = clone(lyrics);
    const cue = result[index];
    const previousEnd = index ? result[index - 1].endMs : 0;
    const nextStart = index + 1 < result.length ? result[index + 1].startMs : durationMs;

    if (move.handle === 'start') {
      cue.startMs = clamp(cue.startMs + move.deltaMs, previousEnd, cue.endMs - minimumDurationMs);
    } else if (move.handle === 'end') {
      cue.endMs = clamp(cue.endMs + move.deltaMs, cue.startMs + minimumDurationMs, nextStart);
    } else {
      const length = cue.endMs - cue.startMs;
      const targetStart = clamp(cue.startMs + move.deltaMs, previousEnd, nextStart - length);
      cue.startMs = targetStart;
      cue.endMs = targetStart + length;
    }
    return result;
  }

  function buildBeatGrid(optionsInput) {
    const options = requirePlain(optionsInput, 'Beat grid options');
    rejectUnknown(options, ['durationMs', 'beatMs', 'beatOffsetMs'], 'beat grid option');
    const durationMs = finite(options.durationMs, 1, MAX_DURATION_MS, 'Beat grid durationMs', true);
    const beatMs = finite(options.beatMs, 1, 60000, 'beatMs', false);
    const offset = own(options, 'beatOffsetMs') ? finite(options.beatOffsetMs, 0, durationMs, 'beatOffsetMs', false) : 0;
    const estimated = Math.floor((durationMs - offset) / beatMs) + 1;
    if (estimated > MAX_BEAT_GRID_POINTS) throw new RangeError('Beat grid exceeds ' + MAX_BEAT_GRID_POINTS + ' points.');
    const grid = [];
    let previous = -1;
    for (let index = 0; index < estimated; index += 1) {
      const timeMs = Math.round(offset + index * beatMs);
      if (timeMs > durationMs) break;
      if (timeMs > previous) grid.push(timeMs);
      previous = timeMs;
    }
    return grid;
  }

  function validateBeatGrid(gridInput, durationMs) {
    const grid = requireDenseArray(gridInput, MAX_BEAT_GRID_POINTS, 'beatGridMs');
    if (!grid.length) throw new RangeError('beatGridMs cannot be empty when snapping is enabled.');
    let previous = -1;
    return grid.map(function validatePoint(point, index) {
      const timeMs = finite(point, 0, durationMs, 'beatGridMs[' + index + ']', true);
      if (timeMs <= previous) throw new RangeError('beatGridMs must be strictly ordered with unique points.');
      previous = timeMs;
      return timeMs;
    });
  }

  function normalizeBeatMove(operationInput, currentTime) {
    const operation = requirePlain(operationInput, 'Beat move operation');
    if (operation.type === 'drag') {
      rejectUnknown(operation, ['type', 'timeMs'], 'beat drag operation');
      return Math.round(finite(operation.timeMs, -MAX_DURATION_MS, MAX_DURATION_MS * 2, 'Beat drag timeMs', false));
    }
    if (operation.type === 'keyboard') {
      rejectUnknown(operation, ['type', 'direction', 'stepMs'], 'beat keyboard operation');
      const direction = finite(operation.direction, -1, 1, 'Beat keyboard direction', true);
      if (direction !== -1 && direction !== 1) throw new RangeError('Beat keyboard direction must be -1 or 1.');
      const stepMs = own(operation, 'stepMs') ? finite(operation.stepMs, 1, 60000, 'Beat keyboard stepMs', true) : 10;
      return currentTime + direction * stepMs;
    }
    throw new RangeError('Beat move type must be drag or keyboard.');
  }

  function moveBeatEdit(editsInput, indexInput, operation, optionsInput) {
    const options = requirePlain(optionsInput, 'Beat move options');
    rejectUnknown(options, [
      'durationMs', 'minimumGapMs', 'snap', 'snapToleranceMs', 'beatGridMs', 'beatMs', 'beatOffsetMs'
    ], 'beat move option');
    const durationMs = finite(options.durationMs, 1, MAX_DURATION_MS, 'Beat move durationMs', true);
    const minimumGapMs = own(options, 'minimumGapMs') ? finite(options.minimumGapMs, 1, durationMs, 'minimumGapMs', true) : 1;
    const edits = validateBeatEdits(editsInput, durationMs);
    const index = finite(indexInput, 0, Math.max(0, edits.length - 1), 'Beat edit index', true);
    if (!edits.length) throw new RangeError('Cannot move a beat edit in an empty collection.');
    let target = normalizeBeatMove(operation, edits[index].timeMs);
    const minimum = index ? edits[index - 1].timeMs + minimumGapMs : 0;
    const maximum = index + 1 < edits.length ? edits[index + 1].timeMs - minimumGapMs : durationMs;
    if (minimum > maximum) throw new RangeError('Neighboring beat edits leave no valid move range.');
    target = clamp(target, minimum, maximum);

    if (own(options, 'snap') && typeof options.snap !== 'boolean') throw new TypeError('snap must be a boolean.');
    if (options.snap) {
      const hasExplicitGrid = own(options, 'beatGridMs');
      const hasTempoGrid = own(options, 'beatMs');
      if (hasExplicitGrid === hasTempoGrid) throw new TypeError('Snapping requires exactly one of beatGridMs or beatMs.');
      if (hasExplicitGrid && own(options, 'beatOffsetMs')) throw new TypeError('beatOffsetMs can only be used with beatMs.');
      const grid = hasExplicitGrid
        ? validateBeatGrid(options.beatGridMs, durationMs)
        : buildBeatGrid({ durationMs: durationMs, beatMs: options.beatMs, beatOffsetMs: own(options, 'beatOffsetMs') ? options.beatOffsetMs : 0 });
      const tolerance = own(options, 'snapToleranceMs')
        ? finite(options.snapToleranceMs, 0, 60000, 'snapToleranceMs', false)
        : 120;
      let nearest = null;
      let nearestDistance = Infinity;
      grid.forEach(function choose(point) {
        if (point < minimum || point > maximum) return;
        const distance = Math.abs(point - target);
        if (distance < nearestDistance || (distance === nearestDistance && point < nearest)) {
          nearest = point;
          nearestDistance = distance;
        }
      });
      if (nearest !== null && nearestDistance <= tolerance) target = nearest;
    } else if (own(options, 'beatGridMs') || own(options, 'beatMs') || own(options, 'beatOffsetMs') || own(options, 'snapToleranceMs')) {
      throw new TypeError('Beat grid options require snap: true.');
    }

    const result = clone(edits);
    result[index].timeMs = Math.round(target);
    return result;
  }

  return Object.freeze({
    VERSION: VERSION,
    WAVEFORM_SCHEMA: WAVEFORM_SCHEMA,
    WAVEFORM_VERSION: WAVEFORM_VERSION,
    MAX_DURATION_MS: MAX_DURATION_MS,
    MAX_BUCKETS: MAX_BUCKETS,
    buildWaveform: buildWaveform,
    timeToX: timeToX,
    xToTime: xToTime,
    mapLyrics: mapLyrics,
    mapBeatEdits: mapBeatEdits,
    mapProduction: mapProduction,
    moveLyric: moveLyric,
    moveBeatEdit: moveBeatEdit,
    buildBeatGrid: buildBeatGrid
  });
}));
