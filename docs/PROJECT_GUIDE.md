# Signal Field project guide

**Updated:** 2026-07-21

## Product goal

Signal Field is a local-first visual instrument for turning live sound, imported data, and intentional motion into explorable particle fields. It is not positioned only as a music visualizer: the product direction includes focus sessions, data-field exploration, anomaly replay, and educational resonance experiments.

## Intended users

- Creators who want a controllable live visual layer for music, streaming, and recording.
- Knowledge workers who want a calm, stateful focus environment rather than a passive screen saver.
- Analysts, educators, and students who want to explore how a time series changes a spatial particle field.

## Core flows

1. **Live field:** choose a particle mode, then use the generated demo signal, microphone, user-file, or system-audio input where the platform permits it.
2. **Data field:** import a local CSV or JSON array, choose a numeric signal or multi-column composition, scrub time, and inspect abnormal changes as field events.
3. **Focus field:** enter a timed, low-distraction scene; restore the prior visual state when the session ends.
4. **Presentation/export:** enter fullscreen or a desktop overlay, save/reuse a field state, and export a video when needed.
5. **Scene score:** capture complete visual states, reorder or revise them, preview interpolated keyframes, and move the versioned project JSON between devices.
6. **Plate Lab:** move an excitation point and sweep frequency on a physically grounded rectangular thin-plate model, then map the selected mode into the retained 3D particle field without changing the active audio/data source.

## Module map

| Area | Responsibility |
| --- | --- |
| `index.html` | Public/local Web shell, controls, responsive presentation, and the embedded visual engine. |
| `app/index.html` | Shared particle renderer, audio analysis, data-field controls, and runtime state. |
| `app/scene-studio.js` | Dependency-free, validated scene/project/timeline state and renderer recipe mapping. |
| `app/scene-studio-ui.js` | Responsive Scene Studio UI, local persistence, timeline playback, and JSON import/export. |
| `app/plate-lab-core.js` | Validated SI-unit Kirchhoff–Love rectangular-plate modes, responses, grids, and allowlisted 3D recipes. |
| `app/plate-lab-ui.js` | Keyboard/touch Plate Lab, nodal-map readout, resonance stepping, and honest model-boundary copy. |
| `app/renderer-capabilities.js` | WebGPU/WebGL2/Canvas detection, stable recommendations, fallback state, and device-loss reporting. |
| `app/webgpu-particle-backend.js` | Real WGSL compute/render pipelines, 3D cyclic dual-mode nodal physics, cube/sphere/32-plane convex confinement, per-style force inputs, row-major camera projection, adaptive 64K/128K particles, and device-loss lifecycle. |
| `app/webgpu-integration.js` | Versioned bridge for the live excitation, dominant modes, rotation, zoom and style; progressive activation, preference, and Canvas fallback control. |
| `app/renderer-capabilities-ui.js` | Status and controls that distinguish recommendation, actual Canvas/WebGPU runtime, submitted first frame, and fallback reason. |
| `desktop/` | Electron main process, controller, transparent overlay, tray integration, and system-audio bridge. |
| `macos-screensaver/` | Native Metal implementation for the macOS screen saver. |
| `macos-lock-launcher/` | macOS configuration and launch utility for the screen saver path. |
| `scripts/` | Validation, release packaging, screen saver builds, Pages builds, and export automation. |

## Operating commands

```bash
npm install
npm run check
npm start
npm run build:pages
npm run verify:pages
npm run verify:scene-studio
npm run verify:plate-lab
npm run verify:renderer-capabilities
npm run verify:webgpu
```

For macOS screen saver work, use `npm run build:screensaver:mac` and `npm run smoke:screensaver:mac`. Build output and signing/notarization are release tasks, not source-of-truth files.

## Public-release boundary

Signal Field has its own product name, bundle IDs, release names, and original Signal Field app icon. The underlying code started from an Apache-2.0 upstream project, so `LICENSE` and the required notices stay in source and distributable artifacts. That is compatible with independent branding; it is not compatible with concealing provenance.

Inherited icons, media, and the prior Pixabay track were removed from Signal Field. Their licensing records remain in this repository; do not re-add them as promotional, commercial-release, or bundled material. Capture new screenshots/video from the current build and document the source and license for every newly added asset. Dynamic-mode preview uses a generated, non-audible signal.

## Current scope and next product work

The retained baseline includes Web, Electron, system audio, microphone/file input, visual presets, fullscreen, video export, macOS screen saver/lock paths, data events, a physically grounded rectangular Plate Lab, and a versioned Scene Studio. Compatible Web browsers now add a real 64K/128K WebGPU Compute layer with 3D position/velocity, two signed cyclic modes, nodal-gradient motion, Z excitation, the live Canvas camera, regular/irregular convex confinement, sphere confinement, and per-style force profiles over the complete Canvas visual. Transparent/native overlays, parity tests, deterministic exports, user-disabled sessions, unsupported hardware, and device-loss states remain Canvas-only. Full replacement of the established CPU physics is still future work.
