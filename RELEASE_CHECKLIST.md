# Release Checklist

> **Modification notice:** This inherited release document was modified by Signal Field contributors; see `LICENSE`, `UPSTREAM_NOTICE.md`, and `MODIFICATIONS.md`.

## Repository

- [ ] Create the GitHub repository and add it as `origin`.
- [x] Retain `LICENSE`, `UPSTREAM_NOTICE.md`, `MODIFICATIONS.md`, `ASSET_LICENSE.md`, and `THIRD_PARTY_NOTICES.md` in the repository and distributable artifacts.
- [x] Maintain `MODIFICATIONS.md` as the explicit “modified by Signal Field contributors” record for every inherited source file changed from upstream; keep the notice headers in core runtime files.
- [ ] Confirm the product name, repository description, topics, package IDs, and social preview image all use **Signal Field**.
- [ ] Confirm `desktop/assets/signal-field-icon.*` is the only app icon referenced by packaging; do not ship upstream icons under the Signal Field brand.
- [ ] Verify that no private certificates, signing identities, local profiles, or build output are tracked.

## Audio And Media

- [x] Retain the historical third-party music notice in `THIRD_PARTY_NOTICES.md`; the original MP3 is excluded from Signal Field.
- [x] Remove inherited image/GIF/MP4 and standalone-preset files from the Signal Field release product; capture fresh Signal Field media before using a product page, store listing, social post, or release bundle.
- [ ] Review the source and license of every new release asset; do not reintroduce the upstream CC BY-NC media or presets without explicit permission and a distribution review.
- [x] Remove the prior third-party MP3. Confirm Dynamic-mode preview uses only the generated demo signal unless a separately licensed replacement is documented.

## GitHub Pages

- [ ] Push `main` and select **GitHub Actions** under **Settings → Pages → Source**.
- [ ] Confirm the `Deploy GitHub Pages` workflow succeeds.
- [ ] Open the project Pages URL and test Dynamic Sand and Dynamic Cosmic playback.
- [ ] Test the Chinese / English switch, fullscreen, random pattern, and mobile layout.

## Desktop

- [ ] Run `npm run smoke` and `npm run verify:mac-parity`.
- [ ] Build the macOS package and confirm the bundled app does not contain the Web demo MP3.
- [ ] Open the packaged Mac and Windows apps and verify their display name, About window, icon, installer name, screen saver name, and lock launcher name read “Signal Field”.
- [ ] Configure production signing and notarization before distributing installers.

## Windows Contributions

- [ ] Open a public tracking issue for Windows 10 / 11 compatibility work.
- [ ] Document the tested audio devices, display layouts, and DPI configurations.
- [ ] Require system-audio, multi-monitor, installer, and energy regression checks before calling the Windows app release-ready.
