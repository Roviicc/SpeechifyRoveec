# Progress

## 2026-11-01 — Phases 1–6 implemented

All six phases are built. Automated verification:
- `npm run check`: typecheck, lint, 37 unit tests (text pipeline, player with fake voice + fake timers,
  EPUB parser + PDF layout on fixtures, two-device sync with fake-indexeddb + FakeDrive, audio cache), production build.
- `npm run test:e2e`: 17 Playwright tests at Pixel 7 (412×915) and 1280×800 — voice test page, EPUB reading / TOC /
  "Jump to current" / themes / Aa, resume after reload, PDF Original + Text + smart skip + zoom, scanned-PDF error,
  library rename/delete/search/mini player, bookmarks + highlights + notes + search, dictionary + sleep timer, keyboard.
- Screenshots of every screen in light/dark/sepia were inspected.

Real voice:
- `npm run bench:tts` (Node, CPU, q8, 4 cores): load 2.2 s, avg RTF 0.675, p95 0.726.
- Headless Chromium, WASM q8 (no GPU), real worker path: model download → ready in ~20 s, avg RTF ≈ 3.4
  (≈ 2.5 with cross-origin isolation). Headless has no WebGPU — **phone/laptop WebGPU numbers still to be measured.**

Needs a human (not verifiable here): Android speed/smoothness at 1–2×, background playback with screen locked,
lock-screen controls, how voice + highlight feel, real Google sign-in/Picker/sync, PWA install.
