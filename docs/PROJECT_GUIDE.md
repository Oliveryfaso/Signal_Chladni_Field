# Signal Field project guide

**Updated:** 2026-07-27

## Product goal

Signal Field is a local-first generative 3D lyric-video tool for independent musicians. It turns one music file and optional lyrics into an editable particle-video timeline. The primary result is a directed, exportable music visual rather than an open-ended particle playground or general-purpose video editor. Live visualization, data fields, focus sessions, Plate Lab, and expert rendering controls remain available as advanced workflows.

## Intended users

- Musicians, editors, and social creators who need a usable visual short from a song without manually keyframing every scene.
- Creators who want a controllable live visual layer for streaming, performance, and recording.
- Knowledge workers who want a calm, stateful focus environment rather than a passive screen saver.
- Analysts, educators, and students who want to explore how a time series changes a spatial particle field.

## Core flows

1. **Automatic music visual:** choose a local song, one of three direction templates, `16:9`, `9:16`, or `1:1`, and a target duration. Analysis extracts energy, spectral balance, change intensity, tempo, and sections without uploading the file.
2. **Directed preview:** the generated scenes and keyframes are imported through Scene Studio validation, then previewed against the selected audio clock so cuts and transitions stay aligned after seek or replay.
3. **Finish:** choose an opening-title template, paste plain-text lyrics for a local structure/line-length timing draft or import timestamped LRC, and select relaxed/balanced/punchy beat-cut density. A bounded local waveform timeline then supports seeking plus pointer/keyboard adjustment of lyric ranges and beat points. These settings form a strict Production Spec around the unchanged Scene Studio project.
4. **Recover and render:** the Creator stores a bounded canonical session without audio bytes or paths. A restored project asks the user to reselect the matching local audio before synchronized preview or desktop encoding. The Web app downloads the Production Spec; the desktop Creator preflights FFmpeg/ffprobe and uses a native save dialog plus serial queue with progress, cancellation, failure retry, completion, and Finder reveal.
5. **Live field:** choose a particle mode, then use the generated demo signal, microphone, user-file, or system-audio input where the platform permits it.
6. **Advanced labs:** data fields, focus sessions, anomaly replay, and Plate Lab remain available without replacing the creator-first path.

## Module map

