# Technical evolution

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
