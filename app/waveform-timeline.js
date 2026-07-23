/*
 * Signal Field — accessible waveform timeline
 *
 * Canvas paints the bounded waveform while semantic DOM controls edit the
 * canonical lyric ranges and beat points through timeline-editor-core.js.
 */
(function attachWaveformTimeline(globalScope, factory) {
  const api = factory(globalScope && globalScope.SignalFieldTimelineEditorCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldWaveformTimeline = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWaveformTimeline(Core) {
  'use strict';

  const VERSION = '1.0.0';
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 8;
  const MIN_LYRIC_MS = 100;

  function requireCore() {
    if (!Core || typeof Core.timeToX !== 'function') throw new Error('SignalFieldTimelineEditorCore is required.');
    return Core;
  }

  function formatTime(milliseconds, precise) {
    const value = Math.max(0, Math.round(Number(milliseconds) || 0));
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const fraction = value % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${precise ? `.${String(fraction).padStart(3, '0')}` : ''}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mount(root, optionsInput) {
    const Timeline = requireCore();
    if (!root || typeof root.querySelector !== 'function') throw new TypeError('Timeline root element is required.');
    const options = optionsInput || {};
    const viewport = root.querySelector('#directorTimelineViewport');
    const content = root.querySelector('#directorTimelineContent');
    const canvas = root.querySelector('#directorWaveformCanvas');
    const lyricsLane = root.querySelector('#directorLyricsLane');
    const beatLane = root.querySelector('#directorBeatLane');
    const playhead = root.querySelector('#directorTimelinePlayhead');
    const status = root.querySelector('#directorTimelineStatus');
    const timeOutput = root.querySelector('#directorTimelineTime');
    const zoomInput = root.querySelector('#directorTimelineZoom');
    const zoomValue = root.querySelector('#directorTimelineZoomValue');
    const zoomOut = root.querySelector('#directorTimelineZoomOut');
    const zoomIn = root.querySelector('#directorTimelineZoomIn');
    const fit = root.querySelector('#directorTimelineFit');
    const snap = root.querySelector('#directorTimelineSnap');
    if (![viewport, content, canvas, lyricsLane, beatLane, playhead, status, timeOutput, zoomInput, zoomValue, zoomOut, zoomIn, fit, snap].every(Boolean)) {
      throw new Error('Timeline DOM contract is incomplete.');
    }

    const state = {
      durationMs: 0,
      waveform: null,
      lyrics: [],
      beatEdits: [],
      beatGridMs: [],
      currentTimeMs: 0,
      zoom: 1,
      selected: null,
      drag: null,
      raf: 0,
      destroyed: false
    };

    function announce(message, error) {
      status.textContent = message;
      status.setAttribute('role', error ? 'alert' : 'status');
      status.classList.toggle('error', Boolean(error));
    }

    function viewportWidth() {
      return Math.max(1, viewport.clientWidth || root.clientWidth || 1);
    }

    function contentWidth() {
      return Math.max(1, viewportWidth() * state.zoom);
    }

    function scheduleWaveform() {
      if (state.destroyed || state.raf) return;
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        drawWaveform();
      });
    }

    function drawWaveform() {
      const width = viewportWidth();
      const height = 88;
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#090c12';
      context.fillRect(0, 0, width, height);

      const totalWidth = contentWidth();
      const visibleStart = state.durationMs ? viewport.scrollLeft / totalWidth * state.durationMs : 0;
      const visibleEnd = state.durationMs ? Math.min(state.durationMs, (viewport.scrollLeft + width) / totalWidth * state.durationMs) : 0;
      const visibleDuration = Math.max(1, visibleEnd - visibleStart);
      const tickChoices = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
      const tickMs = tickChoices.find((candidate) => candidate / visibleDuration * width >= 72) || 60000;
      context.font = '10px "SF Mono", ui-monospace, monospace';
      context.textBaseline = 'top';
      for (let time = Math.ceil(visibleStart / tickMs) * tickMs; time <= visibleEnd; time += tickMs) {
        const x = (time - visibleStart) / visibleDuration * width;
        context.fillStyle = 'rgba(255,255,255,.08)';
        context.fillRect(Math.round(x), 0, 1, height);
        context.fillStyle = '#8b93a8';
        context.fillText(formatTime(time, tickMs < 1000), Math.min(width - 48, x + 4), 5);
      }
      context.fillStyle = 'rgba(131,162,255,.18)';
      context.fillRect(0, 52, width, 1);
      if (!state.waveform || !state.waveform.buckets || !state.waveform.buckets.length || !state.durationMs) {
        context.fillStyle = '#8b93a8';
        context.fillText('波形不可用 · 歌词和节拍仍可编辑', 12, 35);
        return;
      }
      const mid = 54;
      const amplitude = 27;
      context.fillStyle = 'rgba(244,178,60,.78)';
      for (const bucket of state.waveform.buckets) {
        if (bucket.endMs < visibleStart || bucket.startMs > visibleEnd) continue;
        const startX = (bucket.startMs - visibleStart) / visibleDuration * width;
        const endX = (bucket.endMs - visibleStart) / visibleDuration * width;
        const x = Math.max(0, Math.floor(startX));
        const barWidth = Math.max(1, Math.ceil(endX - startX));
        const top = mid - Math.max(0, bucket.max) * amplitude;
        const bottom = mid - Math.min(0, bucket.min) * amplitude;
        context.fillRect(x, top, barWidth, Math.max(1, bottom - top));
      }
    }

    function editLabel(edit) {
      return edit.action === 'cut' ? '硬切' : edit.action === 'hold' ? '保持' : '强调';
    }

    function select(kind, index) {
      state.selected = { kind, index };
      lyricsLane.querySelectorAll('.director-lyric-cue').forEach((cue, cueIndex) => {
        const active = kind === 'lyric' && cueIndex === index;
        cue.classList.toggle('is-selected', active);
        const body = cue.querySelector('.director-lyric-body');
        if (body) body.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      beatLane.querySelectorAll('.director-beat-point').forEach((point, pointIndex) => {
        point.classList.toggle('is-selected', kind === 'beat' && pointIndex === index);
      });
    }

    function markerButton(className, label, kind, index, handle) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.editKind = kind;
      button.dataset.editIndex = String(index);
      if (handle) button.dataset.editHandle = handle;
      button.setAttribute('aria-label', label);
      return button;
    }

    function renderMarkers() {
      const width = contentWidth();
      content.style.width = `${width}px`;
      lyricsLane.innerHTML = '';
      beatLane.innerHTML = '';
      if (!state.durationMs) {
        playhead.style.left = '0px';
        return;
      }
      const mappedLyrics = Timeline.mapLyrics(state.lyrics, state.durationMs, width);
      if (!mappedLyrics.length) {
        const empty = document.createElement('span');
        empty.className = 'director-timeline-empty';
        empty.textContent = '粘贴或导入 LRC 后，可在这里拖动歌词。';
        lyricsLane.appendChild(empty);
      }
      mappedLyrics.forEach((cue) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'director-lyric-cue';
        wrapper.setAttribute('role', 'listitem');
        wrapper.style.left = `${cue.xStart}px`;
        wrapper.style.width = `${Math.max(2, cue.width)}px`;
        const selected = state.selected && state.selected.kind === 'lyric' && state.selected.index === cue.index;
        wrapper.classList.toggle('is-selected', Boolean(selected));
        const body = markerButton(
          'director-lyric-body',
          `歌词 ${cue.index + 1}，${cue.text}，${formatTime(cue.startMs, true)} 到 ${formatTime(cue.endMs, true)}。拖动可整体移动。`,
          'lyric', cue.index, 'range'
        );
        body.textContent = cue.text;
        body.setAttribute('aria-pressed', selected ? 'true' : 'false');
        const start = markerButton('director-lyric-handle start', `调整歌词 ${cue.index + 1} 开始时间`, 'lyric', cue.index, 'start');
        const end = markerButton('director-lyric-handle end', `调整歌词 ${cue.index + 1} 结束时间`, 'lyric', cue.index, 'end');
        for (const [button, value, label] of [[start, cue.startMs, '开始'], [end, cue.endMs, '结束']]) {
          button.setAttribute('role', 'slider');
          button.setAttribute('aria-valuemin', '0');
          button.setAttribute('aria-valuemax', String(state.durationMs));
          button.setAttribute('aria-valuenow', String(value));
          button.setAttribute('aria-valuetext', `${label} ${formatTime(value, true)}`);
        }
        wrapper.append(body, start, end);
        lyricsLane.appendChild(wrapper);
      });

      const mappedBeats = Timeline.mapBeatEdits(state.beatEdits, state.durationMs, width);
      if (!mappedBeats.length) {
        const empty = document.createElement('span');
        empty.className = 'director-timeline-empty';
        empty.textContent = '当前没有节拍切点。';
        beatLane.appendChild(empty);
      }
      mappedBeats.forEach((edit) => {
        const button = markerButton('director-beat-point', `节拍切点 ${edit.index + 1}，${editLabel(edit)}，${formatTime(edit.timeMs, true)}`, 'beat', edit.index, 'point');
        button.style.left = `${edit.x}px`;
        button.dataset.action = edit.action;
        button.setAttribute('role', 'slider');
        button.setAttribute('aria-valuemin', '0');
        button.setAttribute('aria-valuemax', String(state.durationMs));
        button.setAttribute('aria-valuenow', String(edit.timeMs));
        button.setAttribute('aria-valuetext', formatTime(edit.timeMs, true));
        button.classList.toggle('is-selected', Boolean(state.selected && state.selected.kind === 'beat' && state.selected.index === edit.index));
        button.innerHTML = `<span aria-hidden="true"></span>`;
        beatLane.appendChild(button);
      });
      updatePlayhead();
      scheduleWaveform();
    }

    function updatePlayhead() {
      const width = contentWidth();
      const time = Math.max(0, Math.min(state.durationMs || 0, state.currentTimeMs));
      playhead.style.left = `${state.durationMs ? Timeline.timeToX(time, state.durationMs, width) : 0}px`;
      timeOutput.textContent = `${formatTime(time, true)} / ${formatTime(state.durationMs, true)}`;
    }

    function beatMoveOptions(snapEnabled) {
      const result = { durationMs: state.durationMs, minimumGapMs: 1 };
      if (snapEnabled && state.beatGridMs.length) {
        result.snap = true;
        result.beatGridMs = state.beatGridMs;
        result.snapToleranceMs = Math.max(40, Math.round(state.durationMs / contentWidth() * 12));
      }
      return result;
    }

    function updateDraftMarker(kind, index) {
      const width = contentWidth();
      if (kind === 'lyric') {
        const cue = Timeline.mapLyrics(state.lyrics, state.durationMs, width)[index];
        const body = lyricsLane.querySelector(`[data-edit-kind="lyric"][data-edit-index="${index}"][data-edit-handle="range"]`);
        const wrapper = body && body.closest('.director-lyric-cue');
        if (wrapper && cue) {
          wrapper.style.left = `${cue.xStart}px`;
          wrapper.style.width = `${Math.max(2, cue.width)}px`;
          const start = wrapper.querySelector('[data-edit-handle="start"]');
          const end = wrapper.querySelector('[data-edit-handle="end"]');
          if (start) {
            start.setAttribute('aria-valuenow', String(cue.startMs));
            start.setAttribute('aria-valuetext', `开始 ${formatTime(cue.startMs, true)}`);
          }
          if (end) {
            end.setAttribute('aria-valuenow', String(cue.endMs));
            end.setAttribute('aria-valuetext', `结束 ${formatTime(cue.endMs, true)}`);
          }
        }
      } else {
        const edit = Timeline.mapBeatEdits(state.beatEdits, state.durationMs, width)[index];
        const point = beatLane.querySelector(`[data-edit-kind="beat"][data-edit-index="${index}"]`);
        if (point && edit) {
          point.style.left = `${edit.x}px`;
          point.setAttribute('aria-valuenow', String(edit.timeMs));
          point.setAttribute('aria-valuetext', formatTime(edit.timeMs, true));
        }
      }
      updatePlayhead();
      scheduleWaveform();
    }

    function applyDraft(kind, index, handle, operation, snapEnabled) {
      if (kind === 'lyric') {
        state.lyrics = Timeline.moveLyric(state.lyrics, index, operation, {
          durationMs: state.durationMs,
          minimumDurationMs: MIN_LYRIC_MS
        });
        state.currentTimeMs = handle === 'end' ? state.lyrics[index].endMs : state.lyrics[index].startMs;
        if (typeof options.onDraft === 'function') options.onDraft('lyric', clone(state.lyrics), state.currentTimeMs);
      } else {
        state.beatEdits = Timeline.moveBeatEdit(state.beatEdits, index, operation, beatMoveOptions(snapEnabled));
        state.currentTimeMs = state.beatEdits[index].timeMs;
        if (typeof options.onDraft === 'function') options.onDraft('beat', clone(state.beatEdits), state.currentTimeMs);
      }
      if (state.drag) updateDraftMarker(kind, index);
      else renderMarkers();
    }

    function commit(kind, index, handle) {
      try {
        if (kind === 'lyric' && typeof options.onLyricsChange === 'function') options.onLyricsChange(clone(state.lyrics));
        if (kind === 'beat' && typeof options.onBeatEditsChange === 'function') options.onBeatEditsChange(clone(state.beatEdits));
        const item = kind === 'lyric' ? state.lyrics[index] : state.beatEdits[index];
        const detail = kind === 'lyric'
          ? `歌词 ${index + 1} 已调整为 ${formatTime(item.startMs, true)}–${formatTime(item.endMs, true)}`
          : `节拍切点 ${index + 1} 已调整为 ${formatTime(item.timeMs, true)}`;
        announce(detail);
      } catch (error) {
        throw error;
      }
    }

    function restoreDrag(message) {
      if (!state.drag) return;
      state.lyrics = state.drag.beforeLyrics;
      state.beatEdits = state.drag.beforeBeats;
      state.currentTimeMs = state.drag.beforeTime;
      state.drag = null;
      renderMarkers();
      if (typeof options.onCancel === 'function') options.onCancel(clone(state.lyrics), clone(state.beatEdits), state.currentTimeMs);
      announce(message || '已取消时间轴调整。');
    }

    function pointerDown(event) {
      const marker = event.target.closest('[data-edit-kind]');
      if (!marker || !root.contains(marker) || !state.durationMs) return;
      const kind = marker.dataset.editKind;
      const index = Number(marker.dataset.editIndex);
      const handle = marker.dataset.editHandle || (kind === 'lyric' ? 'range' : 'point');
      select(kind, index);
      state.drag = {
        pointerId: event.pointerId,
        marker,
        kind,
        index,
        handle,
        startX: event.clientX,
        beforeLyrics: clone(state.lyrics),
        beforeBeats: clone(state.beatEdits),
        beforeTime: state.currentTimeMs,
        moved: false
      };
      marker.setPointerCapture(event.pointerId);
      if (typeof options.onEditStart === 'function') options.onEditStart(kind, index);
      event.preventDefault();
    }

    function pointerMove(event) {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(deltaX) < 4) return;
      drag.moved = true;
      try {
        if (drag.kind === 'lyric') {
          const deltaMs = Math.round(deltaX / contentWidth() * state.durationMs);
          state.lyrics = clone(drag.beforeLyrics);
          applyDraft('lyric', drag.index, drag.handle, { type: 'drag', handle: drag.handle, deltaMs }, false);
        } else {
          const origin = drag.beforeBeats[drag.index].timeMs;
          const timeMs = origin + Math.round(deltaX / contentWidth() * state.durationMs);
          state.beatEdits = clone(drag.beforeBeats);
          applyDraft('beat', drag.index, drag.handle, { type: 'drag', timeMs }, snap.value !== 'off' && !event.altKey);
        }
      } catch (error) {
        announce(`无法调整：${error.message || error}`, true);
      }
      event.preventDefault();
    }

    function pointerEnd(event, cancelled) {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (cancelled) { restoreDrag('调整已取消，原位置已恢复。'); return; }
      state.drag = null;
      if (!drag.moved) {
        const item = drag.kind === 'lyric' ? state.lyrics[drag.index] : state.beatEdits[drag.index];
        const time = drag.kind === 'lyric' ? item.startMs : item.timeMs;
        setCurrentTime(time);
        if (typeof options.onSeek === 'function') options.onSeek(time, { source: 'marker-select' });
        return;
      }
      try {
        commit(drag.kind, drag.index, drag.handle);
      } catch (error) {
        state.drag = drag;
        restoreDrag(`调整未保存：${error.message || error}`);
        status.setAttribute('role', 'alert');
      }
    }

    function keyboardEdit(event, marker) {
      const kind = marker.dataset.editKind;
      const index = Number(marker.dataset.editIndex);
      const handle = marker.dataset.editHandle || (kind === 'lyric' ? 'range' : 'point');
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
      event.preventDefault();
      if (typeof options.onEditStart === 'function') options.onEditStart(kind, index);
      const direction = event.key === 'ArrowLeft' || event.key === 'Home' ? -1 : 1;
      const stepMs = event.key === 'Home' || event.key === 'End'
        ? state.durationMs
        : event.metaKey || event.ctrlKey ? 1000 : event.shiftKey ? 100 : 10;
      const beforeLyrics = clone(state.lyrics);
      const beforeBeats = clone(state.beatEdits);
      try {
        const operation = kind === 'lyric'
          ? { type: 'keyboard', handle, direction, stepMs }
          : { type: 'keyboard', direction, stepMs };
        applyDraft(kind, index, handle, operation, kind === 'beat' && snap.value !== 'off' && !event.altKey);
        commit(kind, index, handle);
        const replacement = root.querySelector(`[data-edit-kind="${kind}"][data-edit-index="${index}"][data-edit-handle="${handle}"]`);
        if (replacement) replacement.focus({ preventScroll: true });
      } catch (error) {
        state.lyrics = beforeLyrics;
        state.beatEdits = beforeBeats;
        renderMarkers();
        announce(`调整未保存：${error.message || error}`, true);
      }
      return true;
    }

    function keyDown(event) {
      const marker = event.target.closest('[data-edit-kind]');
      if (marker && keyboardEdit(event, marker)) return;
      if (event.key === 'Escape') {
        if (state.drag) restoreDrag();
        else { state.selected = null; renderMarkers(); }
        return;
      }
      if (event.target === viewport && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const step = event.shiftKey ? 1000 : 100;
        const next = state.currentTimeMs + (event.key === 'ArrowRight' ? step : -step);
        setCurrentTime(next);
        if (typeof options.onSeek === 'function') options.onSeek(state.currentTimeMs, { source: 'timeline-keyboard' });
      } else if (event.target === viewport && event.key === ' ') {
        event.preventDefault();
        if (typeof options.onTogglePlayback === 'function') options.onTogglePlayback();
      }
    }

    function viewportClick(event) {
      if (event.target.closest('[data-edit-kind]') || state.drag || !state.durationMs) return;
      const bounds = viewport.getBoundingClientRect();
      const x = event.clientX - bounds.left + viewport.scrollLeft;
      const time = Timeline.xToTime(x, state.durationMs, contentWidth());
      setCurrentTime(time);
      if (typeof options.onSeek === 'function') options.onSeek(time, { source: 'timeline-click' });
    }

    function setZoom(value) {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(Number(value) || 1)));
      const oldWidth = contentWidth();
      const anchor = state.durationMs ? Timeline.timeToX(state.currentTimeMs, state.durationMs, oldWidth) - viewport.scrollLeft : viewportWidth() / 2;
      state.zoom = next;
      zoomInput.value = String(next);
      zoomValue.textContent = next === 1 ? '适合窗口' : `${next}×`;
      renderMarkers();
      const newWidth = contentWidth();
      const nextPlayheadX = state.durationMs ? Timeline.timeToX(state.currentTimeMs, state.durationMs, newWidth) : 0;
      viewport.scrollLeft = Math.max(0, nextPlayheadX - anchor);
      scheduleWaveform();
    }

    function setData(dataInput) {
      const data = dataInput || {};
      state.durationMs = Math.max(0, Math.round(Number(data.durationMs) || 0));
      state.waveform = data.waveform || null;
      state.lyrics = clone(data.lyrics || []);
      state.beatEdits = clone(data.beatEdits || []);
      state.beatGridMs = clone(data.beatGridMs || []);
      state.currentTimeMs = Math.min(state.currentTimeMs, state.durationMs);
      root.hidden = !state.durationMs;
      root.setAttribute('aria-busy', 'false');
      snap.disabled = !state.beatGridMs.length;
      if (!state.beatGridMs.length) snap.value = 'off';
      renderMarkers();
      announce(state.waveform ? `波形已生成 · ${state.waveform.bucketCount} 个峰值桶 · 可拖动歌词和节拍点。` : '波形不可用；歌词和节拍仍可编辑。');
    }

    function setCurrentTime(value) {
      state.currentTimeMs = Math.max(0, Math.min(state.durationMs || 0, Math.round(Number(value) || 0)));
      updatePlayhead();
    }

    function setLyrics(value) {
      state.lyrics = clone(value || []);
      renderMarkers();
    }

    function setBeatEdits(value) {
      state.beatEdits = clone(value || []);
      renderMarkers();
    }

    function snapshot() {
      return {
        durationMs: state.durationMs,
        waveformBuckets: state.waveform ? state.waveform.bucketCount : 0,
        lyricCount: state.lyrics.length,
        beatCount: state.beatEdits.length,
        currentTimeMs: state.currentTimeMs,
        zoom: state.zoom,
        contentWidth: contentWidth(),
        viewportWidth: viewportWidth(),
        canvasWidth: canvas.width,
        canvasCssWidth: parseFloat(canvas.style.width) || 0,
        selected: state.selected ? clone(state.selected) : null
      };
    }

    root.addEventListener('pointerdown', pointerDown);
    root.addEventListener('pointermove', pointerMove);
    root.addEventListener('pointerup', (event) => pointerEnd(event, false));
    root.addEventListener('pointercancel', (event) => pointerEnd(event, true));
    root.addEventListener('keydown', keyDown);
    viewport.addEventListener('click', viewportClick);
    viewport.addEventListener('scroll', scheduleWaveform, { passive: true });
    zoomInput.addEventListener('input', () => setZoom(zoomInput.value));
    zoomOut.addEventListener('click', () => setZoom(state.zoom - 1));
    zoomIn.addEventListener('click', () => setZoom(state.zoom + 1));
    fit.addEventListener('click', () => setZoom(1));
    snap.addEventListener('change', () => announce(snap.value === 'off' ? '节拍吸附已关闭。' : '节拍点会吸附到分析出的节拍网格。'));
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => renderMarkers()) : null;
    if (resizeObserver) resizeObserver.observe(viewport);

    return Object.freeze({
      setData,
      setCurrentTime,
      setLyrics,
      setBeatEdits,
      setZoom,
      state: snapshot,
      destroy() {
        state.destroyed = true;
        if (state.raf) cancelAnimationFrame(state.raf);
        if (resizeObserver) resizeObserver.disconnect();
        root.replaceChildren();
      }
    });
  }

  return Object.freeze({ VERSION, mount, formatTime });
}));
