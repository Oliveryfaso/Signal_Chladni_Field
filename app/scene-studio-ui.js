/*
 * Signal Field — Scene Studio browser integration
 *
 * Keeps UI, local persistence and playback outside the renderer core. Projects
 * are validated by scene-studio.js before they can replace the current state.
 */
(function mountSignalFieldSceneStudio() {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.get('overlay') === '1' || params.get('nativeOverlay') === '1' || params.get('parity') === '1') return;

  const Studio = window.SignalFieldSceneStudio;
  const Director = window.SignalFieldMusicDirector;
  const LyricTiming = window.SignalFieldLyricTiming;
  const Production = window.SignalFieldProductionSpec;
  const ProductionOverlay = window.SignalFieldProductionOverlay;
  const TimelineCore = window.SignalFieldTimelineEditorCore;
  const WaveformTimeline = window.SignalFieldWaveformTimeline;
  const Desktop = window.soundMotionDesktop;
  const target = window.soundMotionNative;
  const testApi = window.soundMotionTest;
  const root = document.getElementById('sceneStudio');
  if (!Studio || !target || !testApi || !root) return;

  const STORAGE_KEY = 'signalFieldSceneProjectV1';
  const SCENE_SPAN_MS = 4000;
  const APPLY_INTERVAL_MS = 90;
  const list = document.getElementById('sceneList');
  const captureButton = document.getElementById('sceneCapture');
  const overwriteButton = document.getElementById('sceneOverwrite');
  const importButton = document.getElementById('sceneImport');
  const exportButton = document.getElementById('sceneExport');
  const fileInput = document.getElementById('sceneProjectFile');
  const playButton = document.getElementById('scenePlay');
  const timeline = document.getElementById('sceneTimeline');
  const timeLabel = document.getElementById('sceneTime');
  const status = document.getElementById('sceneStatus');
  const directorRoot = document.getElementById('musicDirector');
  const directorFileInput = document.getElementById('directorAudioFile');
  const directorFileName = document.getElementById('directorFileName');
  const directorTemplates = document.getElementById('directorTemplates');
  const directorAspects = document.getElementById('directorAspects');
  const directorDuration = document.getElementById('directorDuration');
  const directorGenerate = document.getElementById('directorGenerate');
  const directorPreview = document.getElementById('directorPreview');
  const directorExport = document.getElementById('directorExport');
  const directorStatus = document.getElementById('directorStatus');
  const directorCues = document.getElementById('directorCues');
  const directorFinishing = document.getElementById('directorFinishing');
  const directorTitleTemplate = document.getElementById('directorTitleTemplate');
  const directorTitleText = document.getElementById('directorTitleText');
  const directorSubtitleText = document.getElementById('directorSubtitleText');
  const directorLyricsText = document.getElementById('directorLyricsText');
  const directorLyricsFile = document.getElementById('directorLyricsFile');
  const directorLyricsDraft = document.getElementById('directorLyricsDraft');
  const directorLyricsClear = document.getElementById('directorLyricsClear');
  const directorLyricsStatus = document.getElementById('directorLyricsStatus');
  const directorBeatDensity = document.getElementById('directorBeatDensity');
  const directorBeatSummary = document.getElementById('directorBeatSummary');
  const directorBeatCues = document.getElementById('directorBeatCues');
  const directorBeatReset = document.getElementById('directorBeatReset');
  const directorTimelineEditor = document.getElementById('directorTimelineEditor');
  const directorTimelinePlay = document.getElementById('directorTimelinePlay');
  const directorRender = document.getElementById('directorRender');
  const directorRenderHint = document.getElementById('directorRenderHint');
  const directorQueue = document.getElementById('directorQueue');
  const directorQueueStatus = document.getElementById('directorQueueStatus');
  const productionCanvas = document.getElementById('video-overlay-canvas');

  let store = Studio.createStore(Studio.createProject({
    title: '我的 Signal Field 项目',
    timeline: { durationMs: 0, keyframes: [] }
  }));
  let selectedId = null;
  let playbackFrame = 0;
  let playbackStartedAt = 0;
  let playbackRunning = false;
  let playbackStartedDemo = false;
  let playbackUsingFile = false;
  let previousSource = null;
  let lastAppliedSnapshot = null;
  let lastApplyAt = -Infinity;
  let musicFile = null;
  let musicMeta = null;
  let directionPlan = null;
  let directionAnalysis = null;
  let productionSpec = null;
  let parsedLyrics = [];
  let editableBeatEdits = null;
  let waveformData = null;
  let waveformError = null;
  let beatGridMs = [];
  let timelineEditor = null;
  const renderTasks = new Map();
  let directionGeneration = 0;
  let selectedTemplate = 'ambient-orbit';
  let selectedAspect = '16:9';

  function safeLoad() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const attempt = store.tryImportJSON(saved);
      if (!attempt.ok) localStorage.removeItem(STORAGE_KEY);
    } catch (_error) {}
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, store.exportJSON({ pretty: false })); } catch (_error) {}
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(isError));
  }

  function setDirectorStatus(message, isError) {
    if (!directorStatus) return;
    directorStatus.textContent = message;
    directorStatus.classList.toggle('error', Boolean(isError));
    directorStatus.setAttribute('role', isError ? 'alert' : 'status');
  }

  function formatTime(milliseconds) {
    const totalTenths = Math.max(0, Math.round(milliseconds / 100));
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`;
  }

  function formatLrcTime(milliseconds) {
    const value = Math.max(0, Math.round(milliseconds));
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const fraction = value % 1000;
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}]`;
  }

  function serializeLyricsForLrc(lyrics) {
    return lyrics.map((cue) => `${formatLrcTime(cue.startMs)} ${cue.text}`).join('\n');
  }

  function safeOutputBase(value) {
    return String(value || 'signal-field-video').replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'signal-field-video';
  }

  function parseLrc(serialized, durationMs) {
    const rows = [];
    const metadata = /^\[(ar|ti|al|by|offset):/i;
    String(serialized || '').split(/\r?\n/).forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || metadata.test(trimmed)) return;
      const match = trimmed.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.+)$/);
      if (!match) throw new Error(`第 ${lineIndex + 1} 行缺少 [分钟:秒.毫秒] 时间戳`);
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      const startMs = Math.round((Number(match[1]) * 60 + Number(match[2]) + fraction) * 1000);
      if (startMs < 0 || startMs >= durationMs) throw new Error(`第 ${lineIndex + 1} 行时间超出短片范围`);
      if (rows.length && startMs <= rows[rows.length - 1].startMs) throw new Error('歌词时间戳必须严格递增且不能重复');
      rows.push({ startMs, text: match[4].trim() });
    });
    return rows.map((cue, index) => {
      const next = rows[index + 1];
      const endMs = Math.min(durationMs, next ? next.startMs : cue.startMs + 5000, cue.startMs + 8000);
      if (endMs <= cue.startMs) throw new Error('歌词时间区间无效');
      return { startMs: cue.startMs, endMs, text: cue.text };
    });
  }

  function automaticBeatEditsForCurrentProject() {
    if (!directionPlan || !directionAnalysis) return [];
    const project = store.getProject();
    const durationMs = project.timeline.durationMs;
    const scenes = project.scenes;
    if (!durationMs || !scenes.length) return [];
    const tempo = directionAnalysis.tempo || {};
    const density = directorBeatDensity ? directorBeatDensity.value : 'balanced';
    const multipliers = { relaxed: 4, balanced: 2, punchy: 1 };
    const edits = [];
    if (tempo.confidence >= 0.25 && tempo.beatMs > 0) {
      const interval = tempo.beatMs * multipliers[density];
      for (let time = interval; time < durationMs && edits.length < 2000; time += interval) {
        const index = edits.length;
        const scene = scenes[Math.min(scenes.length - 1, Math.floor((time / durationMs) * scenes.length))];
        const hardCut = density === 'relaxed' || index % (density === 'punchy' ? 4 : 2) === 0;
        edits.push({
          timeMs: Math.round(time),
          action: hardCut ? 'cut' : 'accent',
          intensity: hardCut ? 0.75 : (density === 'punchy' ? 0.9 : 0.55),
          targetSceneId: hardCut ? scene.id : null
        });
      }
    } else {
      directionPlan.cues.slice(1).forEach((cue, index) => {
        if (cue.timeMs >= durationMs) return;
        const scene = scenes[Math.min(scenes.length - 1, index + 1)];
        edits.push({ timeMs: Math.round(cue.timeMs), action: 'cut', intensity: 0.65, targetSceneId: scene.id });
      });
    }
    return edits;
  }

  function beatEditsForCurrentProject() {
    return editableBeatEdits ? editableBeatEdits.map((edit) => ({ ...edit })) : automaticBeatEditsForCurrentProject();
  }

  function renderBeatSummary(edits) {
    if (!directorBeatSummary || !directorBeatCues) return;
    const tempo = directionAnalysis && directionAnalysis.tempo;
    const cuts = edits.filter((edit) => edit.action === 'cut').length;
    const accents = edits.filter((edit) => edit.action === 'accent').length;
    directorBeatSummary.textContent = (tempo && tempo.confidence >= 0.25
      ? `${Math.round(tempo.bpm)} BPM · ${cuts} 个硬切 · ${accents} 个强调`
      : `自由节奏 · ${cuts} 个段落切点`) + (editableBeatEdits ? ' · 已手动调整' : '');
    directorBeatCues.innerHTML = '';
    edits.slice(0, 12).forEach((edit) => {
      const chip = document.createElement('span');
      chip.className = 'director-cue';
      chip.textContent = `${formatTime(edit.timeMs)} · ${edit.action === 'cut' ? '切' : '强调'}`;
      directorBeatCues.appendChild(chip);
    });
    if (edits.length > 12) {
      const more = document.createElement('span'); more.className = 'director-cue'; more.textContent = `＋${edits.length - 12}`; directorBeatCues.appendChild(more);
    }
  }

  function buildProductionSpec(options) {
    if (!Production || !directionPlan) return null;
    const template = directorTitleTemplate.value;
    const codec = options && options.codec === 'prores' ? 'prores' : 'h264';
    const base = safeOutputBase(directorTitleText.value || (musicMeta && musicMeta.name));
    const edits = beatEditsForCurrentProject();
    const spec = Production.create({
      project: store.getProject(),
      aspect: selectedAspect,
      titleCard: {
        template,
        mainTitle: directorTitleText.value.trim(),
        subtitle: directorSubtitleText.value.trim()
      },
      lyrics: parsedLyrics,
      beatEdits: edits,
      output: { codec, fileName: `${base}.${codec === 'prores' ? 'mov' : 'mp4'}` }
    });
    productionSpec = spec;
    renderBeatSummary(edits);
    return spec;
  }

  function updateProductionSpec() {
    if (!directionPlan || !Production) return null;
    try {
      const spec = buildProductionSpec();
      directorRender.disabled = false;
      drawProductionOverlay(Number(timeline.value) || 0);
      if (timelineEditor) {
        timelineEditor.setLyrics(spec.lyrics);
        timelineEditor.setBeatEdits(spec.beatEdits);
      }
      return spec;
    } catch (error) {
      directorRender.disabled = true;
      setDirectorStatus(`成片设置无效：${error.message || error}`, true);
      return null;
    }
  }

  function productionSnapshot(timeMs, fallback) {
    if (!productionSpec || !productionSpec.beatEdits.length) return fallback;
    let cut = null;
    for (const edit of productionSpec.beatEdits) {
      if (edit.timeMs > timeMs) break;
      if (edit.action === 'cut' && edit.targetSceneId) cut = edit;
    }
    if (!cut) return fallback;
    const nextKeyframe = store.getProject().timeline.keyframes.find((keyframe) => keyframe.timeMs > cut.timeMs);
    if (nextKeyframe && timeMs >= nextKeyframe.timeMs) return fallback;
    const scene = store.getProject().scenes.find((candidate) => candidate.id === cut.targetSceneId);
    return scene ? scene.snapshot : fallback;
  }

  function drawProductionOverlay(timeMs) {
    if (!productionCanvas || !ProductionOverlay) return;
    if (!productionSpec) { ProductionOverlay.clearOverlay(productionCanvas); return; }
    const bounds = productionCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
    const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
    if (productionCanvas.width !== pixelWidth) productionCanvas.width = pixelWidth;
    if (productionCanvas.height !== pixelHeight) productionCanvas.height = pixelHeight;
    ProductionOverlay.drawOverlay(productionCanvas, productionSpec, timeMs, {
      width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), dpr,
      reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    });
  }

  function captureSnapshot() {
    const state = testApi.state();
    let pattern = {};
    try { pattern = JSON.parse(target.exportPatternJSON()); } catch (_error) {}
    return Studio.createSnapshot({
      style: state.style,
      sampleMode: state.sampleMode,
      rotationMode: state.rotationMode,
      solidShape: state.solidShape,
      parameters: {
        detail: state.detail,
        particles: state.particles,
        evolve: Number(document.getElementById('evolve').value),
        zoom: state.zoom,
        rotationSpeed: state.rotationSpeed,
        faces: state.faces,
        light: state.light,
        patternInterval: state.patternInterval
      },
      toggles: {
        rotation: state.rotation,
        symmetry: state.symmetric,
        frame: state.frame,
        transparent: state.transparent
      },
      pattern
    });
  }

  function sceneKeyframeId(sceneId) {
    return `scene-keyframe-${sceneId}`;
  }

  function addSceneFromCurrent() {
    stopPlayback(false);
    const project = store.getProject();
    const sceneNumber = project.scenes.length + 1;
    const scene = store.addScene({ name: `场景 ${sceneNumber}`, snapshot: captureSnapshot() });
    const keyframeTime = project.timeline.keyframes.length ? project.timeline.durationMs : 0;
    const nextDuration = Math.max(SCENE_SPAN_MS, keyframeTime + SCENE_SPAN_MS);
    store.setTimelineDuration(nextDuration);
    store.upsertKeyframe({ id: sceneKeyframeId(scene.id), timeMs: keyframeTime, snapshot: scene.snapshot });
    selectedId = scene.id;
    persist();
    render();
    setStatus(`已捕获“${scene.name}” · 时间线 ${formatTime(nextDuration)}`);
  }

  function overwriteSelected() {
    if (!selectedId || !store.getScene(selectedId)) return;
    stopPlayback(false);
    const scene = store.saveSceneSnapshot(selectedId, captureSnapshot());
    const keyframe = store.getProject().timeline.keyframes.find((item) => item.id === sceneKeyframeId(scene.id));
    if (keyframe) store.upsertKeyframe({ id: keyframe.id, timeMs: keyframe.timeMs, snapshot: scene.snapshot });
    persist();
    render();
    setStatus(`已用当前效果覆盖“${scene.name}”`);
  }

  function generatedTimeline(project) {
    return project.timeline.keyframes.length === project.scenes.length && project.timeline.keyframes.every((keyframe) =>
      project.scenes.some((scene) => keyframe.id === sceneKeyframeId(scene.id))
    );
  }

  function rebuildGeneratedTimeline() {
    const project = store.getProject();
    project.timeline.keyframes.forEach((keyframe) => store.removeKeyframe(keyframe.id));
    const duration = project.scenes.length ? project.scenes.length * SCENE_SPAN_MS : 0;
    store.setTimelineDuration(duration);
    project.scenes.forEach((scene, index) => {
      store.upsertKeyframe({ id: sceneKeyframeId(scene.id), timeMs: index * SCENE_SPAN_MS, snapshot: scene.snapshot });
    });
  }

  function restoreScene(id) {
    stopPlayback(false);
    try {
      const result = store.restoreScene(id, target);
      selectedId = id;
      lastAppliedSnapshot = result.snapshot;
      render();
      setStatus(`已载入“${result.scene.name}”`);
    } catch (error) {
      setStatus(error.message || '场景载入失败', true);
    }
  }

  function renameScene(id, value) {
    try {
      store.updateScene(id, { name: value });
      persist();
      render();
      setStatus('场景名称已保存');
    } catch (error) {
      setStatus(error.message || '名称保存失败', true);
    }
  }

  function moveScene(id, direction) {
    const project = store.getProject();
    const index = project.scenes.findIndex((scene) => scene.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= project.scenes.length) return;
    const wasGenerated = generatedTimeline(project);
    const order = project.scenes.map((scene) => scene.id);
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    store.reorderScenes(order);
    if (wasGenerated) rebuildGeneratedTimeline();
    persist();
    render();
    setStatus(wasGenerated ? '场景顺序与时间线已更新' : '场景顺序已更新；导入的自定义关键帧保持不变');
  }

  function deleteScene(id) {
    const project = store.getProject();
    const wasGenerated = generatedTimeline(project);
    const removed = store.removeScene(id);
    if (!removed) return;
    if (wasGenerated) rebuildGeneratedTimeline();
    else store.removeKeyframe(sceneKeyframeId(id));
    if (selectedId === id) selectedId = null;
    persist();
    render();
    setStatus(`已删除“${removed.name}”`);
  }

  function createSceneCard(scene, index, count) {
    const card = document.createElement('article');
    card.className = `scene-card${scene.id === selectedId ? ' selected' : ''}`;

    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'scene-load';
    load.title = '载入这个场景';
    const number = document.createElement('span');
    number.className = 'scene-index';
    number.textContent = `SCENE ${String(index + 1).padStart(2, '0')}`;
    const meta = document.createElement('span');
    meta.className = 'scene-meta';
    meta.textContent = `${scene.snapshot.style} · ${scene.snapshot.solidShape} · ${scene.snapshot.parameters.faces} 面`;
    load.append(number, meta);
    load.addEventListener('click', () => restoreScene(scene.id));

    const name = document.createElement('input');
    name.className = 'scene-name';
    name.value = scene.name;
    name.maxLength = 120;
    name.setAttribute('aria-label', `场景 ${index + 1} 名称`);
    name.addEventListener('focus', () => { selectedId = scene.id; renderSelection(); });
    name.addEventListener('change', () => renameScene(scene.id, name.value));

    const tools = document.createElement('div');
    tools.className = 'scene-tools';
    const up = toolButton('←', '向前移动', index === 0, () => moveScene(scene.id, -1));
    const down = toolButton('→', '向后移动', index === count - 1, () => moveScene(scene.id, 1));
    const remove = toolButton('删除', '删除场景', false, () => deleteScene(scene.id));
    tools.append(up, down, remove);
    card.append(load, name, tools);
    return card;
  }

  function toolButton(label, title, disabled, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-btn';
    button.textContent = label;
    button.title = title;
    button.disabled = disabled;
    button.addEventListener('click', action);
    return button;
  }

  function renderSelection() {
    list.querySelectorAll('.scene-card').forEach((card, index) => {
      const project = store.getProject();
      card.classList.toggle('selected', project.scenes[index] && project.scenes[index].id === selectedId);
    });
    overwriteButton.disabled = !selectedId;
  }

  function render() {
    const project = store.getProject();
    if (selectedId && !project.scenes.some((scene) => scene.id === selectedId)) selectedId = null;
    list.innerHTML = '';
    if (!project.scenes.length) {
      const empty = document.createElement('div');
      empty.className = 'scene-empty';
      empty.textContent = '还没有场景。调整上方效果后，点击“捕获当前”。';
      list.appendChild(empty);
    } else {
      project.scenes.forEach((scene, index) => list.appendChild(createSceneCard(scene, index, project.scenes.length)));
    }
    const hasTimeline = project.timeline.durationMs > 0 && project.timeline.keyframes.length > 0;
    timeline.max = String(project.timeline.durationMs);
    timeline.value = String(Math.min(Number(timeline.value) || 0, project.timeline.durationMs));
    timeline.disabled = !hasTimeline;
    playButton.disabled = !hasTimeline;
    exportButton.disabled = !project.scenes.length;
    overwriteButton.disabled = !selectedId;
    updateTimeLabel();
  }

  function updateTimeLabel() {
    const duration = store.getProject().timeline.durationMs;
    timeLabel.textContent = `${formatTime(Number(timeline.value))} / ${formatTime(duration)}`;
  }

  function changed(previous, next, path) {
    const before = path.reduce((value, key) => value == null ? value : value[key], previous);
    const after = path.reduce((value, key) => value == null ? value : value[key], next);
    return JSON.stringify(before) !== JSON.stringify(after);
  }

  function applySnapshot(snapshot, force) {
    if (!snapshot) return;
    const previous = force ? null : lastAppliedSnapshot;
    if (!previous || changed(previous, snapshot, ['style'])) target.setStyle(snapshot.style);
    if (!previous || changed(previous, snapshot, ['sampleMode'])) target.setSampleMode(snapshot.sampleMode);
    if (!previous || changed(previous, snapshot, ['rotationMode'])) target.setRotationMode(snapshot.rotationMode);
    if (!previous || changed(previous, snapshot, ['solidShape']) || changed(previous, snapshot, ['parameters', 'faces'])) {
      target.setSolidShape(snapshot.solidShape, snapshot.parameters.faces, false);
    }
    Object.keys(snapshot.parameters).forEach((name) => {
      if (!previous || changed(previous, snapshot, ['parameters', name])) target.setParam(name, snapshot.parameters[name]);
    });
    Object.keys(snapshot.toggles).forEach((name) => {
      if (name === 'transparent') {
        if (!previous || changed(previous, snapshot, ['toggles', name])) target.setTransparent(snapshot.toggles[name]);
      } else if (!previous || changed(previous, snapshot, ['toggles', name])) {
        target.setBoolean(name, snapshot.toggles[name]);
      }
    });
    if (!previous || changed(previous, snapshot, ['pattern'])) target.applyPatternSpec(snapshot.pattern);
    lastAppliedSnapshot = snapshot;
  }

  function seekAndApply(milliseconds, force) {
    const result = store.seek(milliseconds);
    timeline.value = String(result.timeMs);
    updateTimeLabel();
    const snapshot = productionSnapshot(result.timeMs, result.snapshot);
    if (snapshot) applySnapshot(snapshot, force);
    drawProductionOverlay(result.timeMs);
    if (timelineEditor) timelineEditor.setCurrentTime(result.timeMs);
    return result;
  }

  async function startPlayback() {
    if (playbackRunning) { stopPlayback(true); return; }
    const project = store.getProject();
    if (!project.timeline.keyframes.length || !project.timeline.durationMs) return;
    const state = testApi.state();
    previousSource = state.audioSource;
    const current = Number(timeline.value) >= project.timeline.durationMs ? 0 : Number(timeline.value);
    playbackUsingFile = state.audioSource === 'file' && state.audioFileLoaded && typeof target.playFileAt === 'function';
    playbackStartedDemo = !playbackUsingFile && !state.playing;
    if (playbackUsingFile) {
      const started = await target.playFileAt(current / 1000);
      if (!started) { playbackUsingFile = false; setStatus('无法播放已上传音乐，请重新选择文件。', true); return; }
    } else if (playbackStartedDemo) target.playDemo();
    playbackRunning = true;
    playButton.textContent = '■ 停止时间线';
    if (directorPreview) directorPreview.textContent = '■ 停止预览';
    if (directorTimelinePlay) directorTimelinePlay.textContent = '■ 停止';
    lastAppliedSnapshot = null;
    lastApplyAt = -Infinity;
    timeline.value = String(current);
    playbackStartedAt = performance.now() - current;
    setStatus(playbackUsingFile ? '时间线正与本地音乐同步播放' : '时间线播放中 · 场景参数会平滑过渡');
    playbackFrame = requestAnimationFrame(playbackTick);
  }

  function playbackTick(now) {
    if (!playbackRunning) return;
    const duration = store.getProject().timeline.durationMs;
    const audioPlayback = playbackUsingFile && typeof target.audioState === 'function' ? target.audioState() : null;
    const elapsed = Math.min(duration, audioPlayback ? audioPlayback.currentTime * 1000 : now - playbackStartedAt);
    timeline.value = String(Math.round(elapsed));
    updateTimeLabel();
    if (timelineEditor) timelineEditor.setCurrentTime(elapsed);
    if (now - lastApplyAt >= APPLY_INTERVAL_MS || elapsed >= duration) {
      seekAndApply(elapsed, false);
      lastApplyAt = now;
    }
    if (elapsed >= duration) {
      stopPlayback(true);
      setStatus('时间线播放完成 · 已停在最终场景');
      return;
    }
    playbackFrame = requestAnimationFrame(playbackTick);
  }

  function stopPlayback(keepPosition) {
    if (playbackFrame) cancelAnimationFrame(playbackFrame);
    playbackFrame = 0;
    const wasRunning = playbackRunning;
    playbackRunning = false;
    playButton.textContent = '▶ 播放时间线';
    if (directorPreview) directorPreview.textContent = '▶ 随音乐预览';
    if (directorTimelinePlay) directorTimelinePlay.textContent = '▶ 播放';
    if (playbackStartedDemo || playbackUsingFile) {
      target.stop();
      if (previousSource && previousSource !== (playbackUsingFile ? 'file' : 'demo')) target.selectSource(previousSource);
    }
    playbackStartedDemo = false;
    playbackUsingFile = false;
    previousSource = null;
    lastAppliedSnapshot = null;
    drawProductionOverlay(Number(timeline.value) || 0);
    if (wasRunning && !keepPosition) setStatus('时间线已停止');
  }

  function exportProject() {
    try {
      const project = store.getProject();
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.title.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'signal-field-project'}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus(`已导出 ${project.scenes.length} 个场景`);
    } catch (error) {
      setStatus(error.message || '项目导出失败', true);
    }
  }

  async function importProjectFile(file) {
    if (!file) return;
    stopPlayback(false);
    try {
      const attempt = store.tryImportJSON(await file.text());
      if (!attempt.ok) throw new Error(attempt.error);
      selectedId = attempt.project.scenes[0] ? attempt.project.scenes[0].id : null;
      persist();
      timeline.value = '0';
      render();
      setStatus(`已导入“${attempt.project.title}” · ${attempt.project.scenes.length} 个场景`);
    } catch (error) {
      setStatus(`项目未导入：${error.message || '文件格式无效'}。当前项目已保留。`, true);
    } finally {
      fileInput.value = '';
    }
  }

  function stableSeed(name, size, durationMs) {
    const text = `${name || 'music'}:${size || 0}:${durationMs || 0}`;
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619) >>> 0;
    return value;
  }

  async function decodeMusicFile(file, maximumDurationMs, generation) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('当前浏览器不支持本地音频分析。');
    const context = new AudioContextCtor();
    try {
      const buffer = await context.decodeAudioData((await file.arrayBuffer()).slice(0));
      if (generation !== directionGeneration) throw new Error('analysis-cancelled');
      const durationMs = Math.min(buffer.duration * 1000, maximumDurationMs || buffer.duration * 1000);
      if (durationMs > 10 * 60 * 1000) throw new RangeError('自动编排第一版最多分析 10 分钟音乐。');
      const sampleCount = Math.max(1, Math.min(buffer.length, Math.ceil(durationMs / 1000 * buffer.sampleRate)));
      const samples = new Float32Array(sampleCount);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const source = buffer.getChannelData(channel);
        const scale = 1 / buffer.numberOfChannels;
        for (let index = 0; index < sampleCount; index += 1) samples[index] += source[index] * scale;
      }
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = Math.max(-1, Math.min(1, samples[index]));
      }
      return { samples, sampleRate: buffer.sampleRate, durationMs };
    } finally {
      if (typeof context.close === 'function') context.close().catch(() => {});
    }
  }

  function renderDirectionCues(plan) {
    if (!directorCues) return;
    directorCues.innerHTML = '';
    const kindLabels = { quiet: '静音铺垫', transition: '结构转折', percussive: '节奏峰值', bright: '明亮段落', flowing: '流动段落' };
    plan.cues.forEach((cue) => {
      const chip = document.createElement('span');
      chip.className = 'director-cue';
      chip.textContent = `${formatTime(cue.timeMs)} · ${kindLabels[cue.kind] || cue.kind}`;
      directorCues.appendChild(chip);
    });
  }

  async function generateDirection() {
    if (!Director || !musicFile || !musicMeta) return;
    const generation = ++directionGeneration;
    const previousPlan = directionPlan;
    const previousAnalysis = directionAnalysis;
    const previousProduction = productionSpec;
    const previousWaveform = waveformData;
    const previousWaveformError = waveformError;
    const previousBeatGrid = beatGridMs;
    const previousEditableBeats = editableBeatEdits;
    directorGenerate.disabled = true;
    directorPreview.disabled = true;
    directorExport.disabled = true;
    setDirectorStatus('正在本机解码并分析音乐…');
    try {
      const durationChoice = directorDuration.value === 'full' ? musicMeta.durationMs : Number(directorDuration.value) * 1000;
      const pcm = await decodeMusicFile(musicFile, Math.min(musicMeta.durationMs, durationChoice), generation);
      if (generation !== directionGeneration) return;
      let nextWaveform = null;
      waveformError = null;
      if (TimelineCore) {
        try {
          nextWaveform = TimelineCore.buildWaveform(
            { samples: pcm.samples, sampleRate: pcm.sampleRate },
            { bucketCount: Math.min(4096, pcm.samples.length), durationMs: pcm.durationMs }
          );
        } catch (error) {
          waveformError = String(error && error.message || error);
        }
      }
      setDirectorStatus('正在识别段落并生成视觉场景…');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const analysis = Director.analyzeMono({ samples: pcm.samples, sampleRate: pcm.sampleRate }, { durationMs: pcm.durationMs, frameRate: 10 });
      const plan = Director.createPlan(analysis, {
        template: selectedTemplate,
        aspect: selectedAspect,
        title: `${musicMeta.name.replace(/\.[^.]+$/, '')} · ${selectedAspect}`,
        seed: stableSeed(musicMeta.name, musicMeta.size, pcm.durationMs),
        maxScenes: 8,
        baseSnapshot: captureSnapshot()
      });
      const canonical = Studio.createProject(plan.project);
      const validation = Studio.validateProject(canonical);
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      stopPlayback(false);
      store.importJSON(Studio.exportProject(canonical));
      directionPlan = Object.assign({}, plan, { project: store.getProject() });
      directionAnalysis = analysis;
      productionSpec = null;
      waveformData = nextWaveform;
      editableBeatEdits = null;
      beatGridMs = TimelineCore && analysis.tempo.confidence >= 0.25 && analysis.tempo.beatMs > 0
        ? TimelineCore.buildBeatGrid({ durationMs: directionPlan.project.timeline.durationMs, beatMs: analysis.tempo.beatMs })
        : [];
      selectedId = directionPlan.project.scenes[0] ? directionPlan.project.scenes[0].id : null;
      timeline.value = '0';
      persist();
      render();
      if (directionPlan.project.timeline.keyframes[0]) seekAndApply(0, true);
      renderDirectionCues(directionPlan);
      if (!directorTitleText.value.trim()) directorTitleText.value = musicMeta.name.replace(/\.[^.]+$/, '');
      directorFinishing.hidden = false;
      directorFinishing.open = true;
      updateProductionSpec();
      directorBeatReset.disabled = true;
      if (directorLyricsDraft) directorLyricsDraft.disabled = false;
      refreshTimelineEditor();
      const tempo = analysis.tempo.confidence >= 0.25 ? `${Math.round(analysis.tempo.bpm)} BPM` : '自由节奏';
      setDirectorStatus(`已生成 ${directionPlan.project.scenes.length} 个段落 · ${tempo} · ${selectedAspect} · 可直接预览或继续编辑`);
    } catch (error) {
      if (error && error.message === 'analysis-cancelled') return;
      directionPlan = previousPlan;
      directionAnalysis = previousAnalysis;
      productionSpec = previousProduction;
      waveformData = previousWaveform;
      waveformError = previousWaveformError;
      beatGridMs = previousBeatGrid;
      editableBeatEdits = previousEditableBeats;
      setDirectorStatus(`生成失败：${error.message || '无法分析这个文件'}。原有项目已保留。`, true);
    } finally {
      if (generation === directionGeneration) {
        directorGenerate.disabled = !musicFile;
        directorPreview.disabled = !directionPlan;
        directorExport.disabled = !directionPlan;
        directorRender.disabled = !productionSpec;
      }
    }
  }

  function selectChoice(container, button, attribute) {
    container.querySelectorAll('button').forEach((candidate) => {
      const active = candidate === button;
      candidate.setAttribute(attribute, String(active));
      if (attribute === 'aria-checked') candidate.tabIndex = active ? 0 : -1;
    });
  }

  async function selectDirectorFile(file) {
    if (!file) return;
    const token = ++directionGeneration;
    directionPlan = null;
    directionAnalysis = null;
    productionSpec = null;
    parsedLyrics = [];
    editableBeatEdits = null;
    waveformData = null;
    waveformError = null;
    beatGridMs = [];
    if (directorFinishing) directorFinishing.hidden = true;
    if (directorTimelineEditor) directorTimelineEditor.hidden = true;
    if (directorLyricsText) directorLyricsText.value = '';
    if (directorLyricsDraft) directorLyricsDraft.disabled = true;
    if (directorTitleText) directorTitleText.value = '';
    if (productionCanvas && ProductionOverlay) ProductionOverlay.clearOverlay(productionCanvas);
    directorCues.innerHTML = '';
    directorGenerate.disabled = true;
    directorPreview.disabled = true;
    directorExport.disabled = true;
    directorRender.disabled = true;
    directorFileName.textContent = `${file.name} · 正在读取…`;
    setDirectorStatus('正在读取音频元数据；文件不会离开这台设备。');
    try {
      const meta = await target.loadAudioFile(file);
      if (token !== directionGeneration) return;
      musicFile = file;
      musicMeta = Object.assign({ file }, meta);
      directorFileName.textContent = `${meta.name} · ${formatTime(meta.durationMs)}`;
      directorGenerate.disabled = false;
      setDirectorStatus('音乐已就绪。选择模板和画幅后，点击“分析并生成”。');
    } catch (_error) {
      if (token !== directionGeneration) return;
      musicFile = null; musicMeta = null;
      directorFileName.textContent = '读取失败 · 可重新选择';
      setDirectorStatus('无法读取这个音频文件，请换用浏览器支持的 MP3、M4A、WAV 或 OGG。', true);
    } finally {
      directorFileInput.value = '';
    }
  }

  function downloadProductionSpec() {
    const spec = updateProductionSpec();
    if (!spec) return;
    const blob = new Blob([Production.export(spec)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeOutputBase(spec.titleCard.mainTitle || store.getProject().title)}-production.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setDirectorStatus('已下载创作方案。音频不会打包；请在桌面版重新选择同一文件后渲染。');
  }

  function ingestLyrics(serialized) {
    const durationMs = store.getProject().timeline.durationMs;
    const next = parseLrc(serialized, durationMs);
    const previous = parsedLyrics;
    parsedLyrics = next;
    try {
      updateProductionSpec();
      directorLyricsStatus.textContent = next.length ? `已读取 ${next.length} 条时间戳歌词。` : '未添加歌词；最终视频只显示标题。';
      directorLyricsStatus.setAttribute('role', 'status');
    } catch (error) {
      parsedLyrics = previous;
      updateProductionSpec();
      throw error;
    }
  }

  function setLyricsError(error) {
    directorLyricsStatus.textContent = `歌词未更新：${error.message || error}`;
    directorLyricsStatus.setAttribute('role', 'alert');
  }

  function createPlainTextLyricDraft() {
    if (!LyricTiming || !directionAnalysis) throw new Error('请先分析音乐并生成场景');
    const result = LyricTiming.createDraft(directorLyricsText.value, directionAnalysis);
    const previous = parsedLyrics;
    parsedLyrics = result.lyrics;
    try {
      updateProductionSpec();
      directorLyricsText.value = serializeLyricsForLrc(parsedLyrics);
      const percent = Math.round(result.diagnostics.confidence * 100);
      directorLyricsStatus.textContent = `已在本机生成 ${parsedLyrics.length} 行时间初稿 · 参考置信度 ${percent}% · 这不是人声识别，请在波形时间轴检查并拖动校正。`;
      directorLyricsStatus.setAttribute('role', 'status');
    } catch (error) {
      parsedLyrics = previous;
      updateProductionSpec();
      throw error;
    }
  }

  function mountTimelineEditor() {
    if (timelineEditor || !directorTimelineEditor || !TimelineCore || !WaveformTimeline) return timelineEditor;
    timelineEditor = WaveformTimeline.mount(directorTimelineEditor, {
      onEditStart() {
        stopPlayback(true);
      },
      onSeek(timeMs) {
        stopPlayback(true);
        seekAndApply(timeMs, false);
      },
      onTogglePlayback() {
        startPlayback();
      },
      onDraft(kind, values, timeMs) {
        if (productionSpec) {
          try {
            productionSpec = Production.create({
              ...productionSpec,
              lyrics: kind === 'lyric' ? values : productionSpec.lyrics,
              beatEdits: kind === 'beat' ? values : productionSpec.beatEdits
            });
          } catch (_error) {}
        }
        seekAndApply(timeMs, false);
      },
      onCancel(_lyrics, _beats, timeMs) {
        updateProductionSpec();
        seekAndApply(timeMs, false);
      },
      onLyricsChange(next) {
        const previous = parsedLyrics;
        parsedLyrics = next;
        try {
          updateProductionSpec();
          directorLyricsText.value = serializeLyricsForLrc(parsedLyrics);
          directorLyricsStatus.textContent = `已手动调整 ${parsedLyrics.length} 条歌词时间；结束边界保存在创作方案中。`;
          directorLyricsStatus.setAttribute('role', 'status');
        } catch (error) {
          parsedLyrics = previous;
          updateProductionSpec();
          throw error;
        }
      },
      onBeatEditsChange(next) {
        const previous = editableBeatEdits;
        editableBeatEdits = next;
        try {
          updateProductionSpec();
          directorBeatReset.disabled = false;
        } catch (error) {
          editableBeatEdits = previous;
          updateProductionSpec();
          throw error;
        }
      }
    });
    return timelineEditor;
  }

  function refreshTimelineEditor() {
    if (!productionSpec || !directionAnalysis) return;
    const editor = mountTimelineEditor();
    if (!editor) return;
    editor.setData({
      durationMs: productionSpec.project.timeline.durationMs,
      waveform: waveformData,
      lyrics: productionSpec.lyrics,
      beatEdits: productionSpec.beatEdits,
      beatGridMs
    });
    editor.setCurrentTime(Number(timeline.value) || 0);
  }

  function renderQueueTask(task) {
    if (!task || !task.id) return;
    renderTasks.set(task.id, task);
    const labels = { queued: '等待中', running: '正在渲染', completed: '已完成', failed: '失败', cancelled: '已取消' };
    directorQueue.innerHTML = '';
    Array.from(renderTasks.values()).slice(-8).reverse().forEach((item) => {
      const card = document.createElement('article');
      card.className = 'director-queue-item'; card.setAttribute('role', 'listitem'); card.dataset.status = item.status;
      const copy = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = String(item.output || '视频任务').split(/[\\/]/).pop();
      const detail = document.createElement('span');
      const percent = Math.round((Number(item.progress) || 0) * 100);
      detail.textContent = `${labels[item.status] || item.status}${item.status === 'running' ? ` · ${percent}%` : ''}${item.error ? ` · ${String(item.error).slice(0, 180)}` : ''}`;
      copy.append(name, detail); card.appendChild(copy);
      if (item.status === 'queued' || item.status === 'running') {
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
        cancel.addEventListener('click', async () => {
          try { renderQueueTask(await Desktop.cancelRender(item.id)); } catch (error) { directorQueueStatus.textContent = `取消失败：${error.message || error}`; }
        });
        card.appendChild(cancel);
      }
      directorQueue.appendChild(card);
    });
    directorQueueStatus.textContent = task.status === 'completed' ? '视频已经生成。' : task.status === 'failed' ? '渲染失败；当前创作方案仍然保留。' : '桌面渲染队列会串行处理任务。';
  }

  async function renderOrDownload() {
    const spec = updateProductionSpec();
    if (!spec) return;
    if (directorRender.dataset.mode !== 'desktop') { downloadProductionSpec(); return; }
    directorRender.disabled = true;
    directorQueueStatus.textContent = '正在选择输出位置并创建任务…';
    try {
      const audioFilePath = Desktop.pathForFile(musicFile);
      if (!audioFilePath) throw new Error('无法取得本地音频路径，请重新选择音乐');
      const task = await Desktop.enqueueProduction({
        productionJson: Production.export(spec, { pretty: false }),
        audioFilePath,
        aspect: spec.aspect,
        codec: spec.output.codec,
        fileName: spec.output.fileName
      });
      if (!task) { directorQueueStatus.textContent = '已取消选择输出位置。'; return; }
      renderQueueTask(task);
    } catch (error) {
      directorQueueStatus.textContent = `未加入队列：${error.message || error}`;
      directorQueueStatus.setAttribute('role', 'alert');
    } finally {
      directorRender.disabled = !productionSpec;
    }
  }

  function configureRenderMode() {
    const desktop = Boolean(Desktop && typeof Desktop.enqueueProduction === 'function' && typeof Desktop.pathForFile === 'function');
    directorRender.dataset.mode = desktop ? 'desktop' : 'package';
    directorRender.textContent = desktop ? '一键渲染视频' : '下载创作方案';
    directorRenderHint.textContent = desktop
      ? '选择保存位置后加入本机串行队列；关闭网页不会把音乐上传到任何服务器。'
      : '浏览器不会生成 MP4；音频不会打包，请在桌面版重新选择同一文件后渲染。';
    if (desktop && typeof Desktop.listRenders === 'function') {
      Desktop.listRenders().then((tasks) => tasks.forEach(renderQueueTask)).catch(() => {});
      if (typeof Desktop.onRenderQueueChange === 'function') Desktop.onRenderQueueChange(renderQueueTask);
    }
  }

  captureButton.addEventListener('click', addSceneFromCurrent);
  overwriteButton.addEventListener('click', overwriteSelected);
  importButton.addEventListener('click', () => fileInput.click());
  exportButton.addEventListener('click', exportProject);
  fileInput.addEventListener('change', () => importProjectFile(fileInput.files[0]));
  playButton.addEventListener('click', () => { startPlayback(); });
  timeline.addEventListener('input', () => {
    stopPlayback(true);
    seekAndApply(Number(timeline.value), false);
    setStatus('正在预览时间线；松开后粒子会继续收敛');
  });
  window.addEventListener('beforeunload', () => stopPlayback(true));

  if (directorRoot && Director) {
    directorFileInput.addEventListener('change', () => selectDirectorFile(directorFileInput.files[0]));
    directorTemplates.addEventListener('click', (event) => {
      const button = event.target.closest('[data-template]'); if (!button) return;
      selectedTemplate = button.dataset.template; selectChoice(directorTemplates, button, 'aria-checked');
      if (directionPlan) setDirectorStatus('模板已更改；重新生成后才会替换当前项目。');
    });
    directorTemplates.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const buttons = Array.from(directorTemplates.querySelectorAll('[data-template]'));
      const current = Math.max(0, buttons.indexOf(document.activeElement));
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      const next = buttons[(current + direction + buttons.length) % buttons.length];
      event.preventDefault(); next.click(); next.focus();
    });
    directorAspects.addEventListener('click', (event) => {
      const button = event.target.closest('[data-aspect]'); if (!button) return;
      selectedAspect = button.dataset.aspect; selectChoice(directorAspects, button, 'aria-pressed');
      if (directionPlan) setDirectorStatus('画幅已更改；重新生成后才会替换当前项目。');
    });
    directorGenerate.addEventListener('click', generateDirection);
    directorPreview.addEventListener('click', () => { startPlayback(); });
    directorTitleTemplate.addEventListener('change', updateProductionSpec);
    directorTitleText.addEventListener('input', updateProductionSpec);
    directorSubtitleText.addEventListener('input', updateProductionSpec);
    directorBeatDensity.addEventListener('change', () => {
      updateProductionSpec();
      if (editableBeatEdits) {
        directorBeatReset.disabled = false;
        setDirectorStatus('切换密度不会覆盖手调切点；点击“按当前密度重新生成”才会替换。');
      }
    });
    directorBeatReset.addEventListener('click', () => {
      editableBeatEdits = null;
      updateProductionSpec();
      directorBeatReset.disabled = true;
      if (timelineEditor && productionSpec) timelineEditor.setBeatEdits(productionSpec.beatEdits);
      setDirectorStatus('已按当前密度重新生成节拍切点；原手动位置已被替换。');
    });
    directorTimelinePlay.addEventListener('click', () => { startPlayback(); });
    directorLyricsText.addEventListener('change', () => {
      try { ingestLyrics(directorLyricsText.value); } catch (error) { setLyricsError(error); }
    });
    directorLyricsFile.addEventListener('change', async () => {
      const file = directorLyricsFile.files[0];
      if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('LRC 文件不能超过 2 MB');
        const text = await file.text();
        ingestLyrics(text); directorLyricsText.value = text;
      } catch (error) { setLyricsError(error); }
      finally { directorLyricsFile.value = ''; }
    });
    directorLyricsDraft.addEventListener('click', () => {
      try { createPlainTextLyricDraft(); } catch (error) { setLyricsError(error); }
    });
    directorLyricsClear.addEventListener('click', () => {
      parsedLyrics = []; directorLyricsText.value = ''; updateProductionSpec();
      directorLyricsStatus.textContent = '歌词已清空；最终视频只显示标题。'; directorLyricsStatus.setAttribute('role', 'status');
    });
    directorRender.addEventListener('click', renderOrDownload);
    directorExport.addEventListener('click', () => {
      exportProject();
      setDirectorStatus(`已下载可编辑场景项目。桌面高质量视频可用 --project 与 --aspect ${selectedAspect} 导出。`);
    });
    window.addEventListener('signalfield:audio-loaded', (event) => {
      const detail = event.detail || {};
      if (!detail.file || detail.file === musicFile) return;
      musicFile = detail.file; musicMeta = detail;
      directorFileName.textContent = `${detail.name} · ${formatTime(detail.durationMs)}`;
      directorGenerate.disabled = false;
      setDirectorStatus('音乐已就绪。选择模板和画幅后，点击“分析并生成”。');
    });
    window.addEventListener('resize', () => drawProductionOverlay(Number(timeline.value) || 0));
    configureRenderMode();
  }

  safeLoad();
  render();
  if (store.getProject().scenes.length) setStatus(`已恢复本机项目 · ${store.getProject().scenes.length} 个场景`);

  window.sceneStudioController = {
    capture: addSceneFromCurrent,
    overwrite: overwriteSelected,
    select: restoreScene,
    seek: (timeMs) => seekAndApply(timeMs, true),
    play: startPlayback,
    stop: () => stopPlayback(true),
    generateMusicPlan: generateDirection,
    exportJSON: () => store.exportJSON(),
    exportProductionJSON: () => productionSpec && Production ? Production.export(productionSpec) : null,
    importJSON(serialized) {
      const result = store.tryImportJSON(serialized);
      if (result.ok) { selectedId = result.project.scenes[0] ? result.project.scenes[0].id : null; persist(); render(); }
      return result;
    },
    state: () => ({
      project: store.getProject(),
      selectedId,
      playbackRunning,
      productionSpec,
      renderTasks: Array.from(renderTasks.values()),
      timelineEditor: timelineEditor ? timelineEditor.state() : null,
      editableBeatEdits: editableBeatEdits ? editableBeatEdits.map((edit) => ({ ...edit })) : null,
      waveformError
    })
  };
}());
