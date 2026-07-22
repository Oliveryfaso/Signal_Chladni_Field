/*
 * Signal Field — deterministic local music analysis and scene direction
 *
 * Pure, dependency-free data utilities. This module never reads files, creates
 * an AudioContext, touches the DOM, or calls a renderer.
 */
(function attachMusicDirector(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldMusicDirector = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMusicDirector() {
  'use strict';

  const VERSION = '1.0.0';
  const ANALYSIS_SCHEMA = 'signal-field/music-analysis';
  const PLAN_SCHEMA = 'signal-field/auto-direction-plan';
  const PROJECT_SCHEMA = 'signal-field/scene-project';
  const SNAPSHOT_SCHEMA = 'signal-field/scene-snapshot';
  const SCHEMA_VERSION = 1;
  const FFT_SIZE = 2048;
  const MAX_DURATION_MS = 30 * 60 * 1000;
  const MAX_FRAMES = 24000;
  const MAX_SCENES = 12;
  const TEMPLATES = Object.freeze(['ambient-orbit', 'pulse-cut', 'sand-study']);
  const ASPECTS = Object.freeze(['16:9', '1:1', '9:16']);
  const STYLES = ['sand', 'msand', 'cosmic', 'dcosmic'];
  const SHAPES = ['regular', 'random', 'sphere'];
  const ROTATIONS = ['single', 'tumble', 'precess'];
  const SAMPLE_MODES = ['beat', 'time'];
  const SECTION_KINDS = ['quiet', 'transition', 'percussive', 'bright', 'flowing'];
  const PARAMETER_LIMITS = Object.freeze({
    detail: [0.55, 3], particles: [0.05, 1], evolve: [0.12, 1], zoom: [0.25, 8],
    rotationSpeed: [0, 4], faces: [4, 32], light: [0, 9], patternInterval: [0.25, 30]
  });

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function rejectUnknown(object, allowed, label) {
    Object.keys(object).forEach(function check(key) {
      if (allowed.indexOf(key) < 0) throw new RangeError('Unknown ' + label + ' property: ' + key + '.');
    });
  }

  function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be a finite number.');
    return value;
  }

  function bounded(value, minimum, maximum, label) {
    const number = finite(value, label);
    if (number < minimum || number > maximum) throw new RangeError(label + ' must be between ' + minimum + ' and ' + maximum + '.');
    return number;
  }

  function integer(value, minimum, maximum, label) {
    const number = finite(value, label);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new RangeError(label + ' must be an integer between ' + minimum + ' and ' + maximum + '.');
    }
    return number;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function round(value, places) {
    const multiplier = Math.pow(10, places == null ? 6 : places);
    return Math.round(value * multiplier) / multiplier;
  }

  function enumValue(value, allowed, label) {
    if (allowed.indexOf(value) < 0) throw new RangeError(label + ' must be one of: ' + allowed.join(', ') + '.');
    return value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mean(values) {
    if (!values.length) return 0;
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[index];
    return total / values.length;
  }

  function averageFrames(frames, start, end, key) {
    let total = 0;
    let count = 0;
    for (let index = Math.max(0, start); index < Math.min(frames.length, end); index += 1) {
      total += frames[index][key];
      count += 1;
    }
    return count ? total / count : 0;
  }

  function bitReverseTable(size) {
    const bits = Math.round(Math.log2(size));
    const result = new Uint16Array(size);
    for (let index = 0; index < size; index += 1) {
      let source = index;
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) {
        reversed = (reversed << 1) | (source & 1);
        source >>>= 1;
      }
      result[index] = reversed;
    }
    return result;
  }

  const FFT_REVERSE = bitReverseTable(FFT_SIZE);
  const FFT_WINDOW = (function createWindow() {
    const values = new Float64Array(FFT_SIZE);
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const phase = (2 * Math.PI * index) / (FFT_SIZE - 1);
      values[index] = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(phase * 2);
    }
    return values;
  }());

  function transform(real, imaginary) {
    for (let length = 2; length <= FFT_SIZE; length <<= 1) {
      const half = length >>> 1;
      const angle = (-2 * Math.PI) / length;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let start = 0; start < FFT_SIZE; start += length) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let offset = 0; offset < half; offset += 1) {
          const even = start + offset;
          const odd = even + half;
          const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
          const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
          const evenReal = real[even];
          const evenImaginary = imaginary[even];
          real[even] = evenReal + oddReal;
          imaginary[even] = evenImaginary + oddImaginary;
          real[odd] = evenReal - oddReal;
          imaginary[odd] = evenImaginary - oddImaginary;
          const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
          twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
          twiddleReal = nextReal;
        }
      }
    }
  }

  function validatePcm(input, options) {
    if (!isPlainObject(input)) throw new TypeError('PCM input must be a plain object.');
    rejectUnknown(input, ['samples', 'sampleRate'], 'PCM input');
    const samples = input.samples;
    const arrayLike = Array.isArray(samples) || samples instanceof Float32Array || samples instanceof Float64Array;
    if (!arrayLike || samples.length < 1) throw new TypeError('samples must be a non-empty numeric array or Float32Array.');
    const sampleRate = integer(input.sampleRate, 8000, 192000, 'sampleRate');
    if (!isPlainObject(options)) throw new TypeError('analysis options must be a plain object.');
    rejectUnknown(options, ['durationMs', 'frameRate'], 'analysis option');
    const actualDurationMs = samples.length / sampleRate * 1000;
    if (actualDurationMs < 1) throw new RangeError('PCM input must contain at least 1 ms of audio.');
    const durationMs = own(options, 'durationMs')
      ? bounded(options.durationMs, 1, Math.min(MAX_DURATION_MS, actualDurationMs), 'durationMs')
      : actualDurationMs;
    if (durationMs > MAX_DURATION_MS) throw new RangeError('PCM input exceeds the maximum analysis duration of ' + MAX_DURATION_MS + ' ms.');
    const frameRate = own(options, 'frameRate') ? bounded(options.frameRate, 2, 60, 'frameRate') : 10;
    const frameCount = Math.max(1, Math.ceil(durationMs / 1000 * frameRate));
    if (frameCount > MAX_FRAMES) throw new RangeError('PCM analysis exceeds the maximum frame budget of ' + MAX_FRAMES + '.');
    const sampleCount = Math.min(samples.length, Math.ceil(durationMs / 1000 * sampleRate));
    for (let index = 0; index < sampleCount; index += 1) {
      const value = samples[index];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('samples[' + index + '] must be finite.');
      if (Math.abs(value) > 4) throw new RangeError('samples[' + index + '] is outside the supported PCM range.');
    }
    return { samples: samples, sampleRate: sampleRate, durationMs: durationMs, frameRate: frameRate, frameCount: frameCount, sampleCount: sampleCount };
  }

  function estimateTempo(frames, frameRate) {
    if (frames.length < Math.ceil(frameRate * 3)) return { bpm: 0, confidence: 0, beatMs: 0, barMs: 0 };
    const onset = new Float64Array(frames.length);
    for (let index = 1; index < frames.length; index += 1) {
      onset[index] = Math.max(0, frames[index].energy - frames[index - 1].energy) + frames[index].flux * 0.45;
    }
    const onsetMean = mean(onset);
    for (let index = 0; index < onset.length; index += 1) onset[index] = Math.max(0, onset[index] - onsetMean * 0.35);
    const minimumLag = Math.max(1, Math.round(frameRate * 60 / 180));
    const maximumLag = Math.max(minimumLag, Math.round(frameRate * 60 / 60));
    let bestScore = 0;
    let bestLag = 0;
    let scoreTotal = 0;
    let scoreCount = 0;
    for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
      let dot = 0;
      let leftPower = 0;
      let rightPower = 0;
      for (let index = lag; index < onset.length; index += 1) {
        const left = onset[index];
        const right = onset[index - lag];
        dot += left * right;
        leftPower += left * left;
        rightPower += right * right;
      }
      const correlation = leftPower > 1e-12 && rightPower > 1e-12 ? dot / Math.sqrt(leftPower * rightPower) : 0;
      const bpm = 60 * frameRate / lag;
      const score = correlation * (1 + 0.08 * Math.exp(-Math.pow((bpm - 115) / 35, 2)));
      scoreTotal += score;
      scoreCount += 1;
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    const averageScore = scoreCount ? scoreTotal / scoreCount : 0;
    if (!bestLag || bestScore < 0.08) return { bpm: 0, confidence: 0, beatMs: 0, barMs: 0 };
    const bpm = clamp(60 * frameRate / bestLag, 60, 180);
    const contrast = bestScore > 1e-9 ? (bestScore - averageScore) / bestScore : 0;
    const confidence = clamp(bestScore * 0.65 + contrast * 0.55, 0, 1);
    const beatMs = 60000 / bpm;
    return { bpm: round(bpm, 3), confidence: round(confidence), beatMs: round(beatMs, 3), barMs: round(beatMs * 4, 3) };
  }

  function buildSections(frames, durationMs, frameRate) {
    const windowFrames = Math.max(2, Math.round(frameRate * 1.5));
    const candidates = [];
    for (let index = windowFrames; index < frames.length - windowFrames; index += 1) {
      const previousEnergy = averageFrames(frames, index - windowFrames, index, 'energy');
      const nextEnergy = averageFrames(frames, index, index + windowFrames, 'energy');
      const previousBrightness = averageFrames(frames, index - windowFrames, index, 'brightness');
      const nextBrightness = averageFrames(frames, index, index + windowFrames, 'brightness');
      const previousRoughness = averageFrames(frames, index - windowFrames, index, 'roughness');
      const nextRoughness = averageFrames(frames, index, index + windowFrames, 'roughness');
      const localFlux = averageFrames(frames, index, index + Math.max(1, Math.round(frameRate * 0.5)), 'flux');
      const novelty = Math.abs(nextEnergy - previousEnergy) * 0.42 +
        Math.abs(nextBrightness - previousBrightness) * 0.22 +
        Math.abs(nextRoughness - previousRoughness) * 0.18 + localFlux * 0.18;
      candidates.push({ index: index, novelty: novelty });
    }
    const noveltyValues = candidates.map(function value(item) { return item.novelty; });
    const noveltyMean = mean(noveltyValues);
    let variance = 0;
    noveltyValues.forEach(function sum(value) { variance += Math.pow(value - noveltyMean, 2); });
    const threshold = noveltyMean + Math.sqrt(variance / Math.max(1, noveltyValues.length)) * 0.55;
    const minimumGap = Math.max(1, Math.round(frameRate * 4));
    const selected = [];
    candidates.slice().sort(function strongest(a, b) { return b.novelty - a.novelty || a.index - b.index; }).forEach(function select(item) {
      if (selected.length >= MAX_SCENES - 1 || item.novelty < threshold || item.novelty < 0.015) return;
      if (selected.every(function distant(existing) { return Math.abs(existing.index - item.index) >= minimumGap; })) selected.push(item);
    });
    selected.sort(function chronological(a, b) { return a.index - b.index; });
    const boundaries = [0].concat(selected.map(function time(item) {
      return Math.min(durationMs - 1, Math.max(1, Math.round(item.index / frameRate * 1000)));
    }), [Math.round(durationMs)]);
    const sections = [];
    for (let sectionIndex = 0; sectionIndex < boundaries.length - 1; sectionIndex += 1) {
      const startMs = boundaries[sectionIndex];
      const endMs = Math.max(startMs + 1, boundaries[sectionIndex + 1]);
      const startFrame = Math.floor(startMs / 1000 * frameRate);
      const endFrame = Math.max(startFrame + 1, Math.ceil(endMs / 1000 * frameRate));
      const intensity = clamp(averageFrames(frames, startFrame, endFrame, 'energy') / 2, 0, 1);
      const brightness = clamp(averageFrames(frames, startFrame, endFrame, 'brightness'), 0, 1);
      const roughness = clamp(averageFrames(frames, startFrame, endFrame, 'roughness'), 0, 1);
      const flux = clamp(averageFrames(frames, startFrame, endFrame, 'flux'), 0, 1);
      const boundary = sectionIndex === 0 ? null : selected[sectionIndex - 1];
      const novelty = boundary ? clamp(boundary.novelty, 0, 1) : 0;
      let kind = 'flowing';
      if (intensity < 0.12) kind = 'quiet';
      else if (novelty > 0.3) kind = 'transition';
      else if (roughness > 0.58 || flux > 0.22) kind = 'percussive';
      else if (brightness > 0.58) kind = 'bright';
      sections.push({
        startMs: startMs,
        endMs: Math.min(Math.round(durationMs), endMs),
        intensity: round(intensity),
        brightness: round(brightness),
        roughness: round(roughness),
        flux: round(flux),
        novelty: round(novelty),
        kind: kind
      });
    }
    return sections;
  }

  function analyzeMono(input, options) {
    const settings = options == null ? {} : options;
    const pcm = validatePcm(input, settings);
    const samples = pcm.samples;
    const sampleRate = pcm.sampleRate;
    const bins = FFT_SIZE / 2;
    const real = new Float64Array(FFT_SIZE);
    const imaginary = new Float64Array(FFT_SIZE);
    const magnitude = new Float64Array(bins);
    const previousSpectrum = new Float64Array(bins);
    const frames = [];
    for (let frameIndex = 0; frameIndex < pcm.frameCount; frameIndex += 1) {
      const sampleStart = Math.floor(frameIndex / pcm.frameRate * sampleRate);
      imaginary.fill(0);
      let squareSum = 0;
      let observed = 0;
      for (let index = 0; index < FFT_SIZE; index += 1) {
        const sourceIndex = sampleStart + index;
        const sample = sourceIndex < pcm.sampleCount ? samples[sourceIndex] : 0;
        real[FFT_REVERSE[index]] = sample * FFT_WINDOW[index];
        if (sourceIndex < pcm.sampleCount) { squareSum += sample * sample; observed += 1; }
      }
      transform(real, imaginary);
      let magnitudeSum = 0;
      let weighted = 0;
      let logarithmic = 0;
      let low = 0;
      let mid = 0;
      let high = 0;
      for (let bin = 1; bin < bins; bin += 1) {
        const value = Math.hypot(real[bin], imaginary[bin]);
        magnitude[bin] = value;
        magnitudeSum += value;
        weighted += value * bin;
        logarithmic += Math.log(value + 1e-12);
        const frequency = bin * sampleRate / FFT_SIZE;
        if (frequency < 250) low += value;
        else if (frequency < 2000) mid += value;
        else high += value;
      }
      const arithmetic = magnitudeSum / Math.max(1, bins - 1);
      const geometric = Math.exp(logarithmic / Math.max(1, bins - 1));
      let flux = 0;
      for (let bin = 1; bin < bins; bin += 1) {
        const normalized = magnitudeSum > 1e-12 ? magnitude[bin] / magnitudeSum : 0;
        flux += Math.max(0, normalized - previousSpectrum[bin]);
        previousSpectrum[bin] = normalized;
      }
      const spectralTotal = Math.max(1e-12, low + mid + high);
      frames.push({
        timeMs: Math.min(round(pcm.durationMs, 3), round(sampleStart / sampleRate * 1000, 3)),
        energy: round(clamp(Math.sqrt(squareSum / Math.max(1, observed)) * 4.5, 0, 2)),
        brightness: round(clamp(magnitudeSum > 1e-12 ? weighted / magnitudeSum / bins : 0, 0, 1)),
        roughness: round(clamp(arithmetic > 1e-12 ? geometric / arithmetic : 0, 0, 1)),
        flux: round(clamp(flux, 0, 1)),
        low: round(low / spectralTotal),
        mid: round(mid / spectralTotal),
        high: round(high / spectralTotal)
      });
    }
    const tempo = estimateTempo(frames, pcm.frameRate);
    const sections = buildSections(frames, pcm.durationMs, pcm.frameRate);
    return {
      schema: ANALYSIS_SCHEMA,
      version: SCHEMA_VERSION,
      durationMs: round(pcm.durationMs, 3),
      sampleRate: sampleRate,
      frameRate: pcm.frameRate,
      frames: frames,
      tempo: tempo,
      sections: sections,
      summary: {
        energy: round(mean(frames.map(function value(frame) { return frame.energy; }))),
        brightness: round(mean(frames.map(function value(frame) { return frame.brightness; }))),
        roughness: round(mean(frames.map(function value(frame) { return frame.roughness; }))),
        flux: round(mean(frames.map(function value(frame) { return frame.flux; })))
      }
    };
  }

  function validateAnalysis(analysis) {
    if (!isPlainObject(analysis)) throw new TypeError('analysis must be a plain object.');
    rejectUnknown(analysis, ['schema', 'version', 'durationMs', 'sampleRate', 'frameRate', 'frames', 'tempo', 'sections', 'summary'], 'analysis');
    if (analysis.schema !== ANALYSIS_SCHEMA || analysis.version !== SCHEMA_VERSION) throw new TypeError('Unsupported music analysis schema.');
    const durationMs = bounded(analysis.durationMs, 1, MAX_DURATION_MS, 'analysis.durationMs');
    const frameRate = bounded(analysis.frameRate, 2, 60, 'analysis.frameRate');
    integer(analysis.sampleRate, 8000, 192000, 'analysis.sampleRate');
    if (!Array.isArray(analysis.frames) || !analysis.frames.length || analysis.frames.length > MAX_FRAMES) throw new RangeError('analysis.frames must be a non-empty bounded array.');
    let previousTime = -1;
    analysis.frames.forEach(function validateFrame(frame, index) {
      if (!isPlainObject(frame)) throw new TypeError('analysis.frames[' + index + '] must be an object.');
      rejectUnknown(frame, ['timeMs', 'energy', 'brightness', 'roughness', 'flux', 'low', 'mid', 'high'], 'analysis frame');
      const time = bounded(frame.timeMs, 0, durationMs, 'analysis.frames[' + index + '].timeMs');
      if (time < previousTime) throw new RangeError('analysis frame times must be ordered.');
      previousTime = time;
      ['energy', 'brightness', 'roughness', 'flux', 'low', 'mid', 'high'].forEach(function feature(key) {
        bounded(frame[key], 0, key === 'energy' ? 2 : 1, 'analysis.frames[' + index + '].' + key);
      });
    });
    if (!isPlainObject(analysis.tempo)) throw new TypeError('analysis.tempo must be an object.');
    rejectUnknown(analysis.tempo, ['bpm', 'confidence', 'beatMs', 'barMs'], 'analysis tempo');
    bounded(analysis.tempo.bpm, 0, 180, 'analysis.tempo.bpm');
    if (analysis.tempo.bpm > 0 && analysis.tempo.bpm < 60) throw new RangeError('analysis.tempo.bpm must be zero or between 60 and 180.');
    bounded(analysis.tempo.confidence, 0, 1, 'analysis.tempo.confidence');
    bounded(analysis.tempo.beatMs, 0, 1000, 'analysis.tempo.beatMs');
    bounded(analysis.tempo.barMs, 0, 4000, 'analysis.tempo.barMs');
    if (!isPlainObject(analysis.summary)) throw new TypeError('analysis.summary must be an object.');
    rejectUnknown(analysis.summary, ['energy', 'brightness', 'roughness', 'flux'], 'analysis summary');
    bounded(analysis.summary.energy, 0, 2, 'analysis.summary.energy');
    ['brightness', 'roughness', 'flux'].forEach(function summaryFeature(key) {
      bounded(analysis.summary[key], 0, 1, 'analysis.summary.' + key);
    });
    if (!Array.isArray(analysis.sections) || !analysis.sections.length || analysis.sections.length > MAX_SCENES) throw new RangeError('analysis.sections must contain between 1 and ' + MAX_SCENES + ' sections.');
    let previousEnd = 0;
    analysis.sections.forEach(function validateSection(section, index) {
      if (!isPlainObject(section)) throw new TypeError('analysis.sections[' + index + '] must be an object.');
      rejectUnknown(section, ['startMs', 'endMs', 'intensity', 'brightness', 'roughness', 'flux', 'novelty', 'kind'], 'analysis section');
      bounded(section.startMs, 0, durationMs, 'section.startMs');
      bounded(section.endMs, section.startMs, durationMs, 'section.endMs');
      if (section.endMs <= section.startMs) throw new RangeError('analysis sections must have positive duration.');
      if (section.startMs < previousEnd) throw new RangeError('analysis sections must be ordered and non-overlapping.');
      previousEnd = section.endMs;
      ['intensity', 'brightness', 'roughness', 'flux', 'novelty'].forEach(function feature(key) {
        bounded(section[key], 0, 1, 'section.' + key);
      });
      enumValue(section.kind, SECTION_KINDS, 'section.kind');
    });
    return { durationMs: durationMs, frameRate: frameRate };
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function defaultBaseSnapshot() {
    return {
      schema: SNAPSHOT_SCHEMA,
      version: SCHEMA_VERSION,
      style: 'cosmic',
      sampleMode: 'beat',
      rotationMode: 'precess',
      solidShape: 'regular',
      parameters: { detail: 1, particles: 0.2, evolve: 0.5, zoom: 3, rotationSpeed: 1, faces: 8, light: 9, patternInterval: 2 },
      toggles: { rotation: true, symmetry: false, frame: false, transparent: false },
      pattern: { style: 'cosmic', goal: 8, ex: [0.7, 0.4, 0.6], detail: 1, shape: 'regular', polyN: 8, polySeed: 1, sym: false }
    };
  }

  function validateBaseSnapshot(value) {
    if (value == null) return defaultBaseSnapshot();
    if (!isPlainObject(value)) throw new TypeError('baseSnapshot must be a plain object.');
    const requiredObjects = ['parameters', 'toggles', 'pattern'];
    requiredObjects.forEach(function required(key) {
      if (!isPlainObject(value[key])) throw new TypeError('baseSnapshot.' + key + ' must be an object.');
    });
    rejectUnknown(value, ['schema', 'version', 'style', 'sampleMode', 'rotationMode', 'solidShape', 'parameters', 'toggles', 'pattern'], 'baseSnapshot');
    if (value.schema !== SNAPSHOT_SCHEMA || value.version !== SCHEMA_VERSION) throw new TypeError('baseSnapshot must use the Scene Studio snapshot v1 schema.');
    enumValue(value.style, STYLES, 'baseSnapshot.style');
    enumValue(value.sampleMode, SAMPLE_MODES, 'baseSnapshot.sampleMode');
    enumValue(value.rotationMode, ROTATIONS, 'baseSnapshot.rotationMode');
    enumValue(value.solidShape, SHAPES, 'baseSnapshot.solidShape');
    rejectUnknown(value.parameters, Object.keys(PARAMETER_LIMITS), 'baseSnapshot parameter');
    Object.keys(PARAMETER_LIMITS).forEach(function validateParameter(key) {
      const limits = PARAMETER_LIMITS[key];
      bounded(value.parameters[key], limits[0], limits[1], 'baseSnapshot.parameters.' + key);
      if ((key === 'faces' || key === 'light') && !Number.isInteger(value.parameters[key])) throw new RangeError('baseSnapshot.parameters.' + key + ' must be an integer.');
    });
    rejectUnknown(value.toggles, ['rotation', 'symmetry', 'frame', 'transparent'], 'baseSnapshot toggle');
    ['rotation', 'symmetry', 'frame', 'transparent'].forEach(function validateToggle(key) {
      if (typeof value.toggles[key] !== 'boolean') throw new TypeError('baseSnapshot.toggles.' + key + ' must be a boolean.');
    });
    rejectUnknown(value.pattern, ['style', 'goal', 'ex', 'detail', 'shape', 'polyN', 'polySeed', 'sym'], 'baseSnapshot pattern');
    enumValue(value.pattern.style, STYLES, 'baseSnapshot.pattern.style');
    enumValue(value.pattern.shape, SHAPES, 'baseSnapshot.pattern.shape');
    bounded(value.pattern.goal, 0.25, 20, 'baseSnapshot.pattern.goal');
    bounded(value.pattern.detail, 0.55, 3, 'baseSnapshot.pattern.detail');
    integer(value.pattern.polyN, 4, 32, 'baseSnapshot.pattern.polyN');
    integer(value.pattern.polySeed, 1, Number.MAX_SAFE_INTEGER, 'baseSnapshot.pattern.polySeed');
    if (!Array.isArray(value.pattern.ex) || value.pattern.ex.length !== 3) throw new TypeError('baseSnapshot.pattern.ex must contain three axes.');
    value.pattern.ex.forEach(function validateAxis(axis, index) { bounded(axis, 0, 1, 'baseSnapshot.pattern.ex[' + index + ']'); });
    if (typeof value.pattern.sym !== 'boolean') throw new TypeError('baseSnapshot.pattern.sym must be a boolean.');
    return clone(value);
  }

  const TEMPLATE_PROFILES = Object.freeze({
    'ambient-orbit': Object.freeze({
      style: 'cosmic', quietStyle: 'msand', solidShape: 'sphere', faces: 20,
      rotationMode: 'precess', detail: 1.15, particles: 0.22, evolve: 0.3,
      zoom: 3.4, rotationSpeed: 0.46, light: 9, frame: false, symmetry: true
    }),
    'pulse-cut': Object.freeze({
      style: 'dcosmic', quietStyle: 'cosmic', solidShape: 'random', faces: 8,
      rotationMode: 'tumble', detail: 1.65, particles: 0.48, evolve: 0.82,
      zoom: 2.15, rotationSpeed: 1.65, light: 9, frame: false, symmetry: false
    }),
    'sand-study': Object.freeze({
      style: 'sand', quietStyle: 'msand', solidShape: 'regular', faces: 6,
      rotationMode: 'single', detail: 1.22, particles: 0.62, evolve: 0.48,
      zoom: 2.55, rotationSpeed: 0.72, light: 7, frame: true, symmetry: false
    })
  });

  const ASPECT_PROFILES = Object.freeze({
    '16:9': Object.freeze({ zoom: 1, particles: 1, rotation: 1 }),
    '1:1': Object.freeze({ zoom: 0.92, particles: 0.94, rotation: 0.9 }),
    '9:16': Object.freeze({ zoom: 0.78, particles: 0.86, rotation: 0.8 })
  });

  function validatePlanOptions(options) {
    if (!isPlainObject(options)) throw new TypeError('plan options must be a plain object.');
    rejectUnknown(options, ['template', 'aspect', 'title', 'seed', 'maxScenes', 'baseSnapshot'], 'plan option');
    const template = enumValue(options.template, TEMPLATES, 'template');
    const aspect = enumValue(options.aspect, ASPECTS, 'aspect');
    if (options.title != null && typeof options.title !== 'string') throw new TypeError('title must be a string.');
    const title = options.title == null ? 'Auto-directed Signal Field' : options.title.trim();
    if (!title || title.length > 120) throw new RangeError('title must contain between 1 and 120 characters.');
    const seed = integer(options.seed, 0, 0xffffffff, 'seed');
    const maxScenes = own(options, 'maxScenes') ? integer(options.maxScenes, 1, MAX_SCENES, 'maxScenes') : 8;
    return { template: template, aspect: aspect, title: title, seed: seed, maxScenes: maxScenes, baseSnapshot: validateBaseSnapshot(options.baseSnapshot) };
  }

  function selectedSections(sections, maximum) {
    if (sections.length <= maximum) return sections.slice();
    const selected = [sections[0]];
    sections.slice(1).sort(function strongest(a, b) { return b.novelty - a.novelty || a.startMs - b.startMs; }).slice(0, maximum - 1).forEach(function add(section) { selected.push(section); });
    return selected.sort(function chronological(a, b) { return a.startMs - b.startMs; });
  }

  function completeSnapshot(base, profile, aspect, section, analysis, random, index, seed) {
    const intensity = section.intensity;
    const brightness = section.brightness;
    const roughness = section.roughness;
    const tempo = analysis.tempo;
    const confidentBeat = tempo.confidence >= 0.25 && tempo.beatMs > 0;
    let style = profile.style;
    if (intensity < 0.12) style = profile.quietStyle;
    else if (profile.style === 'dcosmic' && roughness < 0.28 && section.flux < 0.08) style = 'cosmic';
    const parameters = {
      detail: round(clamp(profile.detail + brightness * 0.72 + roughness * 0.28, 0.55, 3)),
      particles: round(clamp((profile.particles + intensity * 0.26) * aspect.particles, 0.05, 1)),
      evolve: round(clamp(profile.evolve + section.flux * 0.35 + section.novelty * 0.2, 0.12, 1)),
      zoom: round(clamp(profile.zoom * aspect.zoom * (1.08 - intensity * 0.12), 0.25, 8)),
      rotationSpeed: round(clamp(profile.rotationSpeed * aspect.rotation * (0.82 + intensity * 0.52), 0, 4)),
      faces: profile.faces,
      light: Math.round(clamp(profile.light - (brightness < 0.22 ? 2 : 0), 0, 9)),
      patternInterval: round(clamp(confidentBeat ? tempo.beatMs * (profile.style === 'dcosmic' ? 2 : 4) / 1000 : 3.5 + (1 - section.flux) * 3, 0.25, 30))
    };
    const ex = [
      round(clamp(0.16 + random() * 0.68, 0, 1)),
      round(clamp(0.16 + random() * 0.68, 0, 1)),
      round(clamp(0.16 + random() * 0.68, 0, 1))
    ];
    const goal = round(clamp(3.5 + intensity * 7 + brightness * 4 + random() * 1.5, 0.25, 20));
    return {
      schema: SNAPSHOT_SCHEMA,
      version: SCHEMA_VERSION,
      style: style,
      sampleMode: confidentBeat ? 'beat' : 'time',
      rotationMode: profile.rotationMode,
      solidShape: profile.solidShape,
      parameters: parameters,
      toggles: {
        rotation: true,
        symmetry: profile.symmetry,
        frame: profile.frame,
        transparent: Boolean(base.toggles.transparent)
      },
      pattern: {
        style: style,
        goal: goal,
        ex: ex,
        detail: parameters.detail,
        shape: profile.solidShape,
        polyN: profile.faces,
        // Keep one geometry seed for the whole plan. Scene Studio interpolates
        // numeric fields, so per-scene seeds would rebuild random solids at
        // every playback apply interval.
        polySeed: Math.max(1, seed >>> 0),
        sym: profile.symmetry
      }
    };
  }

  function cueReasons(section, analysis) {
    const reasons = [];
    if (section.kind === 'quiet') reasons.push('low-energy');
    if (section.intensity >= 0.55) reasons.push('high-energy');
    if (section.brightness >= 0.55) reasons.push('bright-spectrum');
    if (section.roughness >= 0.55) reasons.push('rough-spectrum');
    if (section.flux >= 0.18) reasons.push('strong-onsets');
    if (section.novelty >= 0.2) reasons.push('section-change');
    if (analysis.tempo.confidence >= 0.25) reasons.push('tempo-locked');
    if (!reasons.length) reasons.push('steady-flow');
    return reasons;
  }

  function createPlan(analysis, options) {
    validateAnalysis(analysis);
    const settings = validatePlanOptions(options);
    const profile = TEMPLATE_PROFILES[settings.template];
    const aspect = ASPECT_PROFILES[settings.aspect];
    const random = mulberry32(settings.seed);
    const sections = selectedSections(analysis.sections, settings.maxScenes);
    const scenes = [];
    const keyframes = [];
    const cues = [];
    sections.forEach(function direct(section, index) {
      const id = 'auto-scene-' + String(index + 1).padStart(2, '0');
      const snapshot = completeSnapshot(settings.baseSnapshot, profile, aspect, section, analysis, random, index, settings.seed);
      scenes.push({ id: id, name: settings.template + ' · ' + String(index + 1).padStart(2, '0') + ' · ' + section.kind, snapshot: snapshot });
      keyframes.push({ id: 'auto-keyframe-' + String(index + 1).padStart(2, '0'), timeMs: Math.min(Math.round(analysis.durationMs), Math.max(0, Math.round(section.startMs))), snapshot: clone(snapshot) });
      cues.push({
        timeMs: Math.min(Math.round(analysis.durationMs), Math.max(0, Math.round(section.startMs))),
        sceneId: id,
        kind: section.kind,
        confidence: round(clamp(Math.max(analysis.tempo.confidence, section.novelty), 0, 1)),
        reasons: cueReasons(section, analysis)
      });
    });
    const project = {
      schema: PROJECT_SCHEMA,
      version: SCHEMA_VERSION,
      title: settings.title,
      scenes: scenes,
      timeline: { durationMs: Math.round(analysis.durationMs), keyframes: keyframes }
    };
    return {
      schema: PLAN_SCHEMA,
      version: SCHEMA_VERSION,
      template: settings.template,
      aspect: settings.aspect,
      seed: settings.seed,
      analysisSummary: clone(analysis.summary),
      project: project,
      cues: cues
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    ANALYSIS_SCHEMA: ANALYSIS_SCHEMA,
    PLAN_SCHEMA: PLAN_SCHEMA,
    TEMPLATES: TEMPLATES,
    ASPECTS: ASPECTS,
    MAX_DURATION_MS: MAX_DURATION_MS,
    MAX_SCENES: MAX_SCENES,
    analyzeMono: analyzeMono,
    createPlan: createPlan
  });
}));
