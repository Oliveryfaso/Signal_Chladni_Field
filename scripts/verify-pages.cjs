// Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '.pages');
const PROFILE = path.join(ROOT, '.cache', `pages-verify-${process.pid}`);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
};

app.setPath('userData', PROFILE);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

function buildSite() {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts', 'build-pages.sh')], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Pages build failed');
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let file = path.resolve(SITE, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${SITE}${path.sep}`) && file !== SITE) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const body = fs.readFileSync(file);
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (_error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

async function waitFor(win, expression, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  buildSite();
  await app.whenReady();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const errors = [];
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.webContents.on('console-message', (event) => {
    if (event.level >= 2) errors.push(event.message);
  });

  try {
    await win.loadURL(`${base}/`);
    await waitFor(
      win,
      "Boolean(document.getElementById('engine').contentWindow.soundMotionTest)",
      'embedded visualizer'
    );
    await waitFor(
      win,
      `(() => {
        const api=document.getElementById('engine').contentWindow;
        const expected=api.soundMotionTest.webDefaultPattern('cosmic');
        const actual=JSON.parse(api.soundMotionNative.exportPatternJSON());
        return actual.style===expected.style && Math.abs(actual.goal-expected.goal)<1e-9 &&
          Math.abs(actual.detail-expected.detail)<1e-9 && actual.ex.every((value,index)=>Math.abs(value-expected.ex[index])<1e-9);
      })()`,
      'shared Web default pattern'
    );
    const initial = await win.webContents.executeJavaScript(`(() => {
      const frame=document.getElementById('engine');
      const state=frame.contentWindow.soundMotionTest.state();
      return {
        detail:state.detail,
        detailControl:Number(document.querySelector('input[data-param="detail"]').value),
        audio:frame.contentDocument.getElementById('hero-meta').textContent,
        source:new URL(frame.src).pathname,
        dock:Boolean(document.getElementById('dock')),
        title:document.title,
        canonical:document.querySelector('link[rel="canonical"]')?.href,
        sourceLink:document.getElementById('sourceLink')?.href,
        socialImage:document.querySelector('meta[property="og:image"]')?.content,
        heading:document.querySelector('h1.title')?.textContent,
        creatorHref:document.querySelector('.hero-cta')?.getAttribute('href'),
        creatorHeight:document.querySelector('.hero-cta')?.getBoundingClientRect().height,
        advancedNote:document.querySelector('.hero-note')?.textContent,
        hasSphereControl:Boolean(document.querySelector('[data-control="solidshape"] [data-value="sphere"]')),
        engineTitle:frame.contentDocument.title,
        engineHeading:frame.contentDocument.querySelector('header h1')?.textContent,
        downloadButton:Boolean(document.getElementById('exportBtn')),
        hasLegacyName:document.documentElement.textContent.includes('3D Chladni Plate'),
        pattern:JSON.parse(frame.contentWindow.soundMotionNative.exportPatternJSON())
      };
    })()`);
    if (Math.abs(initial.detail - 1) > 1e-6 || Math.abs(initial.detailControl - 1) > 1e-6) {
      throw new Error(`Pages Cosmic detail default is invalid: ${JSON.stringify(initial)}`);
    }
    if (!initial.audio.includes('演示信号')) throw new Error(`Unexpected Pages demo source: ${initial.audio}`);
    if (initial.source !== '/app/index.html' || !initial.dock) throw new Error(`Invalid Pages shell: ${JSON.stringify(initial)}`);
    if (initial.title !== 'Signal Field — 3D Audio Resonance Visualizer' || !['把一首歌变成 3D 粒子短片','Turn a song into a 3D particle film'].includes(initial.heading) ||
        initial.engineTitle !== 'Signal Field' || initial.engineHeading !== 'Signal Field' || initial.hasLegacyName) {
      throw new Error(`Invalid Pages product name: ${JSON.stringify(initial)}`);
    }
    if (initial.creatorHref !== 'app/index.html#music-director' || initial.creatorHeight < 44 || !initial.advancedNote || !initial.hasSphereControl) {
      throw new Error(`Pages creator entry is incomplete: ${JSON.stringify(initial)}`);
    }
    if (!initial.canonical.includes('/Signal_Chladni_Field/') || !initial.sourceLink.includes('/Oliveryfaso/Signal_Chladni_Field') || !initial.socialImage.includes('/desktop/assets/signal-field-icon.png')) {
      throw new Error(`Pages public metadata/source links are invalid: ${JSON.stringify(initial)}`);
    }
    if (initial.downloadButton) throw new Error('Pages download button is still present');
    const licenseResponses = await win.webContents.executeJavaScript(`Promise.all([
      'LICENSE',
      'ASSET_LICENSE.md',
      'LICENSES/CC-BY-NC-4.0.txt',
      'THIRD_PARTY_NOTICES.md',
      'UPSTREAM_NOTICE.md',
      'MODIFICATIONS.md'
    ].map(async (file) => ({file,status:(await fetch(file)).status})))`);
    if (licenseResponses.some((response) => response.status !== 200)) {
      throw new Error(`Pages license files unavailable: ${JSON.stringify(licenseResponses)}`);
    }

    const detailDefaults = await win.webContents.executeJavaScript(
      "document.getElementById('engine').contentWindow.soundMotionTest.detailDefaults()"
    );
    const expectedDetailDefaults = { sand: 1.5, msand: 1, cosmic: 1, dcosmic: 1.5 };
    for (const [style, expected] of Object.entries(expectedDetailDefaults)) {
      if (Math.abs(detailDefaults[style] - expected) > 1e-6) {
        throw new Error(`Unexpected per-style detail defaults: ${JSON.stringify(detailDefaults)}`);
      }
    }
    const webPatterns = await win.webContents.executeJavaScript(
      "['sand','msand','cosmic','dcosmic'].map(style=>document.getElementById('engine').contentWindow.soundMotionTest.webDefaultPattern(style))"
    );
    const expectedGoal = 10.69808181085723;
    const expectedEx = [0.8314424852873101, 0.3722374639108269, 0.7994605376770149];
    for (const pattern of webPatterns) {
      if (Math.abs(pattern.goal - expectedGoal) > 1e-9 ||
          Math.abs(pattern.detail - expectedDetailDefaults[pattern.style]) > 1e-9 ||
          pattern.ex.some((value, index) => Math.abs(value - expectedEx[index]) > 1e-9)) {
        throw new Error(`Unexpected shared Web default pattern: ${JSON.stringify(webPatterns)}`);
      }
    }

    const languages = await win.webContents.executeJavaScript(`(() => {
      const button=document.getElementById('langBtn');
      if(document.documentElement.lang!=='en') button.click();
      const english={lang:document.documentElement.lang,style:document.querySelector('[data-style="sand"]').textContent,detail:document.querySelector('[data-i18n="detail"]').textContent};
      button.click();
      const chinese={lang:document.documentElement.lang,style:document.querySelector('[data-style="sand"]').textContent,detail:document.querySelector('[data-i18n="detail"]').textContent};
      return {english,chinese};
    })()`);
    if (languages.english.lang !== 'en' || languages.english.style !== 'Dynamic Sand' || languages.english.detail !== 'Detail') {
      throw new Error(`English UI failed: ${JSON.stringify(languages.english)}`);
    }
    if (languages.chinese.lang !== 'zh-CN' || languages.chinese.style !== '动态声沙' || languages.chinese.detail !== '细节') {
      throw new Error(`Chinese UI failed: ${JSON.stringify(languages.chinese)}`);
    }

    await win.loadURL(`${base}/app/index.html`);
    await waitFor(
      win,
      `document.querySelector('[data-role="mode-value"]')?.textContent==='m3n3' &&
        document.querySelector('[data-role="natural-value"]')?.textContent==='126.2 Hz' &&
        document.querySelector('[data-role="coupling-value"]')?.textContent==='100%' &&
        Boolean(document.querySelector('[data-action="apply"]'))`,
      'physical Plate Lab defaults'
    );
    await waitFor(
      win,
      `Boolean(window.rendererCapabilityController) && Boolean(window.signalFieldGpuController) &&
        ['ready','fallback','disabled','lost'].includes(window.signalFieldGpuController.state().status)`,
      'renderer runtime status'
    );
    await win.webContents.executeJavaScript(`(() => {
      const sampleRate=8000, seconds=4, count=sampleRate*seconds, bytes=new ArrayBuffer(44+count*2), view=new DataView(bytes);
      const text=(offset,value)=>{ for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i)); };
      text(0,'RIFF'); view.setUint32(4,36+count*2,true); text(8,'WAVE'); text(12,'fmt '); view.setUint32(16,16,true);
      view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
      view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,count*2,true);
      for(let i=0;i<count;i++){ const phase=i%(sampleRate/2), value=phase<80?(1-phase/80)*0.9:Math.sin(i/sampleRate*Math.PI*2*220)*0.08; view.setInt16(44+i*2,Math.max(-32767,Math.min(32767,Math.round(value*32767))),true); }
      const file=new File([bytes],'pages-120bpm.wav',{type:'audio/wav'});
      return window.soundMotionNative.loadAudioFile(file);
    })()`);
    await waitFor(win, '!document.getElementById("directorGenerate").disabled', 'music director audio readiness');
    await win.webContents.executeJavaScript('document.getElementById("directorGenerate").click()');
    await waitFor(
      win,
      'document.getElementById("directorStatus").textContent.includes("已生成") && !document.getElementById("directorPreview").disabled',
      'automatic music direction',
      20_000
    );
    const musicDirection = await win.webContents.executeJavaScript(`(() => {
      const state=window.sceneStudioController.state(), project=state.project;
      return {
        title:project.title,scenes:project.scenes.length,keyframes:project.timeline.keyframes.length,durationMs:project.timeline.durationMs,
        source:window.soundMotionTest.state().audioSource,fileLoaded:window.soundMotionTest.state().audioFileLoaded,
        cueCount:document.querySelectorAll('.director-cue').length,
        previewDisabled:document.getElementById('directorPreview').disabled,
        exportDisabled:document.getElementById('directorExport').disabled,
        valid:window.SignalFieldSceneStudio.validateProject(project).valid
      };
    })()`);
    if (!musicDirection.valid || musicDirection.scenes < 1 || musicDirection.scenes !== musicDirection.keyframes || musicDirection.cueCount !== musicDirection.scenes ||
      musicDirection.durationMs !== 4000 || musicDirection.source !== 'file' || !musicDirection.fileLoaded || musicDirection.previewDisabled || musicDirection.exportDisabled) {
      throw new Error(`Music director did not create a usable local project: ${JSON.stringify(musicDirection)}`);
    }
    await win.webContents.executeJavaScript('document.getElementById("directorPreview").click()');
    await waitFor(win, 'window.sceneStudioController.state().playbackRunning && window.soundMotionTest.state().audioSource==="file" && window.soundMotionTest.state().playing', 'music-synchronised timeline preview');
    await win.webContents.executeJavaScript('window.sceneStudioController.stop()');
    const productSurfaces = await win.webContents.executeJavaScript(`({
      plateMode:document.querySelector('[data-role="mode-value"]')?.textContent,
      plateFrequency:document.querySelector('[data-role="natural-value"]')?.textContent,
      plateCoupling:document.querySelector('[data-role="coupling-value"]')?.textContent,
      rendererStatus:document.querySelector('#rendererCapability summary')?.textContent,
      rendererRuntime:window.signalFieldGpuController.state(),
      gpuBridge:window.soundMotionGpuBridge.snapshot(),
      gpuVisible:document.getElementById('stage').classList.contains('gpu-enhanced')
    })`);
    if (productSurfaces.plateMode !== 'm3n3' || productSurfaces.plateFrequency !== '126.2 Hz' || productSurfaces.plateCoupling !== '100%') {
      throw new Error(`Plate Lab defaults are invalid: ${JSON.stringify(productSurfaces)}`);
    }
    if (productSurfaces.gpuBridge.version !== 2 || productSurfaces.gpuBridge.simulation !== 'modal-3d' ||
      productSurfaces.gpuBridge.excitation.length !== 3 || productSurfaces.gpuBridge.rotationMatrix.length !== 9 ||
      !productSurfaces.gpuBridge.modeA.n || !productSurfaces.gpuBridge.modeB.n || !Number.isFinite(productSurfaces.gpuBridge.zoom) ||
      !['cube','sphere','convex'].includes(productSurfaces.gpuBridge.shape.type) || !productSurfaces.gpuBridge.shapeRevision ||
      !Number.isFinite(productSurfaces.gpuBridge.forces.nodeStrength)) {
      throw new Error(`WebGPU bridge is missing the 3D modal/camera contract: ${JSON.stringify(productSurfaces.gpuBridge)}`);
    }
    const gpuProfilesAndShapes = await win.webContents.executeJavaScript(`(() => {
      const profiles={};
      for(const style of ['sand','msand','cosmic','dcosmic']){
        window.soundMotionNative.setStyle(style);
        const snapshot=window.soundMotionGpuBridge.snapshot();
        profiles[style]={forces:snapshot.forces,restitution:snapshot.shape.restitution};
      }
      window.soundMotionNative.setSolidShape('regular',20,false);
      const regular=window.soundMotionGpuBridge.snapshot();
      window.soundMotionNative.setSolidShape('random',24,true);
      const randomA=window.soundMotionGpuBridge.snapshot();
      window.soundMotionNative.setSolidShape('random',24,true);
      const randomB=window.soundMotionGpuBridge.snapshot();
      window.soundMotionNative.setSolidShape('sphere',8,false);
      const sphere=window.soundMotionGpuBridge.snapshot();
      return {
        profiles,
        regular:{shape:regular.shape,revision:regular.shapeRevision},
        randomA:{shape:randomA.shape,revision:randomA.shapeRevision},
        randomB:{shape:randomB.shape,revision:randomB.shapeRevision},
        sphere:{shape:sphere.shape,revision:sphere.shapeRevision},
        controls:{facesDisabled:document.getElementById('polyfaces').disabled,label:document.getElementById('polyval').textContent}
      };
    })()`);
    const expectedProfiles = {
      sand: { forces: { pointerStrength: 1, nodeStrength: 1, driftStrength: 0.25 }, restitution: 0.58 },
      msand: { forces: { pointerStrength: 0, nodeStrength: 0.72, driftStrength: 0.08 }, restitution: 0.52 },
      cosmic: { forces: { pointerStrength: 0, nodeStrength: 0.68, driftStrength: 0.20 }, restitution: 0.86 },
      dcosmic: { forces: { pointerStrength: 0.45, nodeStrength: 0.88, driftStrength: 1 }, restitution: 0.88 }
    };
    if (JSON.stringify(gpuProfilesAndShapes.profiles) !== JSON.stringify(expectedProfiles)) {
      throw new Error(`Per-style GPU mechanics changed unexpectedly: ${JSON.stringify(gpuProfilesAndShapes.profiles)}`);
    }
    if (gpuProfilesAndShapes.regular.shape.type !== 'convex' || gpuProfilesAndShapes.regular.shape.planes.length !== 20) {
      throw new Error(`Regular icosahedron did not reach the GPU bridge: ${JSON.stringify(gpuProfilesAndShapes.regular)}`);
    }
    if (gpuProfilesAndShapes.randomA.shape.type !== 'convex' || gpuProfilesAndShapes.randomA.shape.planes.length !== 24 ||
      gpuProfilesAndShapes.randomB.shape.type !== 'convex' || gpuProfilesAndShapes.randomB.shape.planes.length !== 24 ||
      gpuProfilesAndShapes.randomA.revision === gpuProfilesAndShapes.randomB.revision ||
      JSON.stringify(gpuProfilesAndShapes.randomA.shape.planes) === JSON.stringify(gpuProfilesAndShapes.randomB.shape.planes)) {
      throw new Error(`Random convex refresh did not update the GPU bridge: ${JSON.stringify(gpuProfilesAndShapes)}`);
    }
    if (gpuProfilesAndShapes.sphere.shape.type !== 'sphere' || Math.abs(gpuProfilesAndShapes.sphere.shape.radius - 0.96) > 1e-9 ||
      !gpuProfilesAndShapes.controls.facesDisabled || gpuProfilesAndShapes.controls.label !== '球体') {
      throw new Error(`Explicit sphere mode is inconsistent: ${JSON.stringify(gpuProfilesAndShapes.sphere)}`);
    }
    win.setContentSize(390, 844);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const mobileShapeControl = await win.webContents.executeJavaScript(`(() => {
      const segment=document.getElementById('solidshape'), segmentRect=segment.getBoundingClientRect();
      const director=document.getElementById('musicDirector').getBoundingClientRect();
      const buttons=Array.from(segment.querySelectorAll('button')).map(button=>{
        const rect=button.getBoundingClientRect(); return {left:rect.left,right:rect.right,width:rect.width,height:rect.height};
      });
      const directorActions=Array.from(document.querySelectorAll('.director-action')).map(button=>button.getBoundingClientRect().height);
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,director:{left:director.left,right:director.right},directorActions,segment:{left:segmentRect.left,right:segmentRect.right,width:segmentRect.width},buttons};
    })()`);
    if (mobileShapeControl.segment.left < 0 || mobileShapeControl.segment.right > mobileShapeControl.viewport + 0.5 ||
      mobileShapeControl.documentWidth > mobileShapeControl.viewport + 1 || mobileShapeControl.director.left < 0 || mobileShapeControl.director.right > mobileShapeControl.viewport + 0.5 ||
      mobileShapeControl.directorActions.some((height) => height < 44) || mobileShapeControl.buttons.some((button) => button.width <= 0 || button.height < 44 || button.left < mobileShapeControl.segment.left - 0.5 || button.right > mobileShapeControl.segment.right + 0.5)) {
      throw new Error(`GPU shape selector overflows its mobile surface: ${JSON.stringify(mobileShapeControl)}`);
    }
    win.setContentSize(1280, 800);
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (productSurfaces.rendererRuntime.actual === 'canvas+webgpu') {
      if (productSurfaces.rendererRuntime.status !== 'ready' || productSurfaces.rendererRuntime.simulation !== 'modal-3d' || !productSurfaces.rendererRuntime.modePair || !productSurfaces.rendererRuntime.shapeKind || productSurfaces.rendererRuntime.framesSubmitted < 1 || !productSurfaces.gpuVisible || !productSurfaces.rendererStatus.includes('WebGPU')) {
        throw new Error(`WebGPU was reported before a submitted frame or without the GPU surface: ${JSON.stringify(productSurfaces)}`);
      }
    } else if (productSurfaces.rendererRuntime.actual !== 'canvas' || !productSurfaces.rendererStatus.includes('Canvas') || productSurfaces.gpuVisible) {
      throw new Error(`Canvas fallback status is inconsistent: ${JSON.stringify(productSurfaces)}`);
    }

    await win.loadURL(`${base}/app/index.html?parity=1`);
    await waitFor(win, 'Boolean(window.signalFieldGpuController)', 'parity renderer lock');
    const parityRenderer = await win.webContents.executeJavaScript(`({
      runtime:window.signalFieldGpuController.state(),
      bridgeAllowed:window.soundMotionGpuBridge.allowed,
      gpuVisible:document.getElementById('stage').classList.contains('gpu-enhanced')
    })`);
    if (parityRenderer.runtime.actual !== 'canvas' || parityRenderer.runtime.simulation !== 'canvas-baseline' || parityRenderer.bridgeAllowed || parityRenderer.gpuVisible || parityRenderer.runtime.fallbackReason !== 'parity-lock') {
      throw new Error(`Parity mode did not lock the Canvas renderer: ${JSON.stringify(parityRenderer)}`);
    }

    await win.loadURL(`${base}/website/?source=legacy#demo`);
    await waitFor(win, "location.pathname==='/'", 'legacy website redirect');
    const redirect = await win.webContents.executeJavaScript('({path:location.pathname,search:location.search,hash:location.hash})');
    if (redirect.search !== '?source=legacy' || redirect.hash !== '#demo') throw new Error(`Legacy redirect lost URL state: ${JSON.stringify(redirect)}`);
    if (errors.length) throw new Error(`Browser console errors: ${errors.join(' | ')}`);
    console.log('PASS creator entry, local music analysis, automatic Scene Studio direction, music-synchronised preview, mobile creator layout, Plate Lab defaults, GPU regular/random/sphere boundaries, per-style GPU mechanics, truthful WebGPU/Canvas runtime status, parity Canvas lock, bilingual UI, licenses, and /website/ redirect');
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(PROFILE, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  app.exit(1);
});
