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

**No cross-origin isolation (COOP/COEP).** Isolation lets onnxruntime-web use WASM threads: measured RTF 3.35 → 2.47
(-26%) in headless Chromium on 4 cores. But `COOP: same-origin` breaks the Google sign-in popup. WebGPU is the primary
fast path; revisit if a phone without WebGPU is too slow (options: host sign-in on a separate non-isolated page, or the
Capacitor + sherpa-onnx native backend from the plan).

**Fake voice** (`?tts=fake` / `VITE_TTS=fake`): silent WAV, 60 ms/char — e2e tests never download the model.
