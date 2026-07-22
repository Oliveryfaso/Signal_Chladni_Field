> **Modification notice:** This documentation was modified by Signal Field contributors; see `LICENSE`, `UPSTREAM_NOTICE.md`, and `MODIFICATIONS.md`.

<p align="center">
  <a href="https://oliveryfaso.github.io/Signal_Chladni_Filed/"><strong>Open the live Signal Field demo</strong></a>
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Local-first signal, data, and motion visualizer</strong>
</p>

<p align="center"><sub>Build and signing status is release-specific; do not treat development artifacts as notarized.</sub></p>

# Signal Field

Signal Field turns sound, data, and motion into evolving three-dimensional resonance fields. The particles are not textures or prerecorded animation: they continuously form nodal structures through modal resonance, inertial motion, and spatial projection.

The repository contains a deployable Web Demo plus source-buildable Mac music visualizer and native Mac screen saver / lock animation. The Windows visualizer is an open contributor track.

[简体中文](README.zh-CN.md) · [Detailed desktop notes](README.txt) · [Product and release guide](docs/PROJECT_GUIDE.md)

## Applications

| Application | Status | Description |
| --- | --- | --- |
| Web Demo | [Live demo](https://oliveryfaso.github.io/Signal_Chladni_Filed/) | GitHub Pages deployment; generated demo signal drives Dynamic Sand and Dynamic Cosmic |
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

## Web Demo

The repository-root `index.html` is the publishing entry point. It embeds the real visual engine from `app/index.html`; there is no second particle implementation to maintain.

**[Open the live Web Demo](https://oliveryfaso.github.io/Signal_Chladni_Filed/)**

- Switch the full interface between English and Chinese from the bottom dock.
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

| Capability | Web Demo | Mac visualizer | Mac screen saver / lock animation |
| --- | --- | --- | --- |
| Dynamic Sand / Dynamic Cosmic | Supported | Supported | Audio analysis disabled |
| Modal Sand / Cosmic Web | Supported | Supported | Supported |
| Generated demo signal | Supported | Supported | Not required |
| User audio file / microphone | Browser support | Supported | Not supported |
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
app/plate-lab-core.js       Thin-plate modes, response, sampled grids, and safe mapping core
app/plate-lab-ui.js         Touch/keyboard Plate Lab and nodal-map interface
app/scene-studio.js         Scene, project, keyframe, and safe-recipe core
app/scene-studio-ui.js      Scene Studio, timeline, and local project interaction
app/renderer-capabilities.js Renderer capability, fallback, and device-loss state
app/webgpu-particle-backend.js WGSL compute/render, ping-pong buffers, and 64K/128K particles
app/webgpu-integration.js    Runtime bridge between the Canvas visual and WebGPU enhancement layer
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
npm run verify:plate-lab
npm run verify:renderer-capabilities
npm run verify:webgpu
npm run verify:mac-parity
```

Regenerate release media with:

```bash
npm run capture:release-media
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
