# Signal Field contributor guidance

- Keep `app/index.html` as the shared Web/Electron visual source; do not create a second renderer in the public shell.
- Keep Music Video Director as the primary Web flow: local audio analysis must produce a validated Scene Studio project, and preview time must follow the selected audio clock rather than wall-clock time.
- Keep titles, timestamped lyrics, beat edits, aspect, and output settings inside canonical `signal-field-production/v1`; do not add those fields to the strict Scene Studio project schema or store them only in DOM state.
- Browser preview and deterministic video export must use the shared `app/production-overlay.js` compositor so title/lyric timing and safe areas stay aligned.
- Keep waveform peaks transient and bounded; raw PCM, peaks, editor IDs, zoom, scroll, and absolute audio paths must never enter the Production Spec. Manual lyric and beat moves must update canonical `lyrics` / `beatEdits` and must not be overwritten by unrelated title or density UI changes.
- The waveform editor and `#sceneTimeline` share one current audio time. Do not introduce a second playback clock; only the timeline viewport may scroll horizontally on mobile.
- Desktop render requests must pass through the allowlisted render queue and native save dialog. Never expose arbitrary commands, shell strings, or an unvalidated output path to renderer code.
- Describe export boundaries honestly: the Web app exports an editable project, while encoded H.264/ProRes video is produced by the desktop CLI. Do not imply that the deterministic Canvas exporter includes the additive WebGPU layer.
- Preserve the four Canvas styles as the compatibility and deterministic-export baseline. WebGPU features must remain progressive enhancements with immediate Canvas fallback.
- Keep `LICENSE`, `UPSTREAM_NOTICE.md`, `MODIFICATIONS.md`, `ASSET_LICENSE.md`, and `THIRD_PARTY_NOTICES.md` in public source and release artifacts. Modified inherited files need a clear modification notice.
- Do not add secrets, signing credentials, private media, generated builds, `node_modules`, Playwright output, or local mirror configuration to Git.
- Prefer dependency-free modules and small changes. Validate all public bridge/import data before it reaches rendering or persistence code.
- For UI changes, verify 390px mobile layout, keyboard focus, reduced motion, empty/error states, and horizontal overflow.
- Before a public push, run `npm run check`, `npm run verify:pages`, `npm run verify:web-audio`, `npm run smoke`, and `npm run verify:mac-parity`.
- When FFmpeg is available, also run `npm run verify:video-export-smoke` after changing production specs, overlays, queueing, or export code.
- `verify:mac-parity` compares deterministic Electron Canvas surfaces; it does not establish parity with the separate native Swift/Metal screen saver.
