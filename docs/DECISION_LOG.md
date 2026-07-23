# Decision log

## 2026-07-23 — Keep waveform UI state out of the production schema

**Decision:** Treat PCM-derived min/max peaks, zoom, scroll, selection, and editor-only IDs as transient local UI state. Commit only constrained lyric ranges and beat edit times into the existing `signal-field-production/v1` fields.

**Why:** Final preview, JSON transfer, desktop queueing, and deterministic export already consume canonical lyrics and beat edits. A second editor schema would create drift, increase private-media risk, and make projects depend on disposable waveform caches.

**Boundary:** The first editor provides one waveform, one lyric lane, and one beat lane with per-item pointer/keyboard editing. Multi-track audio, clip cutting, word-level karaoke, bulk selection, and general undo/redo remain later NLE work.

## 2026-07-23 — Separate production instructions from scene state

**Decision:** Keep Scene Studio focused on reusable renderer snapshots and wrap it in a versioned Production Spec for titles, timestamped lyrics, beat edits, aspect, codec, and file name. Use one overlay compositor in browser preview and deterministic video export.

**Why:** Scene state and editorial delivery metadata evolve at different rates. The envelope preserves old project compatibility, makes untrusted imports strictly testable, and prevents subtitles that only exist in the page DOM or disappear from final frames.

**Boundary:** LRC must already contain timestamps. The first beat editor offers three deterministic densities, not a multi-track NLE. Browser builds download the spec; only the trusted desktop bridge can show a native save dialog and enqueue local encoding.

## 2026-07-23 — Queue local renders serially

**Decision:** Provide a dedicated desktop Creator window and a one-at-a-time render queue with explicit queued/running/completed/failed/cancelled states.

**Why:** Particle rendering and H.264/ProRes encoding are resource-heavy; serial work is predictable and makes cancellation, progress, and error recovery understandable. A native save dialog prevents renderer code from selecting arbitrary output paths.

**Boundary:** Queue history is memory-only and is not resumed after restart. Parallel rendering, task reordering, cloud rendering, and packaged render-worker validation are future release work.

## 2026-07-22 — Make an automatic music visual the primary product result

**Decision:** Lead with a four-step local workflow — upload music, choose a direction template and aspect, generate/preview an editable Scene Studio timeline, then export the project or render it with the desktop CLI. Keep the former visualizer and research surfaces as the advanced workspace.

**Why:** More particle controls do not create a complete user outcome. A directed timeline gives musicians and social creators something they can preview, revise, move between devices, and turn into a deliverable video without starting from a blank scene.

**Boundary:** The first version uses lightweight deterministic audio features and three authored templates, not semantic music understanding. Web export is validated project JSON; H.264/ProRes encoding uses the desktop Canvas exporter. Lyrics, captions, manual beat editing, a GUI render queue, and additive WebGPU video export remain future work.

## 2026-07-22 — Bridge the existing 3D modal state instead of inventing a separate GPU scene

**Decision:** Drive the additive WebGPU layer from two stable dominant CPU modes, their signed relative weights, the three-axis excitation point, and the current row-major rotation/zoom camera. Reuse the established cyclic three-term `phi3` and its analytic gradient in WGSL.

**Why:** A self-contained GPU particle demo can look dense while drifting away from the product. A small versioned uniform bridge makes drag rotation, automatic motion and modal changes visibly coherent without uploading or reading back CPU particle arrays.

**Boundary:** WebGPU remains an additive 64K/128K layer. It mirrors sphere and convex shape confinement plus style-specific forces, while Canvas still owns the complete four-style result, data/audio behavior and deterministic/native export paths; those paths remain locked to Canvas.

## 2026-07-22 — Add WebGPU as a verified enhancement before replacing Canvas physics

**Decision:** Run a real WebGPU Compute/render particle layer transparently above the existing Canvas result in compatible Web browsers. Keep Canvas drawing the complete four-mode product and lock deterministic/native paths to Canvas.

**Why:** This delivers visibly denser GPU-computed motion now while preserving the mature CPU field behavior, audio/data paths, exports, and established visual baseline. It also exercises device, pipeline, resize, submit, and loss handling before a much riskier physics migration.

