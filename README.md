> **Modification notice:** This documentation was modified by Signal Field contributors; see `LICENSE`, `UPSTREAM_NOTICE.md`, and `MODIFICATIONS.md`.

<p align="center">
  <a href="https://oliveryfaso.github.io/Signal_Chladni_Field/"><strong>Open the live Signal Field demo</strong></a>
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Local-first automatic music visual video creator</strong>
</p>

<p align="center"><sub>Build and signing status is release-specific; do not treat development artifacts as notarized.</sub></p>

# Signal Field

Signal Field turns a local music file into an editable 3D particle video timeline. Choose a direction template, aspect, and duration; it analyzes the song on your device, builds a sequence of visual scenes, and previews the result in sync with the original audio. The particles are not textures or prerecorded animation: they continuously form nodal structures through modal resonance, inertial motion, and spatial projection.

The repository contains a deployable Web Demo plus source-buildable Mac music visualizer and native Mac screen saver / lock animation. The Windows visualizer is an open contributor track.

[简体中文](README.zh-CN.md) · [Detailed desktop notes](README.txt) · [Product and release guide](docs/PROJECT_GUIDE.md)

## Applications

| Application | Status | Description |
| --- | --- | --- |
| Web creator | [Live app](https://oliveryfaso.github.io/Signal_Chladni_Field/) | Upload a local song, generate a directed timeline, preview it with audio, and export an editable project |
| Mac music visualizer | Source build available | Electron app that follows system audio after permission, with overlay and fullscreen modes; no notarized binary is claimed |
| Mac screen saver / lock animation | Source build available | Native Metal renderer for optimized Modal Sand and Cosmic Web animation; build and install locally |
| Windows music visualizer | Contributors wanted | Cross-platform Electron and packaging foundations exist; Windows adaptation and device validation remain |

> [!WARNING]
> **Power use:** The Web Demo and Mac music visualizer continuously perform high-density particle computation and real-time rendering and can drain a laptop battery very quickly. Running them on battery power is not recommended. The macOS screen saver uses a separate native Metal rendering path that has been optimized for computation and energy use.

## Visual Modes

| Mode | Input | Default detail | Visual behavior |
| --- | --- | --- | --- |
| Dynamic Sand | Generated demo / user audio / system audio | `1.5x` | Spectrum-driven inertial sand migration |
| Modal Sand | None required | `1.0x` | Stable Chladni nodal sculpture |
| Cosmic Web | None required | `1.0x` | Three-dimensional particle web, precession, and moving light |
| Dynamic Cosmic | Generated demo / user audio / system audio | `1.5x` | Signal-driven modal mixing and spatial deformation |

Each mode remembers its adjusted detail value for the current session. Particle density defaults to `15%`. Dynamic modes include low-frequency modal protection so bass-heavy audio retains visible structural detail.

## Create a Music Visual

1. Open the Web creator and select a local audio file. The browser does not upload it.
2. Choose **Ambient Orbit**, **Pulse Cut**, or **Sand Study**, then select `16:9`, `9:16`, or `1:1` and a full/short duration.
3. Select **Analyze and generate**. Signal Field estimates energy, spectral balance, changes, tempo, and song sections, then creates a validated Scene Studio timeline.
4. Open **Finish the video** to choose Minimal, Cinematic, Kinetic, or no opening title; create a local timing draft from one-line-per-cue plain text or import timestamped LRC lyrics; and choose relaxed, balanced, or punchy beat cuts. The draft is not speech recognition and should be reviewed on the waveform.
5. Use the bounded waveform timeline to seek, zoom, and move lyric edges or beat points with pointer or keyboard. Manual beats stay in place until the explicit regenerate action. Creator finishing actions support bounded undo/redo.
6. Preview the same title/lyric/beat compositor used by final export in the actual `16:9`, `9:16`, or `1:1` frame. The production session is saved locally; after a reload, reselect the matching audio file to reconnect waveform, preview, and export without storing audio bytes or paths. On the Web, download the validated Production Spec. In the desktop Creator, choose **Render video** to select an output location and add the job to the local queue.

The desktop Creator provides the one-click path. The equivalent CLI accepts either a Production Spec or the earlier scene project:

```bash
npm run export:video -- --production signal-field-production.json --audio song.mp3 \
  --aspect 9:16 --output signal-field-video.mp4
```

The desktop preflight checks FFmpeg and ffprobe before enabling video output. The queue reports waiting, frame progress, completion, failure, cancellation, failed-job retry, and Finder reveal. The CLI produces H.264 MP4 by default or ProRes MOV when the output ends in `.mov`. Browser export produces the Production Spec, not a fake encoded video; audio is never bundled in that JSON. Deterministic video export uses the complete Canvas renderer and does not include the additive WebGPU enhancement.

## Web Creator and Advanced Workspace

The repository-root `index.html` is the publishing entry point. It embeds the real visual engine from `app/index.html`; there is no second particle implementation to maintain.

**[Open the live Web Demo](https://oliveryfaso.github.io/Signal_Chladni_Field/)**

- The creator-first surface handles local upload, three direction templates, three output aspects, automatic scene planning, audio-synchronised preview, and editable project export.
- Finishing controls add controlled opening-title templates, local plain-text lyric timing drafts or timestamped LRC subtitles, three densities of beat cuts, and a responsive waveform editor for constrained lyric/beat timing. Preview and encoded video share the same Canvas compositor.
- Switch the full visualizer interface between English and Chinese from the bottom dock.
- Randomize patterns, enter fullscreen, pause rotation, and drag to inspect the form.
- Advanced controls cover single-axis rotation, tumble, precession, speed, zoom, detail, particles, lighting, and solid shape.
- Plate Lab uses analytic rectangular thin-plate modes to expose node lines, theoretical frequency, and excitation coupling, then maps the result into the retained 3D particle field without switching the active audio/data input.
- Scene Studio captures, overwrites, renames, reorders, and removes complete looks, then previews them on an interpolated timeline. Versioned project JSON stays local and is validated on import.
- A real WebGPU Compute enhancement runs 64K/128K particles through two signed three-dimensional cyclic modes, nodal-gradient motion, Z-axis excitation, the live Canvas camera, and matching sphere/regular/irregular convex boundaries. Each visual style has its own pointer, node, drift, damping, and restitution profile. It becomes active only after first-frame submission succeeds and always retains the complete Canvas fallback.
- Fullscreen hides the title, dock, and settings; press `Esc` to exit.
- The mobile dock reflows without horizontal overflow.

Release screenshots and videos must be captured from the current Signal Field build. The inherited `media/` directory was removed and is not part of Signal Field.

## Run Locally

On macOS, double-click `start.command`, or run this from the repository root:

```bash
python3 -m http.server 8777
```

Open [http://localhost:8777/](http://localhost:8777/). Use an HTTP server rather than opening the page through `file://`; browsers apply additional restrictions to local audio initialization and AudioContext.

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. After pushing to `main`, choose **GitHub Actions** under **Settings → Pages → Source**. The workflow will:

1. Check JavaScript and publishing-script syntax.
2. Package the Web shell (`index.html`, `app/`, and the compatibility `website/` route) together with its license and notice files.
3. Publish the static artifact to the repository's `github.io` URL.

Relative paths support project Pages URLs such as `https://owner.github.io/repository/`. Legacy `/website/` links preserve query parameters and fragments while redirecting to the new root.

Build and verify manually with:

```bash
npm run build:pages
npm run verify:pages
```

## Capability Boundaries

| Capability | Web creator | Mac visualizer | Mac screen saver / lock animation |
| --- | --- | --- | --- |
| Dynamic Sand / Dynamic Cosmic | Supported | Supported | Audio analysis disabled |
| Modal Sand / Cosmic Web | Supported | Supported | Supported |
| Generated demo signal | Supported | Supported | Not required |
| User audio file / microphone | Browser support | Supported | Not supported |
| Automatic music direction / editable project | Supported for local audio files | Web creator project can be rendered by CLI | Not supported |
| H.264 / ProRes encoded video | Export project, then use desktop CLI | Supported by deterministic CLI | Not supported |
| System audio | No general browser API | Supported after explicit permission | Not supported |
| Transparent overlay and menu bar | Not supported | Supported | Not applicable |
| WebGPU Compute particle enhancement | Supported in compatible browsers with automatic fallback | Canvas locked for now | Not applicable |
| Native optimized rendering | Not supported | Not supported | Supported |

The Web and desktop visualizers use a generated, non-audible demo signal to preview Dynamic modes without bundling third-party music. The screen saver uses a separate native Metal rendering path and does not start Electron, WebKit, or audio analysis.

## Mac Visualizer

```bash
npm install
npm start
```

Build an unpacked macOS application with:

```bash
npm run package:mac
```

Video encoding currently requires `ffmpeg` and `ffprobe` on the destination Mac, or explicit `FFMPEG_PATH` and `FFPROBE_PATH` environment variables. The app performs this check before enabling one-click rendering. Verify dispatch and a real encoded frame with `npm run verify:packaged-render-worker -- "/path/to/Signal Field.app" --encode`. Signing and notarization still require the publisher's Apple Developer identity. When building from a non-APFS external drive that creates AppleDouble `._app.asar` files, build from an APFS working copy such as `/private/tmp` and copy the finished artifact back.

See [README.txt](README.txt) for screen saver and lock-launcher build, installation, and macOS system limitations.

## Windows Contributors

The Windows visualizer is not currently presented as a finished release. The repository already contains the Electron visual core, Windows packaging configuration, and system-audio integration foundations. Contributions are particularly useful for:

- Loopback-audio compatibility across Windows 10 / 11, audio interfaces, and Bluetooth devices.
- Transparent overlay, fullscreen, multi-monitor, and mixed-DPI stability.
- Installer, code-signing, automatic-update, and release workflows.
- GPU, CPU, and battery measurements, plus visual parity with Mac and Web output.

Use `npm run package:win` as the development packaging entry point. Windows will remain marked as a contributor track until the device matrix is validated.

## Architecture

```text
index.html                  GitHub Pages / local Web showcase shell
app/index.html              Particle physics, audio analysis, and Canvas rendering source of truth
app/music-director.js       Local music feature analysis and deterministic automatic direction plans
app/lyric-timing.js         Review-required local line timing drafts from plain-text lyrics
app/production-spec.js      Validated project/title/LRC/beat/output production envelope
app/production-session.js   Bounded crash recovery and audio re-selection identity
app/production-overlay.js   Shared title, lyric, accent, and hold Canvas compositor
app/timeline-editor-core.js Bounded waveform, coordinate, lyric, and beat edit core
app/waveform-timeline.js    Responsive Canvas waveform and accessible timing controls
app/plate-lab-core.js       Thin-plate modes, response, sampled grids, and safe mapping core
app/plate-lab-ui.js         Touch/keyboard Plate Lab and nodal-map interface
app/scene-studio.js         Scene, project, keyframe, and safe-recipe core
app/scene-studio-ui.js      Scene Studio, timeline, and local project interaction
app/renderer-capabilities.js Renderer capability, fallback, and device-loss state
app/webgpu-particle-backend.js WGSL compute/render, ping-pong buffers, and 64K/128K particles
app/webgpu-integration.js    Runtime bridge between the Canvas visual and WebGPU enhancement layer
scripts/verify-webgpu-integration.cjs Shape/force bridge integration verification
scripts/export-video.cjs    Project/audio/aspect-driven deterministic H.264 and ProRes export
desktop/bootstrap.cjs       Development/packaged render-worker dispatch before desktop UI startup
desktop/render-queue.cjs    Serial local render jobs, progress, cancellation, retry, and failure state
desktop/                    Electron main process, controls, and system-audio bridge
macos-screensaver/          Native Metal screen saver
scripts/build-pages.sh      Minimal static publishing artifact
scripts/verify-pages.cjs    Pages paths, languages, defaults, and audio verification
```

The renderer submits at most `60 FPS` and pauses the visual loop while hidden. Particle density and DPR adapt to canvas size; quality scaling disables expensive post-processing before changing the pattern structure.

## Validation

```bash
npm run check
npm run smoke
npm run verify:web-audio
npm run verify:pages
npm run verify:scene-studio
npm run verify:music-director
npm run verify:production-spec
npm run verify:production-overlay
npm run verify:render-queue
npm run verify:video-export-options
npm run verify:video-export-smoke
npm run verify:plate-lab
npm run verify:renderer-capabilities
npm run verify:webgpu
npm run verify:webgpu-integration
npm run verify:mac-parity
```

Regenerate release media with:

```bash
npm run capture:release-media
npm run export:video -- --production signal-field-production.json --audio song.mp3 \
  --aspect 9:16 --output exports/signal-field-music-video.mp4

# Or render a manually specified visual without a Scene Studio project:
npm run export:video -- --output exports/signal-field-cosmic-demo.mp4 \
  --style cosmic --width 1280 --height 720 --fps 30 --seconds 6 \
  --codec h264 --rotation precess --rotation-speed 1 --seed 20260711
```

## License

Licensing is split by scope. Apache-2.0 does not cover inherited media removed from the Signal Field release product.

| Scope | License |
| --- | --- |
| Source code, build scripts, configuration, and documentation | [Apache License 2.0](LICENSE), with required notices retained in [UPSTREAM_NOTICE.md](UPSTREAM_NOTICE.md) and [MODIFICATIONS.md](MODIFICATIONS.md) |
| Historic inherited screenshots, GIFs, MP4s and standalone particle presets | [CC BY-NC 4.0](ASSET_LICENSE.md); removed from the Signal Field release product |
| Historic third-party track notice | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); Signal Field distributes and plays no third-party music |
| Signal Field icon source and generated app icons | Original project asset, included under Apache-2.0 with this repository |

Signal Field's Web demo uses a generated signal, not bundled music. Apache-2.0 notice obligations and the inherited-media exclusion are release requirements, not optional cleanup. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution licensing.

## Release Checklist

Review [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before a public release, especially required code notices and capturing fresh Signal Field promotional media from this build.