| Area | Responsibility |
| --- | --- |
| `index.html` | Public/local Web shell, controls, responsive presentation, and the embedded visual engine. |
| `app/index.html` | Shared particle renderer, audio analysis, data-field controls, and runtime state. |
| `app/music-director.js` | Dependency-free music feature analysis, tempo/section estimates, and deterministic template-to-project planning. |
| `app/lyric-timing.js` | Deterministic local line-level timing drafts from plain-text lyrics and existing music analysis; explicitly not speech recognition. |
| `app/production-spec.js` | Strict title, LRC lyric, beat-edit, aspect, output, and embedded-project envelope. |
| `app/production-session.js` | Versioned bounded Creator recovery, canonical editor state, and non-media audio identity matching. |
| `app/production-overlay.js` | Shared Canvas compositor for preview and encoded title/lyric/beat overlays. |
| `app/timeline-editor-core.js` | Bounded waveform peaks, time/coordinate mapping, lyric boundary constraints, beat-grid snapping, and immutable edit operations. |
| `app/waveform-timeline.js` | Responsive Canvas waveform plus semantic lyric/beat controls, zoom, seeking, playhead, pointer drag, and keyboard editing. |
| `app/scene-studio.js` | Dependency-free, validated scene/project/timeline state and renderer recipe mapping. |
| `app/scene-studio-ui.js` | Creator flow, audio-clock preview, responsive Scene Studio UI, local persistence, and JSON import/export. |
| `app/plate-lab-core.js` | Validated SI-unit Kirchhoff–Love rectangular-plate modes, responses, grids, and allowlisted 3D recipes. |
| `app/plate-lab-ui.js` | Keyboard/touch Plate Lab, nodal-map readout, resonance stepping, and honest model-boundary copy. |
| `app/renderer-capabilities.js` | WebGPU/WebGL2/Canvas detection, stable recommendations, fallback state, and device-loss reporting. |
| `app/webgpu-particle-backend.js` | Real WGSL compute/render pipelines, 3D cyclic dual-mode nodal physics, cube/sphere/32-plane convex confinement, per-style force inputs, row-major camera projection, adaptive 64K/128K particles, and device-loss lifecycle. |
| `app/webgpu-integration.js` | Versioned bridge for the live excitation, dominant modes, rotation, zoom and style; progressive activation, preference, and Canvas fallback control. |
| `app/renderer-capabilities-ui.js` | Status and controls that distinguish recommendation, actual Canvas/WebGPU runtime, submitted first frame, and fallback reason. |
| `desktop/bootstrap.cjs` | Dispatches the render worker before loading the desktop UI in development and packaged applications. |
| `desktop/render-queue.cjs` | Allowlisted serial H.264/ProRes task queue with progress, cancellation, failure retry, and safe process spawning. |
| `desktop/` | Electron Creator/control/visualizer windows, native save flow, tray integration, and system-audio bridge. |
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
npm run verify:lyric-timing
npm run verify:production-spec
npm run verify:production-session
npm run verify:production-overlay
npm run verify:timeline-editor
npm run verify:render-queue
npm run verify:packaged-render-worker -- "/path/to/Signal Field.app" --encode
npm run verify:video-export-options
npm run verify:video-export-smoke
npm run verify:plate-lab
npm run verify:renderer-capabilities
npm run verify:webgpu
```

For macOS screen saver work, use `npm run build:screensaver:mac` and `npm run smoke:screensaver:mac`. Build output and signing/notarization are release tasks, not source-of-truth files.

## Public-release boundary

Signal Field has its own product name, bundle IDs, release names, and original Signal Field app icon. The underlying code started from an Apache-2.0 upstream project, so `LICENSE` and the required notices stay in source and distributable artifacts. That is compatible with independent branding; it is not compatible with concealing provenance.

Inherited icons, media, and the prior Pixabay track were removed from Signal Field. Their licensing records remain in this repository; do not re-add them as promotional, commercial-release, or bundled material. Capture new screenshots/video from the current build and document the source and license for every newly added asset. Dynamic-mode preview uses a generated, non-audible signal.

## Current scope and next product work

The creator workflow now performs local music analysis, offers three direction templates and three aspects, creates a validated Scene Studio timeline, adds four controlled title treatments, converts plain-text lyrics into a review-required local timing draft or imports timestamped LRC, and produces three densities of deterministic beat edits. A 4096-bucket local waveform editor shares the audio playhead, supports fit/zoom and local horizontal scrolling, and commits constrained lyric/beat moves into the same Production Spec used by preview and export. The stage uses the selected output ratio, finishing edits have bounded undo/redo, and the canonical Production session survives reloads while requiring explicit same-audio reselection. The desktop app preflights its external encoders and adds H.264/ProRes work to a serial local queue with retry and Finder reveal.

Current limits are explicit: plain-text timing is a structure/tempo/line-length draft and does not listen for sung words. There is no speech transcription, forced alignment, lyric search, word-level karaoke, multi-track audio editing, parallel/persistent queue, embedded font pack, or additive WebGPU layer in encoded video. FFmpeg/ffprobe remain external machine requirements rather than bundled binaries. The packaged worker has a dedicated bootstrap and verifier, but each release artifact still needs that verifier plus real encode QA; signed/notarized distribution requires the publisher's Apple credentials.

The 2026-07-23 competitive audit chose one narrow direction instead of copying preset ecosystems, stock-footage services, or general cloud editors. See [COMPETITIVE_AUDIT.zh-CN.md](COMPETITIVE_AUDIT.zh-CN.md).

The retained baseline still includes Web, Electron, system audio, microphone/file input, four visual styles, fullscreen, macOS screen saver/lock paths, data events, Plate Lab, and the full advanced workspace. Compatible Web browsers can add the 64K/128K WebGPU enhancement, while transparent/native overlays, parity tests, deterministic video exports, unsupported hardware, and device-loss states remain Canvas-only.
