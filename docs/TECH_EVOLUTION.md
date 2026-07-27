# Technical evolution

## 2026-07-27 — Production-grade Creator recovery and packaged render dispatch

- Added a strict bounded Production session that stores the canonical project, title, lyrics, beat edits, choices, and allowlisted audio identity metadata without file paths, media bytes, PCM, Blob, or waveform caches.
- Restored sessions reopen in their true output aspect and require explicit matching-audio reselection before synchronized desktop rendering. Matching audio rebuilds local waveform/tempo analysis while preserving editorial state.
- Added bounded finishing undo/redo, safe invalid-session clearing, desktop FFmpeg/ffprobe preflight, failed-job retry, completed-output Finder reveal, and responsive queue actions.
- Added a bootstrap entry that dispatches the same render worker from development Electron and packaged `.app` executables before the normal desktop main process loads.
- Added package-worker, recovery, aspect, mobile-overflow, and queue-retry verification. macOS release builds on filesystems that create AppleDouble `._app.asar` files must use an APFS/internal working copy before artifact verification.

## 2026-07-23 — Deterministic local plain-text lyric timing

- Added a dependency-free lyric timing module that converts one-line-per-cue plain text into ordered, non-overlapping Production Spec lyric ranges using the existing local music analysis.
- Allocation uses a bounded activity window, leading/trailing quiet sections, line-length weights, and optional confident beat snapping. It does not upload media or claim to detect sung words.
- Added explicit review diagnostics and a conservative 60% maximum reference confidence; the generated LRC immediately reuses the existing waveform timeline, shared preview overlay, JSON transfer, and desktop export.
- Added strict unit coverage plus Pages integration coverage for the pure-text-to-canonical-lyrics flow, corrected the Chinese Creator document language, and preserved the 390-pixel mobile path.

## 2026-07-23 — Bounded waveform timeline and canonical manual edits

- Added a dependency-free timeline core for local PCM min/max peaks, time/coordinate mapping, lyric boundary constraints, and beat-grid snapping. Waveform data is bounded to 4096 UI buckets and never enters exported Production Specs.
- Added one responsive waveform editor shared by Web and Electron Creator. It follows the existing audio clock, supports click/keyboard seeking, fit-to-window through 8× zoom, local horizontal scrolling, pointer dragging, and keyboard-equivalent lyric/beat editing.
- Manual lyric moves rewrite normalized LRC starts and preserve explicit end ranges in the Production Spec. Manual beat positions survive title edits and density changes; replacement requires the explicit reset action.
- The Canvas backing store tracks only the visible viewport rather than the zoomed content width. Mobile Pages verification keeps the document within 390 pixels while allowing intentional scroll inside the timeline viewport.

## 2026-07-23 — Production Spec, shared overlays, and desktop render queue

- Added the strict `signal-field-production/v1` envelope around an unchanged Scene Studio project. It validates four title templates, ordered non-overlapping LRC cues, cut/accent/hold beat edits, output aspect, codec, and safe file name.
- Added one Canvas compositor shared by browser preview and deterministic export. Title and lyric time boundaries, portrait/square/landscape safe areas, DPR, reduced motion, accent pulses, and hold treatment no longer diverge between UI and encoded frames.
- Added relaxed, balanced, and punchy beat-edit compilation. Hard cuts reference validated scene IDs; accent and hold events remain visible even when they fall between low-FPS export frames.
- Added a dedicated Electron Creator window that reuses `app/index.html`, plus a native save flow and in-memory serial queue with queued/running/completed/failed/cancelled states, progress parsing, cancellation, bounded errors, and managed temporary Production Specs.
- Kept Pages honest: the browser downloads a Production Spec and never claims to encode MP4. Desktop source builds invoke the existing exporter without shell-string execution.
- Added a real FFmpeg smoke that renders audio, title, lyric, beat cut, and square H.264 output, then verifies the stream using ffprobe.

## 2026-07-22 — Creator-first automatic music visual MVP

- Added local music analysis with bounded decoding, Blackman-window spectral frames, energy/brightness/roughness/flux features, tempo confidence, and section estimates. No audio upload or new runtime dependency is required.
- Added three deterministic direction templates — Ambient Orbit, Pulse Cut, and Sand Study — that convert analysis into validated Scene Studio scenes, cues, keyframes, and safe renderer snapshots.
- Added a primary upload/template/aspect/duration flow above the advanced workspace. It supports `16:9`, `9:16`, and `1:1`, clear empty/error/progress states, keyboard selection, and a 390-pixel mobile layout.
- Changed automatic preview to follow the uploaded audio's current time. Stopping, seeking, or replaying no longer lets the visual timeline drift on an independent wall clock.
- Extended deterministic desktop export with `--project` and `--aspect`; project timelines can render with an audio file to H.264 MP4 or ProRes MOV. The Web app intentionally exports the editable project rather than claiming browser-side encoded video.
- Preserved all four visual styles, Scene Studio, Plate Lab, data/focus workflows, Canvas fallback, and the additive WebGPU enhancement as advanced capabilities.

## 2026-07-22 — First real WebGPU Compute enhancement

