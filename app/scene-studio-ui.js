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

  let store = Studio.createStore(Studio.createProject({
    title: '我的 Signal Field 项目',
    timeline: { durationMs: 0, keyframes: [] }
  }));
  let selectedId = null;
  let playbackFrame = 0;
  let playbackStartedAt = 0;
  let playbackRunning = false;
  let playbackStartedDemo = false;
  let previousSource = null;
  let lastAppliedSnapshot = null;
  let lastApplyAt = -Infinity;

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

  function formatTime(milliseconds) {
    const totalTenths = Math.max(0, Math.round(milliseconds / 100));
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`;
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
    if (result.snapshot) applySnapshot(result.snapshot, force);
    return result;
  }

  function startPlayback() {
    if (playbackRunning) { stopPlayback(true); return; }
    const project = store.getProject();
    if (!project.timeline.keyframes.length || !project.timeline.durationMs) return;
    const state = testApi.state();
    playbackStartedDemo = !state.playing;
    previousSource = state.audioSource;
    if (playbackStartedDemo) target.playDemo();
    playbackRunning = true;
    playButton.textContent = '■ 停止时间线';
    lastAppliedSnapshot = null;
    lastApplyAt = -Infinity;
    const current = Number(timeline.value) >= project.timeline.durationMs ? 0 : Number(timeline.value);
    timeline.value = String(current);
    playbackStartedAt = performance.now() - current;
    setStatus('时间线播放中 · 场景参数会平滑过渡');
    playbackFrame = requestAnimationFrame(playbackTick);
  }

  function playbackTick(now) {
    if (!playbackRunning) return;
    const duration = store.getProject().timeline.durationMs;
    const elapsed = Math.min(duration, now - playbackStartedAt);
    timeline.value = String(Math.round(elapsed));
    updateTimeLabel();
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
    if (playbackStartedDemo) {
      target.stop();
      if (previousSource && previousSource !== 'demo') target.selectSource(previousSource);
    }
    playbackStartedDemo = false;
    previousSource = null;
    lastAppliedSnapshot = null;
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

  captureButton.addEventListener('click', addSceneFromCurrent);
  overwriteButton.addEventListener('click', overwriteSelected);
  importButton.addEventListener('click', () => fileInput.click());
  exportButton.addEventListener('click', exportProject);
  fileInput.addEventListener('change', () => importProjectFile(fileInput.files[0]));
  playButton.addEventListener('click', startPlayback);
  timeline.addEventListener('input', () => {
    stopPlayback(true);
    seekAndApply(Number(timeline.value), false);
    setStatus('正在预览时间线；松开后粒子会继续收敛');
  });
  window.addEventListener('beforeunload', () => stopPlayback(true));

  safeLoad();
  render();
  if (store.getProject().scenes.length) setStatus(`已恢复本机项目 · ${store.getProject().scenes.length} 个场景`);

  window.sceneStudioController = {
    capture: addSceneFromCurrent,
    overwrite: overwriteSelected,
    select: restoreScene,
    seek: (timeMs) => seekAndApply(timeMs, true),
    exportJSON: () => store.exportJSON(),
    importJSON(serialized) {
      const result = store.tryImportJSON(serialized);
      if (result.ok) { selectedId = result.project.scenes[0] ? result.project.scenes[0].id : null; persist(); render(); }
      return result;
    },
    state: () => ({ project: store.getProject(), selectedId, playbackRunning })
  };
}());
