# Signal Field project guide

**Updated:** 2026-07-22

## Product goal

Signal Field is a local-first creation tool that turns one music file into an editable 3D particle video timeline. The primary result is a directed music visual rather than an open-ended particle playground: users choose a template and output format, receive an automatically structured sequence, preview it against the original audio, and then refine or export it. Live visualization, data fields, focus sessions, Plate Lab, and expert rendering controls remain available as advanced workflows.

## Intended users

- Musicians, editors, and social creators who need a usable visual short from a song without manually keyframing every scene.
- Creators who want a controllable live visual layer for streaming, performance, and recording.
- Knowledge workers who want a calm, stateful focus environment rather than a passive screen saver.
- Analysts, educators, and students who want to explore how a time series changes a spatial particle field.

## Core flows

1. **Automatic music visual:** choose a local song, one of three direction templates, `16:9`, `9:16`, or `1:1`, and a target duration. Analysis extracts energy, spectral balance, change intensity, tempo, and sections without uploading the file.
2. **Directed preview:** the generated scenes and keyframes are imported through Scene Studio validation, then previewed against the selected audio clock so cuts and transitions stay aligned after seek or replay.
3. **Refine and export:** adjust the generated scenes with the retained controls and Scene Studio. The Web app exports a portable project JSON; the desktop exporter renders that project with the audio to H.264 MP4 or ProRes MOV.
4. **Live field:** choose a particle mode, then use the generated demo signal, microphone, user-file, or system-audio input where the platform permits it.
5. **Advanced labs:** data fields, focus sessions, anomaly replay, and Plate Lab remain available without replacing the creator-first path.

## Module map

| Area | Responsibility |
| --- | --- |
| `index.html` | Public/local Web shell, controls, responsive presentation, and the embedded visual engine. |
| `app/index.html` | Shared particle renderer, audio analysis, data-field controls, and runtime state. |
| `app/music-director.js` | Dependency-free music feature analysis, tempo/section estimates, and deterministic template-to-project planning. |
| `app/scene-studio.js` | Dependency-free, validated scene/project/timeline state and renderer recipe mapping. |
| `app/scene-studio-ui.js` | Creator flow, audio-clock preview, responsive Scene Studio UI, local persistence, and JSON import/export. |
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
npm run verify:music-director
npm run verify:video-export-options
npm run verify:plate-lab
npm run verify:renderer-capabilities
npm run verify:webgpu
```

For macOS screen saver work, use `npm run build:screensaver:mac` and `npm run smoke:screensaver:mac`. Build output and signing/notarization are release tasks, not source-of-truth files.

## Public-release boundary

Signal Field has its own product name, bundle IDs, release names, and original Signal Field app icon. The underlying code started from an Apache-2.0 upstream project, so `LICENSE` and the required notices stay in source and distributable artifacts. That is compatible with independent branding; it is not compatible with concealing provenance.

Inherited icons, media, and the prior Pixabay track were removed from Signal Field. Their licensing records remain in this repository; do not re-add them as promotional, commercial-release, or bundled material. Capture new screenshots/video from the current build and document the source and license for every newly added asset. Dynamic-mode preview uses a generated, non-audible signal.

## Current scope and next product work

The first creator MVP now performs local music analysis, offers three distinct direction templates and three output aspects, creates a validated Scene Studio timeline, previews it against the uploaded audio, and exports an editable project. The desktop CLI accepts that project and audio for deterministic H.264 or ProRes rendering. It does not yet provide lyrics, beat-by-beat manual editing, a GUI render queue, or additive WebGPU output in encoded video; those are future product work, not current claims.

The retained baseline still includes Web, Electron, system audio, microphone/file input, four visual styles, fullscreen, macOS screen saver/lock paths, data events, Plate Lab, and the full advanced workspace. Compatible Web browsers can add the 64K/128K WebGPU enhancement, while transparent/native overlays, parity tests, deterministic video exports, unsupported hardware, and device-loss states remain Canvas-only.
