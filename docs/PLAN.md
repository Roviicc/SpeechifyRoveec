# Plan

Personal read-aloud PWA (EPUB + text PDF), one fixed Kokoro voice (`af_heart`), sentence + word highlight,
Drive import + appDataFolder sync, no backend. Out of scope: AI features, store, voice picker, other languages,
OCR, stats, MP3 export, accounts beyond Google Drive, servers.

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Voice test page (`#/tts`) | paste → play; sentence + word highlight; tap-to-jump; speed 0.5–3× |
| 2 | EPUB reader wired to TTS | TOC, Aa settings, themes, auto-scroll + "Jump to current" |
| 3 | PDF reader | Original (canvas + text layer, zoom 50–300%, pinch) + Text mode; smart skip |
| 4 | Library + data | progress/resume, bookmarks, highlights + notes, in-book search, rename/delete |
| 5 | Google Drive | Picker import (`drive.file`), `sync.json` in appDataFolder (`drive.appdata`) |
| 6 | Polish | PWA install/offline shell, Media Session, sleep timer, shortcuts, pronunciation dictionary |

Every change must pass `npm run check` and `npm run test:e2e`.
