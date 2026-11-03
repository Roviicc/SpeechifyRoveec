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

**2026-11-02 — Cleanup + folder structure.** Folders are named for what they do: `session/` (playback session split into
small modules), `engine/{text,book,voice}` (pure logic), `state/` (stores), `sync/drive` + `sync/signin-page`, and
`features/reader/{views,highlight,player,sheets,hooks}`. Imports use the `@/` alias. ESLint `no-restricted-imports`
keeps `engine/` free of React/app layers and `data/` + `sync/` free of screens. Unit tests mirror `src/`.
Kokoro and Piper share one worker client (`voice/shared/workerVoiceClient.ts`) and one worker loop (`serveVoice.ts`).
Build: the onnxruntime `.wasm` copies Vite emits are dropped (both voices load the runtime from the transformers.js CDN
dist, the same file for both), saving 36 MB.

**2026-11-02 — Voice downloads + Look up.** The app now checks what is really stored (Kokoro: Cache Storage
'transformers-cache' + 'kokoro-voices'; Piper: OPFS folder 'piper') via `engine/voice/install.ts`. Loading a stored voice
after a restart shows "Loading the … voice", never "Downloading"; a stored voice is preloaded when a book opens.
First-time downloads ask first (Google Lens-style sheet: size, offline afterwards, free space, mobile-data warning).
Settings → Voice is a list (Auto / Natural / Fast) with per-voice status (download / progress ring / On device) and
Remove. "Look up" in the selection toolbar sends the word to the Android share picker (pick ColorDict, Translate…), or
experimentally straight to ColorDict via an `intent:` URL (`colordict.intent.action.SEARCH`); a browser-launched
intent may be refused by ColorDict, so the app says so and suggests the share picker.

**2026-11-02 — Reading position = where the eyes are (Step 1 of the reading plan).** `features/reader/highlight/viewAnchor.ts`
tracks the text on the reading line (25% down, the same line auto-scroll uses, so save/restore never drifts) as
`{block, offset, dy, kind: text|block|page}`. Without audio, a hand scroll is saved (1.2 s after it stops) via
`session.saveViewPosition`; it wins over the voice position until the voice moves again. Layout changes (PDF
Original <-> Text, font size, line spacing, margins, font) restore the anchor at its old height. After opening, a short
settle loop (<= 1.5 s, every frame) re-pins the place while long chapters finish laying out, and stops the moment the
page is moved by anything else (scrollTop changed) or by the reader. The browser's own scroll anchoring is turned off on
the reader (`overflow-anchor: none`) because it moved the page behind the settle loop's back. Caret hits are only
accepted when the text is really on the line (`caretPositionFromPoint` snaps across paragraph gaps). "Play from here"
reads the line at tap time.

**2026-11-02 — Better PDFs, UI half (Step 3).** *Double tap* (Original mode) zooms in: to fit the tapped paragraph
(column) to the screen width when that is at least 1.15x, else to 2x centred on the tap; double tap while zoomed returns
to fit-width with the tapped spot kept under the finger. A single tap still jumps, but in Original mode the jump waits
out a 250 ms double-tap window (`hooks/useTapOrDoubleTap.ts`); what the tap points at is read at tap time
(`useReaderSync.tapPoint`), only `playFrom` is delayed. EPUB / Text mode taps stay immediate. *Snap to pages* (off by
default) is done in JS, not CSS `scroll-snap`: only after the reader's own scroll (wheel / touch / keys, on `scrollend`)
and only when a page top is within 30% of the screen; CSS snap would also snap auto-scroll's and anchor-restore's
programmatic `scrollTo`, pulling the voice's sentence off the reading line. *Dark pages* (default on, only has an effect
in the dark theme) applies `filter: invert(0.88) hue-rotate(180deg)` to the canvases only; the text layer with the
CSS highlights sits above, unfiltered. *Text-mode page markers* ("— page N —") are `aria-hidden` divs between blocks
whose label is CSS generated content (`::before { content: attr(data-label) }`): no DOM text, so nothing is read,
selected, hit by `caretPositionFromPoint`, or mixed into the `[data-b]` offset mapping and the position anchor.
**Better PDFs: columns and junk (PDF_DOC_VERSION 3).** Pages are reordered column by column only when a clear gutter exists: a strip in the middle 20–80% of the text width, ≥ 0.6 × body height wide, crossed by ≤ 30% of lines, with ≥ 6 lines on each side whose median length is ≥ 6 × body height and ≥ 0.6 × the side's longest lines (rules out tables), and a common left edge for the right side. Lines that the content stream merged across the gutter are split by their item boxes (spans stay exact); lines that span the gutter (title, abstract, full-width figures, footnotes) cut the page into bands read top to bottom, columns left then right inside each band (recursive, so three columns work). Pages without a gutter keep content-stream order, the same blocks as before (only the new skip marks can differ). New block skips, all toggleable in Settings → Smart skip and on by default: `footnote` (lines ≤ 0.88 × body height, below every body-size line of their column, top line starting with a note marker `1`/`*`/`†`…, ≤ 40% of the page), `table` (≥ 3 consecutive rows that are ≥ 60% numbers or ≥ 3 short cells split by gaps ≥ 1.5 × line height) and `caption` (a paragraph ≤ 160 chars starting "Figure 3." / "Fig. 2:" / "Table 1" / "TABLE IV —"; "Figure 3 shows…" is read). Skip settings saved before these keys existed count as on. PDFs have their own parser version so EPUBs are not re-parsed; on opening a stale PDF the saved position, bookmarks and highlights are moved to the new block numbering by finding the surrounding text on the same page (highlights by their text), falling back to the page start; their `updatedAt` moves by 1 ms so they beat their own synced copy but not real edits from another device.

