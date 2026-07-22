# Signal Field contributor guidance

- Keep `app/index.html` as the shared Web/Electron visual source; do not create a second renderer in the public shell.
- Preserve the four Canvas styles as the compatibility and deterministic-export baseline. WebGPU features must remain progressive enhancements with immediate Canvas fallback.
- Keep `LICENSE`, `UPSTREAM_NOTICE.md`, `MODIFICATIONS.md`, `ASSET_LICENSE.md`, and `THIRD_PARTY_NOTICES.md` in public source and release artifacts. Modified inherited files need a clear modification notice.
- Do not add secrets, signing credentials, private media, generated builds, `node_modules`, Playwright output, or local mirror configuration to Git.
- Prefer dependency-free modules and small changes. Validate all public bridge/import data before it reaches rendering or persistence code.
- For UI changes, verify 390px mobile layout, keyboard focus, reduced motion, empty/error states, and horizontal overflow.
- Before a public push, run `npm run check`, `npm run verify:pages`, `npm run verify:web-audio`, `npm run smoke`, and `npm run verify:mac-parity`.
- `verify:mac-parity` compares deterministic Electron Canvas surfaces; it does not establish parity with the separate native Swift/Metal screen saver.
