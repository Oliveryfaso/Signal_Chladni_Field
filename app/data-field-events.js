/*
 * Signal Field — local data-event utilities.
 *
 * This module deliberately has no DOM, storage, or network dependency.  It turns
 * a numeric series into small, portable event bookmarks and deterministic scene
 * recipes that the renderer can apply later.
 */
(function exposeDataFieldEvents(factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DataFieldEvents = api;
}(function createDataFieldEvents() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const BOOKMARK_KIND = 'signal-field-data-bookmarks';
  const DEFAULT_WINDOW_SIZE = 12;
  const DEFAULT_MIN_HISTORY = 6;
  const DEFAULT_SENSITIVITY = 3.25;
  const MAX_TEXT_LENGTH = 240;

  function finiteNumber(value, fallback) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function clampUnit(value) {
    return clamp(finiteNumber(value, 0), 0, 1);
  }

  function text(value, maximum) {
    if (value == null) return '';
    return String(value).trim().slice(0, maximum || MAX_TEXT_LENGTH);
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort(function sortNumbers(a, b) { return a - b; });
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function sampleStandardDeviation(values, average) {
    if (values.length < 2) return 0;
    const mean = average == null ? values.reduce(function add(sum, value) { return sum + value; }, 0) / values.length : average;
    const variance = values.reduce(function addVariance(sum, value) {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) / (values.length - 1);
    return Math.sqrt(Math.max(0, variance));
  }

  function stableHash(input) {
    let hash = 2166136261;
    const source = String(input);
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function toTimestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text(value, 120);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function firstNumericColumn(rows, timeColumn) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!isPlainObject(row)) continue;
      const keys = Object.keys(row);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex];
        if (key === timeColumn) continue;
        if (Number.isFinite(finiteNumber(row[key], NaN))) return key;
      }
    }
    return '';
  }

  /**
   * Accepts a numeric array, an array of objects, or { values, timestamps, metric }.
   * It returns only finite observations; invalid/missing values are skipped rather than
   * silently coerced to zero.
   */
  function normalizeSeries(input, options) {
    const settings = options || {};
    let values = input;
    let timestamps = settings.timestamps;
    let metric = text(settings.metric || settings.column, 120);

    if (isPlainObject(input) && Array.isArray(input.values)) {
      values = input.values;
      timestamps = input.timestamps || timestamps;
      metric = text(settings.metric || settings.column || input.metric || input.column, 120);
    }

    if (!Array.isArray(values)) {
      throw new TypeError('Expected a numeric array, row array, or an object with a values array.');
    }

    const rows = values;
    const objectRows = rows.some(isPlainObject);
    const column = objectRows ? (metric || firstNumericColumn(rows, settings.timeColumn)) : metric;
    if (objectRows && !column) throw new TypeError('Could not find a numeric column in the supplied rows.');

    const samples = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const value = objectRows ? finiteNumber(isPlainObject(row) ? row[column] : NaN, NaN) : finiteNumber(row, NaN);
      if (!Number.isFinite(value)) continue;
      const timestamp = objectRows && isPlainObject(row)
        ? toTimestamp(settings.timeColumn ? row[settings.timeColumn] : row.timestamp || row.time || row.date)
        : toTimestamp(timestamps && timestamps[index]);
      samples.push({ index: index, value: value, timestamp: timestamp });
    }

    if (!samples.length) throw new TypeError('The supplied series has no finite numeric values.');
    return { metric: column || 'value', samples: samples, sourceLength: rows.length };
  }

  function severityForScore(score, sensitivity) {
    const ratio = Math.abs(score) / Math.max(0.000001, sensitivity);
    if (ratio >= 2.5) return 'critical';
    if (ratio >= 1.7) return 'high';
    if (ratio >= 1.2) return 'medium';
    return 'low';
  }

  /**
   * Rolling robust-z anomaly detection.  Its baseline is calculated only from
   * observations before the candidate, so a spike cannot normalise itself away.
   */
  function detectAnomalies(input, options) {
    const settings = options || {};
    const normalized = normalizeSeries(input, settings);
    const windowSize = Math.max(3, Math.floor(finiteNumber(settings.windowSize, DEFAULT_WINDOW_SIZE)));
    const minHistory = Math.max(3, Math.min(windowSize, Math.floor(finiteNumber(settings.minHistory, DEFAULT_MIN_HISTORY))));
    const sensitivity = Math.max(0.1, finiteNumber(settings.sensitivity, DEFAULT_SENSITIVITY));
    const minimumDeviation = Math.max(0, finiteNumber(settings.minimumDeviation, 0));
    const events = [];
    const samples = normalized.samples;

    for (let position = minHistory; position < samples.length; position += 1) {
      const history = samples.slice(Math.max(0, position - windowSize), position).map(function getValue(sample) { return sample.value; });
      if (history.length < minHistory) continue;

      const baseline = median(history);
      const absoluteDeviations = history.map(function distance(value) { return Math.abs(value - baseline); });
      const robustScale = median(absoluteDeviations) * 1.4826;
      const standardDeviation = sampleStandardDeviation(history);
      // A non-zero floor protects perfectly flat baselines without treating tiny
      // floating-point differences as meaningful business events.
      const floor = Math.max(Math.abs(baseline) * 0.03, 0.000001);
      const scale = Math.max(robustScale, standardDeviation * 0.35, floor);
      const sample = samples[position];
      const deviation = sample.value - baseline;
      const score = deviation / scale;

      if (Math.abs(score) < sensitivity || Math.abs(deviation) < minimumDeviation) continue;

      events.push({
        schemaVersion: SCHEMA_VERSION,
        type: 'anomaly',
        metric: normalized.metric,
        index: sample.index,
        timestamp: sample.timestamp,
        value: sample.value,
        baseline: baseline,
        scale: scale,
        deviation: deviation,
        score: score,
        severity: severityForScore(score, sensitivity),
        direction: deviation > 0 ? 'rise' : 'drop',
        historyStartIndex: samples[Math.max(0, position - windowSize)].index,
        historyEndIndex: samples[position - 1].index
      });
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      metric: normalized.metric,
      sourceLength: normalized.sourceLength,
      samplesAnalyzed: samples.length,
      options: { windowSize: windowSize, minHistory: minHistory, sensitivity: sensitivity, minimumDeviation: minimumDeviation },
      events: events
    };
  }

  function eventId(seed) {
    const hash = stableHash(seed).toString(36);
    return 'sfe_' + hash.padStart(7, '0');
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    return tags.reduce(function collect(result, tag) {
      const safeTag = text(tag, 48);
      if (safeTag && !seen.has(safeTag)) {
        seen.add(safeTag);
        result.push(safeTag);
      }
      return result;
    }, []).slice(0, 12);
  }

  /** Turns a detection result into a shareable bookmark without retaining raw rows. */
  function createEvent(anomaly, options) {
    if (!isPlainObject(anomaly)) throw new TypeError('Expected an anomaly object.');
    const settings = options || {};
    const metric = text(settings.metric || anomaly.metric || 'value', 120);
    const index = Math.max(0, Math.floor(finiteNumber(anomaly.index, 0)));
    const value = finiteNumber(anomaly.value, NaN);
    const baseline = finiteNumber(anomaly.baseline, NaN);
    const scale = Math.max(0.000001, Math.abs(finiteNumber(anomaly.scale, 1)));
    const deviation = finiteNumber(anomaly.deviation, Number.isFinite(value) && Number.isFinite(baseline) ? value - baseline : 0);
    const score = finiteNumber(anomaly.score, deviation / scale);
    const severity = ['low', 'medium', 'high', 'critical'].indexOf(anomaly.severity) >= 0
      ? anomaly.severity
      : severityForScore(score, finiteNumber(settings.sensitivity, DEFAULT_SENSITIVITY));
    const direction = anomaly.direction === 'drop' || anomaly.direction === 'rise'
      ? anomaly.direction
      : (deviation < 0 ? 'drop' : 'rise');
    const timestamp = toTimestamp(anomaly.timestamp);
    const defaultTitle = metric + (direction === 'rise' ? ' 上行异常' : ' 下行异常');
    const seed = [metric, index, timestamp || '', value, baseline, direction].join('|');

    return {
      schemaVersion: SCHEMA_VERSION,
      id: text(settings.id, 96) || eventId(seed),
      type: 'anomaly',
      metric: metric,
      index: index,
      timestamp: timestamp,
      value: value,
      baseline: baseline,
      scale: scale,
      deviation: deviation,
      score: score,
      severity: severity,
      direction: direction,
      historyStartIndex: Math.max(0, Math.floor(finiteNumber(anomaly.historyStartIndex, index))),
      historyEndIndex: Math.max(0, Math.floor(finiteNumber(anomaly.historyEndIndex, Math.max(0, index - 1)))),
      title: text(settings.title || anomaly.title || defaultTitle, MAX_TEXT_LENGTH),
      note: text(settings.note || anomaly.note, 2000),
      tags: normalizeTags(settings.tags || anomaly.tags),
      // The dataset label is opt-in.  Do not pass a sensitive filename or identifier.
      dataset: text(settings.dataset || anomaly.dataset, 160),
      createdAt: toTimestamp(settings.createdAt) || new Date().toISOString()
    };
  }

  function createEvents(detection, options) {
    if (!isPlainObject(detection) || !Array.isArray(detection.events)) {
      throw new TypeError('Expected the result returned by detectAnomalies().');
    }
    const settings = options || {};
    return detection.events.map(function makeBookmark(anomaly, eventIndex) {
      const perEvent = typeof settings.eventOptions === 'function' ? settings.eventOptions(anomaly, eventIndex) || {} : {};
      const merged = Object.assign({}, settings, perEvent, { metric: settings.metric || detection.metric });
      delete merged.eventOptions;
      return createEvent(anomaly, merged);
    });
  }

  function normalizeBookmark(bookmark) {
    if (!isPlainObject(bookmark)) throw new TypeError('Each bookmark must be an object.');
    const value = finiteNumber(bookmark.value, NaN);
    const baseline = finiteNumber(bookmark.baseline, NaN);
    if (!Number.isFinite(value) || !Number.isFinite(baseline)) {
      throw new TypeError('A bookmark needs finite value and baseline numbers.');
    }
    return createEvent(bookmark, {
      id: bookmark.id,
      metric: bookmark.metric,
      title: bookmark.title,
      note: bookmark.note,
      tags: bookmark.tags,
      dataset: bookmark.dataset,
      createdAt: bookmark.createdAt,
      sensitivity: 1
    });
  }

  /** Serialises events only; it never embeds the source dataset or original rows. */
  function serializeBookmarks(bookmarks, options) {
    if (!Array.isArray(bookmarks)) throw new TypeError('Expected an array of bookmarks.');
    const settings = options || {};
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      kind: BOOKMARK_KIND,
      exportedAt: toTimestamp(settings.exportedAt) || new Date().toISOString(),
      // An optional label, not the source data.  Callers should omit sensitive labels.
      dataset: text(settings.dataset, 160),
      bookmarks: bookmarks.map(normalizeBookmark)
    };
    return JSON.stringify(payload, null, settings.pretty === false ? 0 : 2);
  }

  function deserializeBookmarks(serialized) {
    let payload;
    try {
      payload = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    } catch (error) {
      throw new TypeError('Bookmark JSON could not be parsed.');
    }
    if (!isPlainObject(payload) || payload.kind !== BOOKMARK_KIND) {
      throw new TypeError('This is not a Signal Field data-bookmark export.');
    }
    if (payload.schemaVersion !== SCHEMA_VERSION) {
      throw new RangeError('Unsupported bookmark schema version: ' + String(payload.schemaVersion));
    }
    if (!Array.isArray(payload.bookmarks)) throw new TypeError('Bookmark export is missing its bookmarks array.');
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: BOOKMARK_KIND,
      exportedAt: toTimestamp(payload.exportedAt),
      dataset: text(payload.dataset, 160),
      bookmarks: payload.bookmarks.map(normalizeBookmark)
    };
  }

  function severityImpact(severity, score) {
    const bySeverity = { low: 0.32, medium: 0.5, high: 0.7, critical: 0.9 };
    const fallback = clamp(Math.abs(finiteNumber(score, 0)) / 10, 0.25, 1);
    return bySeverity[severity] == null ? fallback : bySeverity[severity];
  }

  function modeTriplet(seed, offset) {
    const first = 1 + ((seed + offset) % 5);
    const second = first + 1 + ((seed >>> (offset % 13)) % Math.max(1, 8 - first));
    const third = Math.min(10, second + 1 + ((seed >>> ((offset + 7) % 17)) % Math.max(1, 10 - second)));
    return { l: first, m: second, n: third };
  }

  /**
   * Creates a renderer-agnostic scene recipe.  The `pattern` member is directly
   * compatible with Signal Field's existing applyPattern(recipe.pattern) hook.
   */
  function sceneRecipeForEvent(bookmark, options) {
    const event = normalizeBookmark(bookmark);
    const settings = options || {};
    const impact = severityImpact(event.severity, event.score);
    const seed = stableHash(event.id + '|' + event.metric + '|' + event.index);
    const directionBias = event.direction === 'rise' ? 1 : -1;
    const start = Math.max(0, event.historyStartIndex);
    const end = Math.max(event.index, event.historyEndIndex);
    const width = Math.max(4, Math.round(6 + impact * 16));
    const goal = Number((1.15 + impact * 7.1 + ((seed % 9) / 100)).toFixed(3));
    const ex = [
      clampUnit(0.28 + impact * 0.36 + directionBias * 0.08),
      clampUnit(0.52 + (((seed >>> 7) % 19) - 9) / 100),
      clampUnit(0.62 - impact * 0.18 - directionBias * 0.05)
    ].map(function rounded(value) { return Number(value.toFixed(3)); });
    const modes = [
      Object.assign(modeTriplet(seed, 3), { weight: Number((0.56 + impact * 0.18).toFixed(3)) }),
      Object.assign(modeTriplet(seed, 11), { weight: Number((0.28 - impact * 0.06).toFixed(3)) }),
      Object.assign(modeTriplet(seed, 19), { weight: Number((0.16 - impact * 0.04).toFixed(3)) })
    ];

    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'signal-field-data-event-scene',
      eventId: event.id,
      title: event.title,
      source: { metric: event.metric, index: event.index, timestamp: event.timestamp, severity: event.severity, direction: event.direction },
      timeline: {
        focusIndex: event.index,
        replayRange: { start: Math.max(0, start - width), end: end + width },
        holdSeconds: Number((2.5 + impact * 4.5).toFixed(2))
      },
      driver: {
        mode: settings.mode === 'ensemble' ? 'ensemble' : 'single',
        primaryColumn: event.metric,
        // Names only, never source values.  Useful when an app has an ensemble mapping.
        participatingColumns: Array.isArray(settings.participatingColumns)
          ? settings.participatingColumns.map(function safeColumn(column) { return text(column, 120); }).filter(Boolean).slice(0, 12)
          : [event.metric]
      },
      modal: { modes: modes, symmetric: event.direction === 'drop' && impact < 0.7 },
      excitation: {
        energy: Number((0.38 + impact * 0.58).toFixed(3)),
        sharpness: Number((0.3 + impact * 0.55).toFixed(3)),
        bandCenter: Number(clampUnit(0.5 + directionBias * 0.18 + (((seed >>> 4) % 9) - 4) / 100).toFixed(3))
      },
      pattern: {
        style: impact >= 0.7 ? 'dcosmic' : 'cosmic',
        goal: goal,
        ex: ex,
        shape: 'cube',
        detail: Number((0.82 + impact * 0.68).toFixed(3)),
        sym: event.direction === 'drop' && impact < 0.7
      },
      visual: {
        rotationMode: impact >= 0.7 ? 'tumble' : 'precess',
        rotationSpeed: Number((0.18 + impact * 0.36).toFixed(3)),
        light: impact >= 0.7 ? 9 : 6
      }
    };
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    BOOKMARK_KIND: BOOKMARK_KIND,
    normalizeSeries: normalizeSeries,
    detectAnomalies: detectAnomalies,
    createEvent: createEvent,
    createEvents: createEvents,
    serializeBookmarks: serializeBookmarks,
    deserializeBookmarks: deserializeBookmarks,
    sceneRecipeForEvent: sceneRecipeForEvent
  });
}));