**Boundary:** “WebGPU active” requires a successful `queue.submit()` frame. Capability recommendations are never actual runtime state. The current GPU field is an additive resonance enhancement, not a claim that the full legacy 3D physics or macOS Metal implementation has moved to WGSL.

## 2026-07-21 — Ship plate physics before exposing expert solver controls

**Decision:** Put the real rectangular thin-plate model behind a focused interaction: excitation point, drive frequency, next resonance, and map to 3D. Keep material geometry, boundary approximation, damping, and mode-count APIs in the core rather than crowding the first product surface.

**Why:** The smaller interface teaches the cause-and-effect loop immediately and remains usable on phones, while the validated core preserves a stable route to advanced experiments and saved recipes.

**Boundary:** The default model is a simply-supported 420 × 320 × 0.38 mm steel plate. `clamped-approx` is an approximation, not an exact 2D clamped-plate solver. Arbitrary geometry and exact boundary solutions require FEM or an equivalent numerical backend.

## 2026-07-21 — Capability detection is not backend activation

**Decision:** Add a renderer capability/status layer before implementing WebGPU compute particles, while continuing to report Canvas 2D as the active backend.

**Why:** Capability detection, preference, fallback, and device-loss state form a testable boundary for the next renderer and prevent silent failure on unsupported devices.

**Boundary:** A WebGPU-ready label means the browser can support the planned backend; it does not mean GPU particles are already rendering. The future backend must keep Canvas fallback and visual-parity tests.

## 2026-07-21 — Build reproducible scenes before replacing the renderer

**Decision:** Add the versioned Scene Studio, timeline, and project import/export before implementing a WebGPU renderer.

**Why:** A faster renderer improves an individual frame, while a scene/project model lets users retain, compare, present, and exchange complete outcomes. It also becomes the stable state contract shared by future Canvas, WebGPU, Electron, and export paths.

**Boundary:** WebGPU will be progressive enhancement with capability detection and device-loss fallback. The current four Canvas styles remain supported and testable.

## 2026-07-21 — Treat plate physics and modal volume as separate engines

**Decision:** Keep the existing 3D modal-volume field as the default immersive mode and add physically grounded thin-plate Chladni behavior as a distinct Plate Lab later.

**Why:** The two effects solve different product jobs and use different mathematics. Separating them preserves the strongest existing visual while allowing honest scientific explanations and arbitrary-shape FEM assets.

**Boundary:** Do not market the current 3D volume as a precise thin-plate solver. Experimental or approximate models must be labeled in the UI and project recipe.

## 2026-07-20 — Use an independent product brand while preserving legal provenance

**Decision:** Ship the derivative product as Signal Field, with new display names, bundle IDs, release artifact names, and original app icon.

**Why:** Apache-2.0 permits modification and redistribution, while upstream trademarks and non-code assets are not a reusable product identity.

**Boundary:** Keep `LICENSE`, `UPSTREAM_NOTICE.md`, `ASSET_LICENSE.md`, and `THIRD_PARTY_NOTICES.md`; do not claim the inherited implementation was independently originated. Public-facing product copy may describe Signal Field's own capabilities without using upstream branding.

## 2026-07-20 — Do not reuse inherited promotional media

**Decision:** Remove the inherited `media/` directory from Signal Field and retain only its licensing record.

**Why:** The files carry CC BY-NC 4.0 terms and are associated with the upstream product. New screenshots, GIFs, video, store art, and social previews must be captured from the Signal Field build and logged with their source/license.

**Follow-up:** Do not re-add excluded inherited media without explicit permission and a distribution review. Do not delete license or attribution records merely because the files are not included.

## 2026-07-20 — Replace the built-in demo track with a generated signal

**Decision:** Remove the Pixabay track and use a code-generated, non-audible demo signal for Dynamic-mode previews.

**Why:** It keeps the Web demonstration runnable without carrying a third-party audio distribution obligation.

**Follow-up:** Any future audio bundled with a release must have an explicit, documented license.

## 2026-07-20 — Make data and focused work first-class use cases

**Decision:** Build data-field, anomaly replay, focus scenes, and resonance-lab concepts on top of the retained visual engine.

**Why:** These workflows provide recurring utility beyond passive music visualization and create a distinct product story.

**Trade-off:** New behavior must stay local-first, explain how values map to visual parameters, and preserve the audio and export paths users already have.