- Added a dependency-free WebGPU backend with real WGSL compute and render pipelines, two ping-pong particle storage buffers, instanced soft particles, adaptive 64K/128K tiers, DPR-aware canvas reconfiguration, and explicit device-loss/resource cleanup.
- Added a transparent GPU enhancement canvas over the retained Canvas engine. Canvas continues to render all four established modes; WebGPU adds a resonance field driven by the same mode, excitation, energy, and style state.
- Upgraded that field to real 3D position/velocity, the retained engine's cyclic three-term `phi3`, analytic nodal gradients, two signed dominant modes, Z excitation, and the live row-major rotation/zoom camera. Uniforms use ten explicitly aligned `vec4` blocks (160 bytes).
- Matched Canvas projection in WebGPU clip space, including independent width/height scaling, screen-Y inversion, safe 0–1 depth, and wide/portrait aspect correction.
- Added sparse-upload shape confinement for cube, sphere and up to 32 normalized convex planes. Regular, irregular and high-face round shapes now drive the GPU boundary, while the four visual styles provide distinct pointer, node, drift, damping and collision profiles.
- Defined actual activation as a successfully submitted first frame. API presence, adapter discovery, device creation, or pipeline creation alone cannot change the UI to WebGPU active.
- Added user disable/retry, persisted preference, truthful recommendation-versus-runtime status, and automatic visual fallback without a black frame.
- Locked native overlays, alpha output, parity tests, deterministic DPR exports, and Electron native-host paths to Canvas. The GPU layer is currently a Web enhancement, not a replacement for the existing CPU 3D physics or native Metal screen saver.

## 2026-07-21 — Physical Plate Lab and honest renderer capability shell

- Added a dependency-free, deterministic Kirchhoff–Love rectangular thin-plate core with SI validation, named material presets, simply-supported analytic modes, an explicitly labeled clamped approximation, frequency response, sampled mode grids, and allowlisted visual recipes.
- Replaced the generic resonance-lab presentation with a touch- and keyboard-accessible Plate Lab showing excitation location, modal node lines, theoretical frequency, coupling, and one-step mapping into the retained 3D particle field.
- Mapping changes visual structure, detail, motion, and energy while preserving the selected audio/data input. The UI explicitly says the mapping is resonance-inspired visualization rather than a strict 3D material simulation.
- Added a renderer capability store for WebGPU, WebGL2 transform feedback, and Canvas 2D, including stable fallback recommendations and device-loss reporting. The product surface continues to identify Canvas as the actual renderer until a GPU backend is connected.
- Verified the Plate Lab at 390 CSS pixels with no horizontal overflow, 44-pixel controls, reduced-motion behavior, and zero browser console warnings.

## 2026-07-21 — Versioned Scene Studio and advanced-rendering boundary

- Added a dependency-free scene/project/timeline core with strict schema validation, deterministic JSON round-trips, scene CRUD/reordering, numeric interpolation, step semantics for booleans/enums, and an allowlisted renderer recipe.
- Added a responsive Scene Studio surface for capturing and overwriting states, renaming/reordering/deleting scenes, timeline playback and scrubbing, local persistence, and safe JSON import/export.
- Timeline playback uses the generated local demo signal only when no source is already playing. It restores the previously selected source after playback, while an already-running user input continues uninterrupted.
- Chose a progressive rendering path: the existing Canvas renderer and four styles remain the compatibility baseline; future WebGPU compute particles and volume rendering are additive backends, not replacements.
- Separated the existing 3D modal-volume visualization from a future physically grounded thin-plate lab so product copy can distinguish immersive mapping from plate-vibration modeling.

## 2026-07-20 — Signal Field product identity and release boundary

- Rebranded all user-facing Web compatibility, Electron, screen saver, lock-launcher, installer, artifact, and GitHub Release names to **Signal Field**.
- Replaced packaging references to the upstream icon with a new original `desktop/assets/signal-field-icon.*` asset set. The SVG is the canonical source; generated PNG, ICNS, and ICO files are build-ready variants.
- Changed Electron and macOS bundle identifiers from the upstream namespace to `com.signalfield.visualizer` and corresponding screen saver/lock identifiers. A publisher should choose an organization-controlled reverse-DNS identifier before notarized production release if `com.signalfield` is not controlled by them.
- Added Apache/asset/third-party/upstream notices to desktop package inputs and the GitHub Pages artifact. This keeps downstream distributions auditable.
- Kept the renderer bridge and internal `soundMotion*` IPC names unchanged for compatibility. They are implementation details, not product branding; renaming them is a separate, test-backed refactor.

## 2026-07-20 — Product extension baseline

- The shared visual engine now supports data-field concepts alongside audio-driven visuals: local data import, numeric signal mapping, multi-metric composition, and anomaly-event presentation.
- Focus sessions provide a stateful non-audio use case. Future work should persist scenes as versioned recipes rather than coupling them to transient UI state.

## Technical constraints

- `app/index.html` is the shared rendering source for Web and Electron. Keep rendering behavior centralized there; do not create a second particle engine for the public shell.
- The macOS screen saver is a separate Metal implementation, so visual changes need parity checks instead of assuming the Web renderer automatically updates it.
- Existing upstream promotional media and icons are not part of the Signal Field asset pipeline. New release media must be generated from current builds.
