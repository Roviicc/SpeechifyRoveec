# Lumen — a personal read‑aloud PWA

Lumen reads your **EPUB** and **text‑based PDF** books aloud with a natural on‑device voice
(Kokoro‑82M, voice `af_heart`), highlighting the current sentence and word as it goes.
It runs entirely in the browser — no backend, no account. Optional Google Drive integration
imports books and syncs reading progress, bookmarks, highlights and settings between devices.

Works in desktop Chrome and Android Chrome, and installs to the Android home screen.

- **Voice:** `kokoro-js` in a Web Worker. WebGPU + fp32 when available, otherwise WASM + q8
  (multi-threaded: the app is served cross-origin isolated, see *Cross-origin isolation* below).
  The model (~90 MB q8 / ~330 MB fp32) downloads once on first play and is cached by the browser.
- **Readers:** EPUB (reflowed text) and PDF (Original pages with pdf.js text layer, or reflowed Text mode).
- **Storage:** IndexedDB (Dexie): books, extracted text, progress, bookmarks, highlights, audio cache (500 MB LRU).
- **Sync:** one `sync.json` in your Drive's hidden *appDataFolder* (per‑record last‑write‑wins, deletes as tombstones).

---

## Run locally

Requires Node 20+ (tested on Node 22).

```bash
npm install
cp .env.example .env        # optional: fill in Google values (see below) — the app works without them
npm run dev                 # http://localhost:5173
```

Useful URLs:

| URL | What |
|---|---|
| `/#/tts` (or Settings → *Voice test page*) | Paste text, play, tap words, change speed |
| `?debug=1` | Overlay with device (webgpu/wasm), dtype, cross‑origin isolation + WASM thread count, and real‑time factor (RTF) |
| `?threads=N` | Override the voice's WASM thread count (benchmarking; only effective when isolated) |
| `?tts=fake` | Instant silent "fake" voice (no model download) — used by tests. `?tts=real` switches back |

Scripts:

```bash
npm run check        # typecheck + lint + unit tests + production build
npm run test         # unit tests (Vitest)
npm run test:e2e     # Playwright end-to-end tests (phone + desktop, fake voice)
npm run bench:tts    # real Kokoro benchmark in Node (CPU): load time + RTF per sentence
npm run bench:browser # real Kokoro in headless Chromium via the app's worker (needs `npm run preview` running)
npm run fixtures     # regenerate tests/fixtures (sample EPUB, PDF with headers/citations, scanned PDF)
npm run icons        # regenerate PWA icons from public/favicon.svg
```

**RTF** = generation time ÷ audio length. Playback is gapless when RTF < 1 ÷ speed
(e.g. below 0.5 for 2× listening). Check it on your phone with `?debug=1` on the Voice test page.

To test on your Android phone during development: `npm run dev -- --host`, then open the shown
network URL. WebGPU, service workers and installing need **HTTPS** (or `localhost`), so for a real phone
test, deploy (below) or use Chrome's port forwarding (`chrome://inspect` → Port forwarding → `5173`).

---

## Google Cloud setup (Drive import + sync)

You need one Google Cloud project with an **OAuth client ID** (for sign‑in) and an **API key** (for the Picker).

1. **Create a project** — <https://console.cloud.google.com/> → project picker → *New project* (e.g. "Lumen").
   Note the **project number** (Dashboard → *Project info*); the Picker needs it as the "app ID".
2. **Enable APIs** — *APIs & Services → Library*: enable **Google Drive API** and **Google Picker API**.
3. **OAuth consent screen** — *APIs & Services → OAuth consent screen* (or *Google Auth Platform → Branding/Audience*):
   - User type: **External**. App name "Lumen", your email as support + developer contact.
   - **Data access / Scopes**: add
     `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/drive.appdata`.
   - **Audience / Publishing status: Testing.** Under **Test users**, add your own Google account.
     (In Testing mode only listed test users can sign in; no Google verification is needed. Note that
     Google may ask you to re-consent every 7 days in Testing mode.)
4. **OAuth client ID** — *APIs & Services → Credentials → Create credentials → OAuth client ID*:
   - Application type: **Web application**.
   - **Authorized JavaScript origins** (no paths, no trailing slash):
     - `http://localhost:5173` (dev) and `http://localhost:4173` (`npm run preview`)
     - your deployed URL, e.g. `https://lumen-yourname.vercel.app`
   - Redirect URIs: none needed (the token client uses a popup).
   - Nothing extra is needed for the sign-in page `/google.html` (below): it is on the same origin, so the
     authorized JavaScript origins above stay exactly the same.
   - Copy the **Client ID** → `VITE_GOOGLE_CLIENT_ID`.
5. **API key** — *Credentials → Create credentials → API key*, then *Edit API key*:
   - **Application restrictions:** *Websites* → add `http://localhost:5173/*`, `http://localhost:4173/*`
     and `https://lumen-yourname.vercel.app/*`.
   - **API restrictions:** *Restrict key* → select only **Google Picker API**.
   - Copy the key → `VITE_GOOGLE_API_KEY`.
