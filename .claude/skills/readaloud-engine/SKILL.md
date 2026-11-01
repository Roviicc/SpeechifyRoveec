---
name: readaloud-engine
description: Use when working on the Speechify-lite (Lumen) app's engine - Kokoro TTS worker, text cleaning and sentence splitting, playback and speed, audio cache, Dexie data layer, Google Drive import and sync, and their tests.
---

# ReadAloud Engine (TTS, text, data, sync)

There is no backend server. The "backend" is Kokoro in a Web Worker, IndexedDB via Dexie, and the user's Google Drive. TypeScript strict throughout.

## TTS backends (`src/engine/voice/`)
Everything talks to a `TtsBackend` (types.ts): `init(onProgress)`, `generate(text, epoch) -> {wav, duration, genMs}`, `cancel(epoch)`.
- **KokoroBackend** (kokoro/backend.ts + kokoro/kokoro.worker.ts): `kokoro-js` with `onnx-community/Kokoro-82M-v1.0-ONNX`, voice fixed to `af_heart`
  (never expose a picker). `navigator.gpu` + adapter -> `webgpu`/`fp32`, else `wasm`/`q8`. Output is silence-trimmed and encoded as 16-bit WAV.
- **FakeTtsBackend**: instant, deterministic silent WAV, 60 ms per character (min 300 ms). Selected with `?tts=fake` or `VITE_TTS=fake`.
- A native backend (Capacitor + sherpa-onnx) can later drop in behind the same interface.

Worker protocol (shared/protocol.ts): in `init`, `generate {reqId, epoch, text}`, `cancel {epoch}`; out `progress`, `ready {info}`,
`audio {reqId, epoch, wav, duration, genMs}` (transfer the ArrayBuffer), `cancelled`, `error`.
**Epochs**: every seek increments the epoch; queued jobs from older epochs are dropped so tap-to-jump is instant.
`navigator.storage.persist()` is requested once the model is ready.

## Text pipeline (`src/engine/text/`, pure functions)
1. **Smart skip** (toggleable, default on): headers/footers (lines repeated in the top/bottom zone of 3+ PDF pages,
   pdfLayout.markRepeatedLines), standalone page numbers, `[12]`, `[3-5]`, `(Smith, 2020)`, footnote markers, URLs -> "link". Skipped text stays visible but unread.
2. **De-hyphenate** PDF line breaks and join wrapped lines (book/pdf/layout.ts linesToBlocks).
3. **Pronunciation dictionary**: whole-word, case-insensitive.
4. **Sentence split**: `Intl.Segmenter('en', {granularity: 'sentence'})` + abbreviation/initial/"Chapter III." merging; >400 chars split at `; : ,` then spaces. Offsets kept.
5. **Word timing**: `Intl.Segmenter` words, weighted by spoken characters + punctuation pauses; distribute duration -> `[{start,end,t0,t1}]`. Resets each sentence, so drift never accumulates.

## Playback (`voice/player/player.ts`)
- One HTMLAudioElement; a Blob URL per sentence; `playbackRate = speed`, `preservesPitch = true` (instant, no regeneration).
- Prefetch the next 3 sentences. Revoke Blob URLs. Events: `state`, `sentence`, `chunk`, `error`, `rtf`.
- Media Session (src/session/mediaSession.ts): metadata, play/pause/previoustrack/nexttrack (= sentence), positionState.
- Sleep timer: fade the volume out, then pause (session/sleepTimer.ts).
- **RTF** (generation ms / audio ms) rolling average, shown with `?debug=1`. Smooth playback needs RTF < 1/speed.

## Audio cache (src/data/audioCache.ts)
Key `bookId:sentenceIndex` + hash of the spoken text; `{blob, duration, bookId, lastUsed}`; LRU cap 500 MB; "Clear audio cache" in Settings.

## Dexie schema (`src/data/db.ts`)
```
books: id (sha-256 of file), title, author, type, source('local'|'drive'), driveFileId, size, addedAt, lastOpenedAt, cover, updatedAt
files: bookId, blob          content: bookId, version, doc (parsed BookDoc)
progress: bookId, sentence, locator, percent, sectionTitle, updatedAt
bookmarks: id, bookId, locator, label, createdAt, updatedAt, deleted
highlights: id, bookId, start, end, text, color, note, createdAt, updatedAt, deleted
audio: key, bookId, hash, blob, duration, size, lastUsed
settings: key, value, updatedAt
```
Locator = `{section, block, offset}`. Use the repositories (src/data/repo.ts). Save progress every few seconds while playing, on pause and on hide.

## Google Drive (`src/sync/`)
- GIS **token client**, scopes `drive.file drive.appdata` (sync/drive/google.ts). Token cached with expiry; non-interactive syncs never open popups.
- Import: Picker (EPUB + PDF mime types, setAppId = project number) -> `files.get?alt=media` -> Blob -> importBook, keep `driveFileId`.
- Sync: one `sync.json` in `appDataFolder` (books, progress, bookmarks, highlights, settings). Per-record last-write-wins on `updatedAt`;
  tombstones for deletes (sync/syncCore.ts, sync/merge.ts). Sync on open, pause, every 60 s while playing, and on hide.
- All Drive calls go through the `DriveClient` interface; **FakeDrive** (in-memory) is used in tests.
- Env: `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` (`.env.example` only, never commit secrets).

## Testing (must pass before reporting done)
- `npm run check` (typecheck, lint, unit tests, build).
- **Unit (Vitest)** for every `engine/text` function with tricky cases: "Dr. Smith", "3.14", "e.g.", ellipses, quotes,
  citations, hyphenation, repeated headers, very long sentences; word timings sum to duration and are monotonic.
- **Player** tests with FakeTtsBackend + fake timers: prefetch depth, sentence advance, seek bumps epoch, cached audio reused,
  speed change doesn't regenerate, sleep timer fades and pauses.
- **Data/sync** tests with `fake-indexeddb` + FakeDrive: two simulated devices, merge picks newest, tombstones delete on both, progress resumes at the same locator.
- **Benchmark**: `npm run bench:tts` (real Kokoro, Node CPU): load time, average and p95 RTF. Record numbers in PROGRESS.md.
- In the report, list what still needs a human: phone RTF and background playback, lock-screen controls, real Google sign-in.

## Android notes
WebGPU support varies; keep the WASM path usable and tested. Generation may be throttled with the screen off, so deepen
the prefetch buffer before lock. If phone RTF stays above ~0.7 at 1x after tuning, record it in DECISIONS.md and
recommend the Capacitor + sherpa-onnx backend.


## Layout note
Imports use the `@/` alias. `engine/` must not import React or app layers (lint-enforced). Put new unit tests under `tests/unit/` mirroring the source path.
