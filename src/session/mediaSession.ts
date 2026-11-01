import type { Player } from '@/engine/voice/player/player'
import type { BookIndex } from '@/engine/book/bookIndex'
import type { OpenBook } from './types'
import type { TimeEstimate } from './estimates'

/** What the Media Session needs from the playback session. */
export interface MediaSessionHost {
  readonly player: Player
  readonly book: OpenBook | null
  readonly index: BookIndex | null
  play(): void
  estimate(): TimeEstimate
}

function mediaSession(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null
}

/** Lock-screen / notification controls: title, play/pause, next/previous sentence. */
export function setupMediaSession(s: MediaSessionHost) {
  const ms = mediaSession()
  if (!ms) return
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, fn)
    } catch {
      /* unsupported action */
    }
  }
  set('play', () => s.play())
  set('pause', () => s.player.pause())
  set('stop', () => s.player.pause())
  set('previoustrack', () => s.player.prev())
  set('nexttrack', () => s.player.next())
  set('seekbackward', () => s.player.prev())
  set('seekforward', () => s.player.next())
}

export function updateMediaPosition(s: MediaSessionHost) {
  const ms = mediaSession()
  if (!ms) return
  const book = s.book
  if (!book) {
    ms.metadata = null
    ms.playbackState = 'none'
    return
  }
  const section = s.index?.sentences[s.player.index]?.section ?? 0
  const chapter = book.doc.sections[section]?.title ?? ''
  const artwork = book.cover ? [{ src: book.cover, sizes: '256x256', type: 'image/jpeg' }] : [{ src: '/pwa-512.png', sizes: '512x512', type: 'image/png' }]
  if (typeof MediaMetadata !== 'undefined') {
    if (ms.metadata?.title !== book.title || ms.metadata?.album !== chapter) {
      ms.metadata = new MediaMetadata({ title: book.title, artist: book.doc.author ?? 'Lumen', album: chapter, artwork })
    }
  }
  ms.playbackState = s.player.isActive ? 'playing' : 'paused'
  try {
    const est = s.estimate()
    if (est.total > 0) {
      ms.setPositionState({ duration: est.total, position: Math.min(est.elapsed, est.total), playbackRate: s.player.speed })
    }
  } catch {
    /* ignore */
  }
}