## Kokoro on WebGPU sounds muffled on AMD: test the ConvTranspose-patched model
On the user's RX 9060 XT (D3D12/WebGPU) Kokoro fp32 runs at RTF 0.087 but sounds muffled; the same text on the
processor (WASM fp32, 10 threads, RTF 0.585) is clear. onnxruntime-web's WebGPU `ConvTranspose` is known to compute the
vocoder's upsampling layers wrongly on AMD. `DevAmarnadhCG/Kokoro-82M-v1.0-ONNX-webgpu` rewrites those layers as
zero-insertion + Conv (identical on CPU; its fix script is small and readable). It is pinned to commit 7d1a298 via `env.remotePathTemplate` (kokoro-js doesn't forward `revision`). The user confirmed it sounds clear on the RX 9060 XT (RTF 0.125), so it is now the GPU
default; `?kgpu=stock` loads the original for comparison. `?kdtype=fp32` runs the processor voice at full precision for comparison.
**2026-11-03 — Prepare chapters (generate audio ahead) + compressed audio cache.** Contents gets "Prepare all" and a
per-chapter Prepare button (ring while running/queued, tap to cancel; primary check when every readable sentence has
audio for the current voice). `session/preparer.ts` is a session-level queue (one range at a time, survives leaving the
reader, Library rows say "Preparing 34%", the where-bar shows a small ring). It writes into the *same* cache rows the
player reads: key `audioKey(bookId, sentenceIndex)` = `bookId:index`, row `hash` = `audioHash(voice, spokenText)`
(both exported from `data/audioCache.ts`; together they identify a sentence's audio, e.g. for a later Drive export).
Smart-skipped text is never a sentence, so it is never generated. **Priority:** the session's backend is a
`PriorityBackend`; the player calls `generate()` as before, the preparer `generateBackground()`, which runs one sentence
at a time and only when no player request is in flight or pending (`player.generating`, which also covers the cache read
before a generate), so playback waits at most for the one background sentence already in the engine. Background
requests use epoch `Number.MAX_SAFE_INTEGER`, so a seek's `cancel(epoch)` never drops them. **Eviction:** prepared rows carry
`prepared: 1`; the 500 MB LRU skips (and doesn't count) them, a later player write of the same sentence keeps the mark,
"Clear audio cache" keeps them; they go with the book or via Settings → Storage → Prepared audio → Delete. Before every
20 sentences the preparer checks a 4 GB own cap and `navigator.storage.estimate()` (>= 200 MB free, < 95% used) and
stops with "Storage is full" (also on QuotaExceededError); `navigator.storage.persist()` is requested on the first
Prepare. **Compression:** all cached audio (played and prepared) is stored as Ogg Opus, 24 kbit/s mono, encoded with
WebCodecs `AudioEncoder` and our own small Ogg muxer (`engine/voice/player/ogg.ts`, pre-skip from the encoder's
OpusHead, last granule trims the end padding to the exact PCM length). Measured in Chromium: 0.176 MB per minute (WAV 24
kHz: ~2.9 MB/min), so the 9.4 h book is ~100 MB. `<audio>` and `decodeAudioData` both play it with the exact duration
(e2e). The duration stored with the row is the original PCM duration (word timing). The player keeps playing the fresh
WAV from memory and the compression runs in the store's background write, so start latency is unchanged. Where
`AudioEncoder`/Opus is missing (or not a secure context) the WAV is stored. **Preparing speed** (Settings → Storage,
device-local): Full / Balanced / Light rest 0 / 0.4x / 1.5x of each sentence's synthesis time; live playback is never
throttled. Not done: a second parallel Kokoro worker for WebGPU (it would load the model twice; left as a follow-up).
Changing smart-skip/pronunciation mid-run makes the rest of that run write rows the new index won't match (harmless, the
row is simply regenerated when played).
