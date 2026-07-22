/*
 * Signal Field — deterministic production title and lyric overlay
 *
 * Dependency-free Canvas 2D drawing shared by browser preview and video export.
 */
(function attachProductionOverlay(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldProductionOverlay = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createProductionOverlay() {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'signal-field-production/v1';
  const TITLE_TEMPLATES = ['none', 'minimal', 'cinematic', 'kinetic'];
  const ASPECTS = ['16:9', '9:16', '1:1'];
  const ACCENT_DURATION_MS = 280;
  const HOLD_DURATION_MS = 500;
  const FONT_FAMILY = 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function finite(value, fallback, minimum, maximum, label) {
    const number = value == null ? fallback : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) {
      throw new RangeError(label + ' must be a finite number between ' + minimum + ' and ' + maximum + '.');
    }
    return number;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function requireSpec(spec) {
    if (!plain(spec) || spec.schema !== SCHEMA || spec.version !== 1) throw new TypeError('A canonical signal-field-production/v1 specification is required.');
    if (ASPECTS.indexOf(spec.aspect) < 0 || !plain(spec.titleCard) || TITLE_TEMPLATES.indexOf(spec.titleCard.template) < 0) {
      throw new TypeError('Production title and aspect settings are invalid.');
    }
    if (!Array.isArray(spec.lyrics) || !Array.isArray(spec.beatEdits)) throw new TypeError('Production lyrics and beat edits are required.');
    return spec;
  }

  function activeLyricAt(spec, timeMs) {
    let low = 0;
    let high = spec.lyrics.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const cue = spec.lyrics[middle];
      if (timeMs < cue.startMs) high = middle - 1;
      else if (timeMs >= cue.endMs) low = middle + 1;
      else return cue;
    }
    return null;
  }

  function recentBeatStrength(spec, timeMs, action, durationMs) {
    for (let index = spec.beatEdits.length - 1; index >= 0; index -= 1) {
      const edit = spec.beatEdits[index];
      if (edit.timeMs > timeMs) continue;
      const elapsed = timeMs - edit.timeMs;
      if (elapsed > durationMs) return 0;
      if (edit.action === action) {
        const progress = elapsed / durationMs;
        const envelope = action === 'accent' ? Math.pow(1 - progress, 2) : Math.min(1, (1 - progress) * 1.35);
        return clamp(edit.intensity * envelope, 0, 1);
      }
    }
    return 0;
  }

  function frameState(specInput, timeMs, options) {
    const spec = requireSpec(specInput);
    const time = finite(timeMs, 0, -86400000, 86400000, 'timeMs');
    const settings = options == null ? {} : options;
    if (!plain(settings)) throw new TypeError('Overlay options must be a plain object.');
    const externalAccent = finite(settings.accentPulse, 0, 0, 1, 'accentPulse');
    const externalHold = finite(settings.holdPulse, 0, 0, 1, 'holdPulse');
    const titleVisible = spec.titleCard.template !== 'none' && time >= 0 && time < spec.titleCard.durationMs;
    return {
      timeMs: time,
      template: spec.titleCard.template,
      titleVisible: titleVisible,
      titleProgress: titleVisible && spec.titleCard.durationMs > 0 ? clamp(time / spec.titleCard.durationMs, 0, 1) : 0,
      lyric: activeLyricAt(spec, time),
      accent: Math.max(externalAccent, recentBeatStrength(spec, time, 'accent', ACCENT_DURATION_MS)),
      hold: Math.max(externalHold, recentBeatStrength(spec, time, 'hold', HOLD_DURATION_MS)),
      reducedMotion: Boolean(settings.reducedMotion)
    };
  }

  function targetContext(canvasOrContext) {
    if (canvasOrContext && typeof canvasOrContext.getContext === 'function') {
      const context = canvasOrContext.getContext('2d');
      if (!context) throw new TypeError('Overlay canvas does not provide a 2D context.');
      return { context: context, canvas: canvasOrContext };
    }
    if (canvasOrContext && typeof canvasOrContext.save === 'function' && canvasOrContext.canvas) {
      return { context: canvasOrContext, canvas: canvasOrContext.canvas };
    }
    throw new TypeError('drawOverlay requires a Canvas or CanvasRenderingContext2D.');
  }

  function geometry(target, options) {
    const dpr = finite(options.dpr, 1, 0.25, 8, 'dpr');
    const width = finite(options.width, target.canvas.width / dpr, 1, 16384, 'width');
    const height = finite(options.height, target.canvas.height / dpr, 1, 16384, 'height');
    return { width: width, height: height, dpr: dpr };
  }

  function safeArea(width, height, aspect) {
    const portrait = aspect === '9:16';
    const square = aspect === '1:1';
    const horizontal = width * (portrait ? 0.075 : (square ? 0.07 : 0.06));
    const vertical = height * (portrait ? 0.055 : (square ? 0.065 : 0.075));
    return { x: horizontal, y: vertical, width: width - horizontal * 2, height: height - vertical * 2 };
  }

  function setFont(context, weight, size) {
    context.font = weight + ' ' + Math.max(10, Math.round(size)) + 'px ' + FONT_FAMILY;
  }

  function measure(context, text) {
    const result = context.measureText(String(text));
    return result && Number.isFinite(result.width) ? result.width : String(text).length * 10;
  }

  function wrapText(context, text, maximumWidth, maximumLines) {
    const paragraphs = String(text).split(/\n/);
    const lines = [];
    paragraphs.forEach(function wrapParagraph(paragraph) {
      if (!paragraph) {
        if (lines.length < maximumLines) lines.push('');
        return;
      }
      const tokens = /\s/.test(paragraph) ? paragraph.split(/\s+/) : Array.from(paragraph);
      const separator = /\s/.test(paragraph) ? ' ' : '';
      let line = '';
      tokens.forEach(function addToken(token) {
        if (lines.length >= maximumLines) return;
        const candidate = line ? line + separator + token : token;
        if (line && measure(context, candidate) > maximumWidth) {
          lines.push(line);
          line = token;
        } else line = candidate;
      });
      if (line && lines.length < maximumLines) lines.push(line);
    });
    if (lines.length === maximumLines) {
      let finalLine = lines[maximumLines - 1];
      while (finalLine.length > 1 && measure(context, finalLine + '…') > maximumWidth) finalLine = finalLine.slice(0, -1);
      lines[maximumLines - 1] = finalLine + (finalLine !== lines[maximumLines - 1] ? '…' : '');
    }
    return lines.slice(0, maximumLines);
  }

  function drawBackdrop(context, x, y, width, height, alpha) {
    context.fillStyle = 'rgba(3, 5, 9, ' + clamp(alpha, 0, 0.9).toFixed(3) + ')';
    context.fillRect(x, y, width, height);
  }

  function drawMinimalTitle(context, card, area, scale, opacity) {
    const mainSize = scale * 0.054;
    const subtitleSize = scale * 0.022;
    const x = area.x;
    const y = area.y + mainSize;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = 'rgba(255,255,255,' + opacity.toFixed(3) + ')';
    setFont(context, '650', mainSize);
    context.fillText(card.mainTitle, x, y, area.width * 0.72);
    if (card.subtitle) {
      context.fillStyle = 'rgba(230,236,244,' + (opacity * 0.78).toFixed(3) + ')';
      setFont(context, '450', subtitleSize);
      context.fillText(card.subtitle, x, y + subtitleSize * 1.8, area.width * 0.72);
    }
    context.fillStyle = 'rgba(111,220,255,' + (opacity * 0.9).toFixed(3) + ')';
    context.fillRect(x, y + subtitleSize * 2.6, Math.min(area.width * 0.13, scale * 0.12), Math.max(2, scale * 0.003));
  }

  function drawCinematicTitle(context, card, area, scale, opacity) {
    const mainSize = scale * 0.07;
    const subtitleSize = scale * 0.023;
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height * 0.43;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(255,255,255,' + opacity.toFixed(3) + ')';
    context.shadowColor = 'rgba(0,0,0,0.65)';
    context.shadowBlur = scale * 0.02;
    setFont(context, '700', mainSize);
    context.fillText(card.mainTitle, centerX, centerY, area.width * 0.9);
    context.shadowBlur = 0;
    if (card.subtitle) {
      context.fillStyle = 'rgba(224,232,242,' + (opacity * 0.82).toFixed(3) + ')';
      setFont(context, '400', subtitleSize);
      context.fillText(card.subtitle, centerX, centerY + mainSize * 0.95, area.width * 0.76);
    }
  }

  function drawKineticTitle(context, card, area, scale, opacity, progress, reducedMotion) {
    const mainSize = scale * 0.075;
    const subtitleSize = scale * 0.024;
    const motion = reducedMotion ? 0 : Math.sin(progress * Math.PI * 4) * scale * 0.008;
    const tilt = reducedMotion ? 0 : Math.sin(progress * Math.PI * 2) * 0.018;
    const centerX = area.x + area.width / 2 + motion;
    const centerY = area.y + area.height * 0.39;
    context.translate(centerX, centerY);
    context.rotate(tilt);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(119,229,255,' + (opacity * 0.32).toFixed(3) + ')';
    setFont(context, '800', mainSize);
    context.fillText(card.mainTitle, scale * 0.007, scale * 0.007, area.width * 0.92);
    context.fillStyle = 'rgba(255,255,255,' + opacity.toFixed(3) + ')';
    context.fillText(card.mainTitle, 0, 0, area.width * 0.92);
    if (card.subtitle) {
      context.fillStyle = 'rgba(234,241,248,' + (opacity * 0.82).toFixed(3) + ')';
      setFont(context, '500', subtitleSize);
      context.fillText(card.subtitle, 0, mainSize * 0.95, area.width * 0.78);
    }
  }

  function drawLyric(context, cue, area, scale) {
    const fontSize = clamp(scale * 0.032, 18, 72);
    setFont(context, '650', fontSize);
    const lines = wrapText(context, cue.text, area.width * 0.84, 3);
    const lineHeight = fontSize * 1.35;
    const boxWidth = Math.min(area.width * 0.94, Math.max.apply(Math, lines.map(function lineWidth(line) { return measure(context, line); })) + fontSize * 1.8);
    const boxHeight = lineHeight * lines.length + fontSize * 0.75;
    const centerX = area.x + area.width / 2;
    const bottom = area.y + area.height;
    drawBackdrop(context, centerX - boxWidth / 2, bottom - boxHeight, boxWidth, boxHeight, 0.56);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(255,255,255,0.98)';
    context.shadowColor = 'rgba(0,0,0,0.75)';
    context.shadowBlur = fontSize * 0.2;
    lines.forEach(function drawLine(line, index) {
      context.fillText(line, centerX, bottom - boxHeight + fontSize * 0.42 + lineHeight * (index + 0.5), boxWidth - fontSize);
    });
    context.shadowBlur = 0;
  }

  function clearOverlay(canvasOrContext, options) {
    const target = targetContext(canvasOrContext);
    const settings = options == null ? {} : options;
    if (!plain(settings)) throw new TypeError('Overlay options must be a plain object.');
    const size = geometry(target, settings);
    target.context.save();
    target.context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    target.context.clearRect(0, 0, size.width, size.height);
    target.context.restore();
    return size;
  }

  function drawOverlay(canvasOrContext, specInput, timeMs, options) {
    const spec = requireSpec(specInput);
    const settings = options == null ? {} : options;
    if (!plain(settings)) throw new TypeError('Overlay options must be a plain object.');
    const target = targetContext(canvasOrContext);
    const size = geometry(target, settings);
    const state = frameState(spec, timeMs, settings);
    const area = safeArea(size.width, size.height, spec.aspect);
    const scale = Math.min(size.width, size.height);
    const context = target.context;
    context.save();
    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    if (state.hold > 0) {
      context.fillStyle = 'rgba(2,4,8,' + (state.hold * 0.18).toFixed(3) + ')';
      context.fillRect(0, 0, size.width, size.height);
    }
    if (state.accent > 0) {
      const thickness = Math.max(2, scale * (0.003 + state.accent * 0.008));
      context.strokeStyle = 'rgba(146,235,255,' + (state.accent * 0.68).toFixed(3) + ')';
      context.lineWidth = thickness;
      context.strokeRect(thickness / 2, thickness / 2, size.width - thickness, size.height - thickness);
    }

    if (state.titleVisible) {
      const fadeIn = clamp(state.titleProgress / 0.12, 0, 1);
      const fadeOut = clamp((1 - state.titleProgress) / 0.16, 0, 1);
      const opacity = state.reducedMotion ? 1 : Math.min(fadeIn, fadeOut);
      context.save();
      if (state.template === 'minimal') drawMinimalTitle(context, spec.titleCard, area, scale, opacity);
      else if (state.template === 'cinematic') drawCinematicTitle(context, spec.titleCard, area, scale, opacity);
      else if (state.template === 'kinetic') drawKineticTitle(context, spec.titleCard, area, scale, opacity, state.titleProgress, state.reducedMotion);
      context.restore();
    }
    if (state.lyric) drawLyric(context, state.lyric, area, scale);
    context.restore();

    return {
      drawn: state.titleVisible || Boolean(state.lyric) || state.accent > 0 || state.hold > 0,
      titleVisible: state.titleVisible,
      lyric: state.lyric ? { startMs: state.lyric.startMs, endMs: state.lyric.endMs, text: state.lyric.text } : null,
      template: state.template,
      accent: state.accent,
      hold: state.hold,
      safeArea: area
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    ACCENT_DURATION_MS: ACCENT_DURATION_MS,
    HOLD_DURATION_MS: HOLD_DURATION_MS,
    frameState: frameState,
    drawOverlay: drawOverlay,
    clearOverlay: clearOverlay
  });
}));
