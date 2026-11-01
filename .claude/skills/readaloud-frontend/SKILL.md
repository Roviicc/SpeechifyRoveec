---
name: readaloud-frontend
description: Use when building UI for the Speechify-lite (Lumen) reader app - library, import sheet, reader screen, player bar, Aa/theme settings, EPUB/PDF rendering, highlighting, auto-scroll and tap-to-jump.
---

# ReadAloud Frontend

React + Vite + TypeScript + Tailwind v4. Mobile-first (design at 390x844, verify at 1280x800). Layout modeled on
Speechify's core screens with our own name ("Lumen"), colors and icons: never use Speechify's logo, name or artwork.

## Design tokens (CSS variables in src/index.css, themed via `data-theme` on <html>)
- Themes: `light` (bg #FFFFFF, text #1B1F2A), `sepia` (bg #F6EFDF, text #3B2F21), `dark` (bg #111318, text #E8EAF0),
  `system` follows prefers-color-scheme (applyTheme in src/state/settings.ts).
- Primary #2F54EB (dark theme #6B8BFF). Sentence highlight = primary ~14% alpha; word highlight ~35%.
- Radius: cards 16px, sheets 24px top, buttons fully round. Spacing 4/8/12/16/24/32. Tap targets >= 44px.
- Tailwind colors map to the variables (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `bg-primary`...).
  No hard-coded colors in components. Icons: lucide-react.

## Screens
- **Bottom nav**: Library | large round "+" (center, primary) | Settings. Mini player above it while a book is open.
- **Library**: header + search; rows = thumbnail, 1-line title, grey meta "12% • Today • pdf", "•••" (Rename, Delete).
  Empty state "Import your first book".
- **Import sheet**: "Import", close X, two rows only: Files, Google Drive.
- **Reader**: top bar (down-chevron, title, Aa, bookmark, Original/Text toggle for PDFs, "•••" with Search /
  Notes & Bookmarks / Sleep timer). Floating TOC button bottom-left. Player bar: seekable progress with
  elapsed/remaining; « prev sentence, large round play/pause, » next sentence, chapter skip, circular "1.5x" speed.
- **Sheets**: Aa (size 12-32, Serif/Sans/OpenDyslexic, line spacing 1.2-2.2, margins, theme), Speed (0.5-3.0 step 0.1
  + chips), Notes & Bookmarks, Sleep timer. One reusable `<Sheet>` (src/ui/Sheet.tsx: focus trap, swipe-down/Esc to close, restores focus).

## Reader rendering
- Both readers produce a `BookDoc` (src/engine/book/types.ts) flattened by `buildBookIndex` into blocks + sentences.
- **Reflow** (EPUB, PDF Text mode, voice test): `views/ReflowView` renders blocks as `[data-b]` elements; `highlight/surface.ts` ReflowSurface maps block offsets <-> DOM ranges.
- **PDF Original** (`views/PdfView`): canvas + pdf.js text layer, rendered lazily near the viewport (IntersectionObserver).
  Zoom 50-300% via buttons, pinch (CSS transform during the gesture, re-render at the end) and ctrl+wheel. Default fit-to-width.
  `PdfSurface` maps block offsets to text-layer spans via the block's PdfSpan table.

## Highlighting (performance-critical)
- **CSS Custom Highlight API** only (`CSS.highlights.set('tts-sentence', new Highlight(range))`, styled with `::highlight(...)`): no DOM mutation (src/features/reader/highlight/highlighter.ts).
- Word highlight updates on a requestAnimationFrame loop reading the player's currentTime against word timings (highlight/useReaderSync.ts). Never store the current word in React state.
- Sentence highlight changes on the player's `sentence` event.

## Auto-scroll and tap-to-jump
- Keep the current sentence in the upper third. Wheel/touch/keys pause auto-scroll and show a "Jump to current" pill (highlight/autoScroll.ts).
- Tap: `caretPositionFromPoint` / `caretRangeFromPoint` -> surface.locate -> playFrom (word-accurate fraction). Text selections start the highlight/note toolbar instead.

## State
Zustand for UI state (src/state); settings persisted in localStorage. The engine is used through `session()` (src/session/session.ts) and `usePlayback`.

## Accessibility
Labels on icon buttons, visible focus rings, `aria-live="polite"` status, prefers-reduced-motion respected, contrast >= 4.5:1 in all themes including highlights.

## Testing (must pass before reporting done)
- `npm run check` (typecheck, lint, unit tests, build).
- Playwright e2e with the fake voice (`?tts=fake`, webServer sets VITE_TTS=fake), e.g.:
  open fixture book -> play -> sentence highlight moves to sentence 2; tap a word in a later paragraph -> highlight jumps;
  change speed -> playbackRate updated; switch light/sepia/dark -> highlight still visible; scroll away -> "Jump to current" -> returns.
- Keep stable `data-testid`s on player controls, sheets and library rows.
- Screenshots of every changed screen (helpers.shot -> screenshots/) at phone and 1280x800 in light and dark; **look at them**
  and fix anything misaligned, clipped or low-contrast before reporting.
- List anything only a human can judge (feel of scrolling, highlight sync on a real phone) in your report.


## Layout note
Imports use the `@/` alias. `engine/` must not import React or app layers (lint-enforced). Put new unit tests under `tests/unit/` mirroring the source path.
