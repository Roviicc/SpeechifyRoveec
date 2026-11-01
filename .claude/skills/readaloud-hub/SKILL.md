---
name: readaloud-hub
description: Use when coordinating the Speechify-lite (Lumen) reader app build - planning a phase, splitting it into tasks, delegating to subagents, reviewing and testing their work and keeping the plan current.
---

# ReadAloud Hub (orchestrator)

This conversation is the **hub**. It plans, delegates, reviews, tests and integrates. Feature work is done by
**subagents** (nested sessions), each with a narrow, well-briefed task. The hub only edits code directly for small
fixes (a handful of lines) or integration glue.

## Project at a glance
Personal Speechify-lite PWA ("Lumen"): EPUB + PDF reader that reads aloud with one fixed Kokoro English voice
(`af_heart`), sentence + word highlight, tap-to-jump, speed 0.5x-3x, themes, Aa settings, PDF zoom, Google Drive
import + sync. React + Vite + TypeScript + Tailwind, kokoro-js in a Web Worker, pdfjs-dist, own EPUB parser (JSZip),
Dexie, Google Identity Services + Picker. No backend server.

Out of scope (refuse scope creep, note ideas in docs/IDEAS.md instead): AI chat/summaries/quizzes, book store,
voice picker, other languages, OCR, stats, MP3 export, accounts, servers.

## Source of truth (read at the start of every session)
- `docs/PLAN.md` - phases, deliverables, "done when" criteria
- `docs/PROGRESS.md` - dated log: what was finished, verified how, RTF numbers, what's open
- `docs/DECISIONS.md` - short decision records (context, decision, why)

## Phases
1. TTS test page (paste text, play, sentence+word highlight, tap-to-jump, speed)
2. EPUB reader wired to TTS
3. PDF reader (Original + Text modes, zoom, smart skip)
4. Library + Dexie data (progress, bookmarks, highlights, search)
5. Google Drive import + appDataFolder sync
6. PWA install, Media Session, sleep timer, shortcuts, pronunciation list
All six are implemented (see PROGRESS.md); new work is fixes and improvements.

## Workflow per task
1. **Orient**: read PLAN/PROGRESS/DECISIONS; restate the goal and acceptance criteria in 3-5 lines.
2. **Split**: 2-5 tasks, each owning a clear set of files/folders. Tasks touching the same files run one after
   another; independent tasks run in parallel (launch them in one message, each in its own worktree).
3. **Brief** each subagent with the template below. Name the skill it must load: `readaloud-frontend` for
   UI/readers/highlighting, `readaloud-engine` for TTS/text pipeline/data/Drive.
4. **Review** every result: read the diff, run all automated tests yourself, check acceptance criteria.
   A report of "done" without test output is not done.
5. **Integrate**: merge, fix glue, update PROGRESS.md (and DECISIONS.md if a choice was made), commit.
6. **Hand over**: tell the user what works, how to run it, and give them the matching **user checklist**.

## Subagent brief template
```
Goal: <one sentence>
Load skill: <readaloud-frontend | readaloud-engine>
Context: <what already exists, relevant decisions>
You own these files: <paths> (don't edit others; if you must, say why)
Read first: <specific files>
Acceptance criteria:
- <observable behavior>
Tests to add/update: <unit / e2e / visual>
Verify with: npm run check && npm run test:e2e
Return: changed files, test output summary, screenshots taken, known issues, follow-ups.
```

## Codebase layout
```
src/
  app/        App shell, hash router, playback session (session.ts), Media Session
  features/   library/ import/ reader/ (ReflowView, PdfView, PlayerBar, sheets, highlighter, autoScroll, surface) settings/ ttstest/
  engine/
    tts/      TtsBackend interface, KokoroBackend + worker, FakeTtsBackend, Player
    text/     sentence splitter, smart skip, pronunciation, spoken text, word timing (pure)
    doc/      EPUB parser, PDF extraction + layout, bookIndex (blocks -> sentences)
  data/       Dexie db, repositories, audio cache
  sync/       Google auth + Picker, Drive client, FakeDrive, merge, syncCore, syncService
  ui/         shared components
docs/ tests/unit/ tests/e2e/ tests/fixtures/ scripts/
```

## Testing (what agents verify themselves)
`npm run check` = typecheck + lint + unit tests + build. Required after every task.

| Layer | Tool | What it proves |
|---|---|---|
| Types, lint, build | tsc, eslint, vite build | Code compiles and builds for production |
| Text logic | Vitest | Splitting, smart skip, pronunciation, word timing on tricky fixtures |
| Data + sync | Vitest + fake-indexeddb + FakeDrive | Progress/bookmark save, merge rules, tombstones |
| App flows | Playwright + fake voice (`?tts=fake`) | Import, play, highlight advances, tap-to-jump, speed, themes, resume |
| Visual | Playwright screenshots (`screenshots/`) at phone + 1280x800, light/dark | Agent inspects images before reporting |
| Real TTS speed | `npm run bench:tts`, `?debug=1` overlay | Real-time factor per sentence |

### What agents cannot verify (always goes to the user checklist)
Android performance and background audio, lock-screen controls, how the voice and highlight feel,
real Google sign-in and Drive, real WebGPU speed.

## User checklists (~2 minutes each)
- **Voice**: open the Voice test page on laptop and phone; play at 1x and 2x; tap a word mid-text; note RTF in `?debug=1`.
- **EPUB**: play a full chapter on the phone; change font size and theme while playing; scroll away and use "Jump to current"; TOC jump.
- **PDF**: open a real PDF; confirm headers, page numbers and [citations] aren't read; pinch-zoom in Original; switch to Text.
- **Library & data**: import 3 books; close mid-chapter and reopen (resumes?); add a bookmark and a highlight with a note; search a word.
- **Drive**: connect; import from Drive; read on laptop, then open on phone (offered to continue?); delete a bookmark on one device.
- **Install & polish**: install from Chrome on Android; lock the screen for 2 minutes; lock-screen controls; 15-minute sleep timer; desktop shortcuts.

## Code standards
TypeScript strict, no `any`. Small components; logic in hooks or plain modules. `engine/text` = pure functions with
unit tests. Conventional commits, one logical change each.

## Efficiency rules
- Don't delegate what takes fewer than ~5 tool calls; do it inline.
- Give subagents only the files and decisions they need.
- One subagent per independent area; never two on the same files at once.
- Finish and verify one vertical slice before starting several.
- When a result fails a criterion, send it back with the specific failing test rather than rewriting it yourself.
