# Plan

Personal read-aloud PWA ("Lumen") for EPUB + text PDF: on-device voices, sentence + word highlight, Google Drive
import + sync, no backend. Also ships as an Android app (Trusted Web Activity in `android/`) for the dictionary helper.

**Scope.** Two voices only: *Natural* (Kokoro-82M `af_heart`) and *Fast* (Piper `en_US-lessac-medium`), with *Auto*
picking between them. Out of scope: AI features, book store, a picker of many voices, other languages (translation is
parked in IDEAS.md), OCR, stats, MP3 export, accounts beyond Google Drive, servers.

## Built (details in PROGRESS.md, reasons in DECISIONS.md)

| Area | What exists |
|---|---|
| Voices | Natural (GPU → threaded CPU → single-thread fallback, WebGPU-fixed model for AMD), Fast, Auto; speed 0.5–3× |
| Readers | EPUB reflow with images and formatting; PDF Original (zoom, pinch, double-tap) + Text mode; column order, smart skip |
| Reading | tap-to-jump, auto-scroll, word chip, where-am-I line, Contents with progress, search, bookmarks, highlights + notes |
| Prepare | generate chapters ahead as Opus, GPU usage slider, Turbo workers |
| Library + data | Dexie, resume (even without audio), rename/delete, 500 MB audio LRU (prepared audio kept) |
| Google Drive | Picker import, `sync.json` (progress, bookmarks, highlights, settings), prepared audio packs, file-imported books copied to Drive |
| Polish | PWA install/offline, Media Session, sleep timer, shortcuts, pronunciation dictionary, Look up (dictionary apps) |
| Android | TWA APK (v1.0.4) with native dictionary chooser and ColorDict popup |

## Open (needs a person or a decision)

1. **Confirm on real devices** (agents can't): the user checklists in `.claude/skills/readaloud-hub/SKILL.md`, plus
   - a book imported from a file on the PC appears on the phone and downloads (2026-11-04);
   - prepared audio made on the PC plays on the phone (2026-11-03);
   - Turbo ×2/×3 on the PC: GPU use, memory returning after the queue, smooth playback during a run (2026-11-03).
2. **No on-screen message when a Drive upload of a book fails** (Drive full, offline); it only retries. Add one if it
   turns out to matter.
3. **No switch to stop copying books to Drive** (prepared audio has one). Add only if Drive space becomes a concern.

Every change must pass `npm run check` and `npm run test:e2e`.