6. Put both in `.env` (and in Vercel, see below):
   ```
   VITE_GOOGLE_CLIENT_ID=123456789012-abc...apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=AIza...
   # optional; defaults to the numeric prefix of the client ID, which is the project number
   # VITE_GOOGLE_APP_ID=123456789012
   ```

How it's used:
- **Sign-in window.** Because the app is cross-origin isolated (next section), Google's sign-in popup and the Picker
  can't run inside it. Connecting Drive or choosing *Import → Google Drive* opens a small Lumen window
  (`/google.html`, served *without* isolation headers). Tap **Continue with Google** there (the Google consent popup
  needs a tap on that page); the Picker opens directly when you're already signed in. The window hands the token /
  chosen files back to the app and closes itself. Allow pop‑ups for the site if the browser blocks it.
- **`drive.file`** — the Google Picker lets you choose EPUB/PDF files; the app can then download only those files.
  Books imported from Drive appear on your other devices under *On your other devices* (tap to download).
- **`drive.appdata`** — a hidden, app‑private `sync.json` holding progress, bookmarks, highlights and settings.
  Sync runs when the app opens, on pause, every 60 s while playing, and when the app goes to the background.
- The access token lasts ~1 hour and is kept in `localStorage`. When it expires the Library shows
  *"Sync is paused. Tap to reconnect"* — tapping re-authorizes with a quick popup (no password prompt).

---

## Deploy to Vercel

1. Push this repo to GitHub, then on <https://vercel.com/new> import it. Framework preset: **Vite**
   (build `npm run build`, output `dist` — detected automatically).
2. *Settings → Environment Variables*: add `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY`
   (they are baked in at build time, so **redeploy** after changing them).
3. Add the Vercel URL to the OAuth client's **Authorized JavaScript origins** and to the API key's
   website restrictions (steps 4–5 above).
4. On your Android phone, open the URL in Chrome → menu → **Install app** (or *Add to Home screen*).

`vercel.json` sets caching headers so the service worker updates promptly, and the cross-origin isolation headers.

### Cross-origin isolation

Every page except `/google.html` is served with

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

(`vercel.json` in production; a small plugin in `vite.config.ts` does the same for `npm run dev` and `npm run preview`).
This makes the app `crossOriginIsolated`, which gives onnxruntime-web `SharedArrayBuffer` and therefore WASM threads:
the no-GPU voice path is noticeably faster (see `docs/PROGRESS.md`). `credentialless` lets cross-origin downloads
(the model from huggingface.co, the ONNX runtime from jsDelivr) keep working without those servers opting in.
The Google sign-in page is excluded because `COOP: same-origin` breaks Google's popup and COEP blocks the Picker iframe.
If you host elsewhere, copy both rules (and keep `/google.html` out of them). `?debug=1` shows `isolated: yes · threads: N`.

---

## Using the app

- **Library:** `+` imports from **Files** or **Google Drive**. `•••` on a row → Rename / Delete.
- **Reader:** tap any word to read from there. Long‑press/select text → highlight (4 colours), add a note, or play from there.
  Top bar: `Aa` (font size, font, line spacing, margins, theme), bookmark, Original/Text (PDF), `•••` (Search, Notes & Bookmarks, Sleep timer).
  Bottom‑left button: table of contents. Scroll away while playing → **Jump to current**.
- **Player:** seek bar with elapsed / remaining time, previous/next sentence (`«` `»`), previous/next chapter (or page for PDFs),
  speed `1×` button (0.5–3.0× slider + presets). Speed changes are instant (no re‑generation).
- **Keyboard (desktop):** `Space` play/pause · `←/→` sentence · `Shift+←/→` chapter · `+`/`-` speed · `Esc` closes panels.
- **Settings:** theme, highlight toggles, auto‑scroll, smart‑skip toggles (headers/footers, page numbers, citations,
  footnote markers, URLs → "link"), pronunciation dictionary, Google Drive, clear audio cache.
- **Lock screen:** title/chapter, play/pause and next/previous sentence via the Media Session API.
  While the app is hidden (screen locked / in the background) it generates 8 sentences ahead instead of 3,
  so playback survives the browser throttling the page for a while.

Limitations: scanned (image‑only) PDFs aren't supported (no OCR); word highlighting is *estimated* from each
word's share of the sentence and can drift slightly on long or number‑heavy sentences.

## Project layout

```
src/
  app/        App shell, hash router, playback session, Media Session
  engine/
    text/     sentence splitter, smart skip, pronunciation, spoken text + word timing (pure, unit-tested)
    doc/      EPUB parser, PDF extraction + layout (lines, headers/footers, paragraphs), book index
    tts/      TtsBackend interface, Kokoro worker backend, fake backend, Player (prefetch, cache, speed)
  data/       Dexie DB, repositories, audio cache
  sync/       Google sign-in client (via /google.html), Drive client, FakeDrive, merge + sync
  google/     the non-isolated sign-in page (Google Identity Services + Picker), entry of google.html
  features/   library, import, reader (views, highlighter, auto-scroll, sheets), settings, voice test
  ui/         shared components (Sheet, controls, toasts)
docs/         PLAN.md, PROGRESS.md, DECISIONS.md
tests/        unit/ (Vitest), e2e/ (Playwright), fixtures/
```
