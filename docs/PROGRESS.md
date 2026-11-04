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

## 2026-11-01 — Cross-origin isolation for the WASM voice + Google sign-in page

- App pages are served with `COOP: same-origin` + `COEP: credentialless` (vercel.json, Vite plugin for dev/preview);
  `/google.html` is excluded and now hosts Google sign-in + Picker (popup, BroadcastChannel back to the app).
- Voice worker sets ORT `numThreads = min(4, cores − 1)` when isolated; `?debug=1` shows `isolated: yes · threads: N`.
- Prefetch depth 3 → 8 while the page is hidden (screen locked).

RTF, headless Chromium, WASM q8, no GPU, 4 cores (shared with other jobs, so ±0.3 noise), app worker path,
`npm run bench:browser` (6 sentences, average of the player's per-sentence RTF):

| config | run 1 | run 2 |
|---|---|---|
| before (no isolation, 1 thread; measured on the old build) | 3.26 | — |
| not isolated, 1 thread (`LUMEN_NO_COI=1 npm run preview`) | 3.28 | 3.32 |
| isolated, 2 threads | 2.42 | 2.39 |
| **isolated, 3 threads (default on 4 cores)** | **2.14** | **2.20** |
| isolated, 4 threads | 2.75 | 1.93 |

→ about **−34 %** RTF on this machine (3.3 → 2.2). 4 threads on 4 cores is best when the machine is idle but worst
under load (UI/audio compete), hence `cores − 1`. Still RTF > 1 here, so no-GPU playback in this container is not
gapless; WebGPU stays the fast path and phone numbers still need measuring on a device.

Verified under COEP (Playwright): model + voice downloads from huggingface.co and the ORT runtime from jsDelivr,
pdf.js worker (same-origin; PDF e2e tests run isolated), Drive REST (`fetch` with Bearer → readable 401 from googleapis.com, so CORS works),
token revoke (`no-cors`). New e2e `google.spec.ts` (Google scripts + Drive API stubbed): app isolated / sign-in page not,
connect via popup, GIS popup handle alive on the sign-in page but severed from the app page, Drive import via Picker,
closing the window cancels. `npm run check`: 40 unit tests; `npx playwright test`: 27 passed.

Needs a human: real Google sign-in + Picker + sync through `/google.html` on desktop Chrome and Android Chrome
(popup → tab behaviour, window closing itself, returning to the app), the Vercel headers on the deployed site
(`crossOriginIsolated` in DevTools), and phone RTF with threads.

## 2026-11-02 — First real-phone numbers (user's Android phone, Chrome, installed PWA)
- Kokoro on GPU (WebGPU fp32): hung; no sentence finished, and the phone lagged. Auto fallback added.
- Kokoro on processor (WASM q8, 4 threads, cross-origin isolated): RTF 8.7, unusable.
- Piper `en_US-lessac-medium` (WASM, 4 threads): **RTF 0.42**, plays smoothly at 1x; should hold up to ~2x.

## 2026-11-02 — Cleanup (steps 1–5) + folder restructure
| | Before | After |
|---|---|---|
| Built app (dist) | 40 MB | 5.5 MB |
| Main JS bundle | 546 KB | 446 KB |
| Voice runtime downloads (Kokoro + Piper used) | 2 different files | 1 shared file |
| Largest file | session.ts 350 / sheets.tsx 415 / ReaderScreen 389 | player.ts 465 (grouped); ReaderScreen 181; SettingsScreen 27 |
| Unit tests | 67 | 98 |
| E2E tests | 29 | 29 |
Source grew from ~7.6k to ~8.2k lines: duplication removed, but splitting into small modules adds imports,
interfaces and comments. Bug fixed on the way: saved sentence audio wasn't labelled per voice (switching voices could
replay the other voice). Real-voice checks (Piper, Kokoro CPU, Auto -> Piper) pass after every step.

## 2026-11-03 — Google Drive switched on (deployed site)
The production site at https://speechify-roveec.vercel.app now has a Google Cloud project ("Lumen", Testing mode)
with the Drive + Picker APIs, a web OAuth client limited to that origin, and a Picker-only API key limited to
that site. The two public values are set as Vercel environment variables (`VITE_GOOGLE_CLIENT_ID`,
`VITE_GOOGLE_API_KEY`); nothing is stored in the repo.

## 2026-11-02 — Reader, dictionary and Android app
- Reading position follows where the eyes are, also without audio; kept across PDF mode and text-setting changes.
- Contents shows chapter progress and PDF page thumbnails; where-am-I line, chapter marks and scrub bubble; full-screen
  button; word chip replaces the Play from here / Jump to current pill (2026-11-03).
- Better PDFs: column reading order, footnotes / captions / tables skipped (toggleable); double-tap zoom, snap to
  pages, dark pages, page markers in Text mode.
- Look up: dictionary chooser in Settings, Android text-selection option. Android app (`android/`, Trusted Web Activity)
  with a native dictionary helper and ColorDict popup; Robolectric smoke tests. Now v1.0.4; without the app, Look up
  shows a "Get the Lumen app" page (2026-11-03).

## 2026-11-03 — Voice quality, Prepare, prepared audio through Drive
- Natural voice on the GPU uses the WebGPU-fixed Kokoro model by default: the user confirmed clear audio on the
  RX 9060 XT (RTF 0.125; stock model RTF 0.087 but muffled). The Natural voice always tries the GPU first.
- Prepare chapters ahead from Contents; cached audio stored as Ogg Opus (0.176 MB per minute, ~1/16 of WAV).
- GPU usage slider and Turbo ×2/×3 workers while preparing.
- Prepared audio is uploaded to the Drive appDataFolder and downloaded on other devices (on Wi-Fi automatically).

Needs a human: Turbo on the PC (GPU use, memory, smooth playback during a run); prepared audio made on the PC
playing on the phone.

## 2026-11-04 — Books imported from a file reach other devices
The user's PDF imported from the PC's disk never appeared on the phone (only its prepared audio did): only books picked
from Google Drive had a file the phone could download. The file of such a book is now copied to the Drive
appDataFolder after a sync and listed on other devices under "On your other devices". `npm run check`: 172 unit tests
(6 new in `tests/unit/sync/bookCopies.test.ts`).

Needs a human: import a book from a file on the PC, then check that it appears on the phone and downloads.

## 2026-11-04 — Reader: no Continue offer on opening, play / pause in full screen
- Opening a book no longer shows "Continue from …?": it already opens at the saved place, and the highlight shows it.
  The offer still appears when newer progress arrives from another device.
- Full screen keeps a round play / pause button bottom right; the exit-full-screen button sits just above it.
- Long-press delay: with "Selecting text on phones: Android" the selection and menu are Android's own, so the page can't
  change their timing (phone setting: Accessibility → Touch & hold delay). Lumen's own selection triggers at 0.45 s.
