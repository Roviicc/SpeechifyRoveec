# Decisions

**2026-11-01 — Own EPUB parser instead of foliate-js/epub.js.** Both readers render into the app's own reflowed
DOM (one text node per block) so highlighting, tap-to-jump, search and auto-scroll share one code path with PDF
Text mode. Only parsing is needed, and a ~250-line JSZip + DOMParser parser (container → OPF → spine, nav/NCX TOC,
cover, footnote refs) is smaller, testable in Vitest, and avoids iframe plumbing.

**Rich EPUB display (DOC_VERSION 2).** Blocks keep plain `text` (what is read and indexed) plus `marks` (italic/bold/small caps/sup/sub/code ranges), structure flags (heading level, quote, list marker, `pre` line breaks, table `cells`) and `img` blocks (zip path + alt + intrinsic size, no text, no sentences). A block renders as several elements but its `textContent` always equals `text`; ReflowSurface maps offsets across the text nodes with a running sum. List markers are CSS `::before` and table-cell separators are hidden spans, so neither breaks the invariant. Images are unzipped lazily from the stored EPUB into object URLs (revoked on unmount) when near the viewport. `<br>` becomes "\n" (rendered with pre-line); capitalised lines become separate sentences.

**Highlighting uses the CSS Custom Highlight API** (Chrome 105+): no DOM mutation, cheap enough to update per frame.
PDF Original mode highlights the transparent pdf.js text-layer spans via a block→text-item span table.

**Sentence index, not a stream.** Each book is flattened into blocks → sentences (`Intl.Segmenter` + abbreviation /
"Chapter III." merging, max 400 chars). Progress stores a stable `{section, block, offset}` locator as well as the index,
so changing smart-skip or pronunciation settings (which re-index) doesn't lose the position.

**Book id = SHA-256 of the file** (first 96 bits), so the same book on two devices shares progress/bookmarks.

**Audio cache** key = `bookId:sentenceIndex` + hash of the spoken text (edits/dictionary changes invalidate);
16-bit WAV; LRU-capped at 500 MB. Kokoro output is silence-trimmed (60 ms lead / 120 ms tail pad) for tighter joins.

**Settings live in localStorage** (zustand persist) so the theme applies before first paint; they are part of `sync.json`.

**Drive token in localStorage with expiry.** GIS token client has no refresh token; non-interactive syncs only run with
a valid token, otherwise the Library shows a "tap to reconnect" chip (popups need a user gesture).

**~~No cross-origin isolation (COOP/COEP).~~ Superseded 2026-11-01 — see below.** Isolation lets onnxruntime-web use
WASM threads, but `COOP: same-origin` breaks the Google sign-in popup.

**2026-11-01 — Cross-origin isolation on, Google sign-in on a separate non-isolated page.** All pages except
`/google.html` get `COOP: same-origin` + `COEP: credentialless` (vercel.json; a Vite plugin for dev/preview), so the voice
worker is `crossOriginIsolated` and ORT uses up to 4 WASM threads (`min(4, cores − 1)`, leaving a core for UI/audio;
`?threads=N` overrides). `credentialless` rather than `require-corp` so huggingface.co / jsDelivr downloads need no CORP
header. Google Identity Services needs `window.opener` on its accounts.google.com popup (COOP severs it) and the Picker is
a docs.google.com iframe (COEP blocks it), so both run on `/google.html`, opened by the app as a popup. COOP also severs
*our* handle to that popup (the `WindowProxy` reads as closed), so the page talks back over a same-origin
**BroadcastChannel** (`hello` / `token` / `picked` / `error` / `closed` on `pagehide`), and the token goes to the shared
`localStorage` as before. Alternatives considered: an iframe (would itself need COEP and still be under the app's COOP — no
good); `COOP: same-origin-allow-popups` (does not give isolation); `Document-Isolation-Policy` (isolation without COOP, but
Chrome-desktop-only so far — worth revisiting, it would remove the extra window); OAuth redirect flow (needs redirect URIs
registered — more setup). Costs: one extra tap ("Continue with Google" — the GIS popup needs a user gesture on that page);
the Picker opens without it when a token is still valid. Drive REST calls are CORS fetches with a Bearer token and work under
COEP (verified: readable 401 from googleapis.com); token revoke is a `no-cors` POST. The sign-in page is excluded from the
service-worker precache/navigation fallback so it always comes from the network with its own headers. Browsers without
`credentialless` (Safari) simply aren't isolated and run single-threaded, sign-in still goes through the same page.

**Deeper prefetch while hidden.** Player prefetch depth is 3 sentences while visible and 8 while `document.visibilityState
=== 'hidden'` (session.ts), since Android may throttle a locked page; already generated audio is kept when it drops back.

**Fake voice** (`?tts=fake` / `VITE_TTS=fake`): silent WAV, 60 ms/char — e2e tests never download the model.

**2026-11-02 — Second voice: Piper (fast); Kokoro kept as the default "Natural" voice.** On the user's phone Kokoro measured
RTF 8.7 on WASM (its GPU hung), about 9x too slow. Piper `en_US-lessac-medium` (VITS, ~63 MB, via @mintplex-labs/piper-tts-web)
measured RTF 0.19 vs Kokoro 2.2 on the same headless machine (~11x faster). Settings -> Voice: Natural (Kokoro) / Fast (Piper);
the app suggests Piper when Kokoro can't keep up. Audio-cache hashes include the voice, so the two never mix.
Kokoro start-up now has time limits on every stage, with automatic fallback GPU -> threaded CPU -> single-thread CPU.

**2026-11-02 — Voice defaults to Auto.** On a new device Auto tries Kokoro once (its start-up speed test must reach
RTF <= 0.9) and otherwise switches to Piper and remembers it (`lumen-voice-auto-model`). If Kokoro passes but real playback
runs slower than real time (RTF x speed > 1.3 over 4+ sentences), Auto switches to Piper mid-book without losing the place.
Natural/Fast remain as fixed choices; picking Auto again re-tests the device. Cost: a slow device downloads Kokoro once
before falling back.
