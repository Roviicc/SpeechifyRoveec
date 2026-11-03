import { Player, type SeekOffset } from '@/engine/voice/player/player'
import { createBackend, isFakeVoice } from '@/engine/voice/select'
import { isVoiceInstalled } from '@/engine/voice/install'
import { CancelledError, type VoiceModel } from '@/engine/voice/types'
import { PriorityBackend } from '@/engine/voice/priorityBackend'
import { sentenceAt, type BookIndex } from '@/engine/book/bookIndex'
import { getVoicePref, setAutoVoice } from '@/engine/voice/choice/engineChoice'
import { audioStore } from '@/data/audioCache'
import { getContent, saveProgress } from '@/data/repo'
import type { Locator } from '@/data/db'
import { toast } from '@/ui/toast'
import { PREPARE_REST, settingsSnapshot, useSettings } from '@/state/settings'
import { usePlayback } from '@/state/playback'
import { usePrepare } from '@/state/prepare'
import { setupMediaSession, updateMediaPosition } from './mediaSession'
import { DEFAULT_SECONDS_PER_CHAR, estimateTimes, playedFraction, refineSecondsPerChar, sentenceAtFraction, type TimeEstimate } from './estimates'
import { indexBook, resolveStart, watchSettings } from './indexing'
import { ensureModel, resetModelState } from './modelLoader'
import { locatorOf, sectionJumpTarget } from './navigation'
import { progressRecord, ProgressSaver } from './progressSaver'
import { SleepTimer, type SleepMode } from './sleepTimer'
import type { OpenBook } from './types'
import { PREFETCH_VISIBLE, prefetchDepth, watchVisibility } from './visibility'
import { SlowVoiceDetector, slowVoiceAction } from './voiceAutoSwitch'
import { Preparer } from './preparer'
import { hasRoomForPrepared } from './storageRoom'
import { AudioShare } from '@/sync/audio/audioShare'
import { packRanges } from '@/sync/audio/packRanges'
import { autoDownloadAllowed, currentConnection, isOnline } from '@/sync/audio/network'
import { driveConfigured, hasValidToken, isConnected } from '@/sync/drive/google'
import { drive, onSynced } from '@/sync/syncService'
import { useAudioShare } from '@/state/audioShare'
import type { BookDoc } from '@/engine/book/types'

export type { OpenBook } from './types'
export { PREFETCH_HIDDEN, PREFETCH_VISIBLE } from './visibility'

type IndexListener = (index: BookIndex) => void

/**
 * The single playback session: one Player, the open book and its sentence index.
 * The pieces (sleep timer, progress saving, estimates, voice auto-switch, ...) live in ./playback/;
 * this class wires them to the player and the playback store.
 */
class Session {
  /** the voice, shared by the player (first) and the preparer (background lane) */
  readonly backend: PriorityBackend
  readonly player: Player
  /** generates chapters' audio ahead of time ("Prepare" in Contents) */
  readonly preparer: Preparer
  /** shares prepared audio with the user's other devices through Google Drive */
  readonly share: AudioShare
  private preparedListeners = new Set<(bookId: string, index: number) => void>()
  book: OpenBook | null = null
  index: BookIndex | null = null
  /** Seconds of audio per spoken character at 1x (refined from real audio as it is generated). */
  secondsPerChar = DEFAULT_SECONDS_PER_CHAR
  private indexListeners = new Set<IndexListener>()
  private readonly sleep: SleepTimer
  private readonly progress: ProgressSaver
  private readonly slowVoice = new SlowVoiceDetector()

  constructor() {
    // the player's own requests (current sentence + prefetch) always go before background preparation
    this.backend = new PriorityBackend(createBackend(), () => this.player.generating)
    // saved audio is labelled with the voice that made it, so switching voices never replays the other voice
    audioStore.voice = () => this.voice()
    this.player = new Player({
      backend: this.backend,
      store: audioStore,
      prefetch: PREFETCH_VISIBLE,
      // the live voice is only loaded when a sentence has no stored audio (prepared audio never needs it)
      beforeGenerate: (current) => this.liveVoiceNeeded(current),
    })
    this.preparer = new Preparer({
      generate: (text) => this.backend.generateBackground(text),
      store: audioStore,
      voice: () => this.voice(),
      sentences: (bookId) => this.sentenceTexts(bookId),
      hasRoom: () => hasRoomForPrepared(() => audioStore.preparedTotal()),
      msPerCharGuess: () => {
        const rtf = this.player.rtf ?? this.backend.info?.testRtf ?? 1
        return rtf * this.secondsPerChar * 1000
      },
      restFactor: () => PREPARE_REST[useSettings.getState().prepareSpeed] ?? 0,
      onSentence: (bookId, index) => {
        this.preparedListeners.forEach((fn) => fn(bookId, index))
        if (this.shareOn()) this.share.scheduleUpload(bookId)
      },
    })
    this.share = this.createShare()
    let lastError: string | undefined
    let lastJob: { bookId: string } | null = null
    this.preparer.subscribe((st) => {
      usePrepare.setState(st, true)
      if (st.error && st.error !== lastError) toast(st.error, 7000)
      lastError = st.error
      // a preparation run ended: upload what it made right away
      const job = st.current?.job ?? null
      if (lastJob && job !== lastJob && this.shareOn()) this.share.scheduleUpload(lastJob.bookId, 300)
      lastJob = job
    })
    this.applySpeed(useSettings.getState().speed)

    this.sleep = new SleepTimer({
      fadeOut: (ms) => void this.player.fadeOutAndPause(ms),
      publish: (sleep) => usePlayback.setState({ sleep }),
      getState: () => usePlayback.getState().sleep,
    })
    this.progress = new ProgressSaver(
      () => ({ book: this.book, index: this.index, sentence: this.player.index }),
      (p) => saveProgress(p),
    )
    this.wirePlayer()
    setupMediaSession(this)

    watchSettings({
      speed: () => this.player.speed,
      // speed can also change from sync (settings replaced from another device)
      onSpeed: (speed) => this.applySpeed(speed),
      // smart-skip or pronunciation changed: rebuild the sentence index
      onIndexSettings: () => this.reindex(),
    })
    watchVisibility((hidden) => {
      // screen locked / app in background: the browser may throttle us, so build a bigger audio buffer
      this.player.setPrefetchDepth(prefetchDepth(hidden))
      if (hidden) void this.saveNow()
    })
  }

  private wirePlayer() {
    const p = this.player
    p.on('state', (state) => {
      usePlayback.setState({ state, error: state === 'error' ? usePlayback.getState().error : undefined })
      if (state === 'playing' || state === 'buffering') this.viewLocator = null
      if (state === 'paused' || state === 'ended') void this.saveNow()
      updateMediaPosition(this)
    })
    p.on('sentence', (i) => {
      this.viewLocator = null
      const section = this.index?.sentences[i]?.section ?? 0
      const { section: prevSection, index: prevIndex } = usePlayback.getState()
      usePlayback.setState({ index: i, section })
      this.sleep.onSentence({ prevIndex, prevSection, index: i, section, active: p.isActive })
      this.progress.saveIfDue()
      updateMediaPosition(this)
    })
    p.on('error', (e) => usePlayback.setState({ error: e.message }))
    p.on('chunk', ({ index, duration }) => {
      const s = this.index?.sentences[index]
      if (s) this.secondsPerChar = refineSecondsPerChar(this.secondsPerChar, duration, s.chars)
    })
    p.on('rtf', (rtf) => {
      usePlayback.setState({ rtf })
      if (this.slowVoice.observe(rtf, p.speed, this.voice())) this.onVoiceTooSlow()
    })
  }

  /** Drive connected (with a token) and "Share prepared audio" on. */
  shareOn(): boolean {
    return driveConfigured && isConnected() && hasValidToken() && useSettings.getState().shareAudio
  }

  private createShare(): AudioShare {
    const share = new AudioShare({
      drive,
      store: audioStore,
      enabled: () => this.shareOn(),
      book: async (bookId) => {
        const b = await this.bookData(bookId).catch(() => null)
        return b && { texts: b.index.sentences.map((s) => s.spoken.text), ranges: packRanges(b.doc.toc, b.index) }
      },
      position: (bookId) => (this.book?.id === bookId ? this.player.index : 0),
      preparing: (bookId, from, to) => {
        const st = this.preparer.snapshot
        const hit = (j: { bookId: string; from: number; to: number }) => j.bookId === bookId && j.from <= to && j.to >= from
        return (!!st.current && hit(st.current.job)) || st.queue.some(hit)
      },
      autoAllowed: () => autoDownloadAllowed(),
      online: isOnline,
      isAutoBlocked: (bookId) => noAutoBooks().includes(bookId),
      setAutoBlocked: (bookId, blocked) => {
        const list = noAutoBooks().filter((b) => b !== bookId)
        if (blocked) list.push(bookId)
        try {
          localStorage.setItem(NO_AUTO_KEY, JSON.stringify(list))
        } catch {
          // storage unavailable: the block lasts this session only
        }
      },
      onSentence: (bookId, index) => this.preparedListeners.forEach((fn) => fn(bookId, index)),
      onError: (message) => toast(message, 8000),
    })
    share.subscribe((st) => useAudioShare.setState(st, true))
    // look for prepared audio of the open book after every sync, and carry on when back online / on Wi‑Fi
    onSynced(() => this.lookForSharedAudio())
    if (typeof window !== 'undefined') {
      const again = () => {
        share.resume()
        this.lookForSharedAudio()
      }
      window.addEventListener('online', again)
      currentConnection()?.addEventListener?.('change', again)
    }
    return share
  }

  /** Download the open book's prepared audio from Drive (automatic rules: Wi‑Fi, not deleted here). */
  private lookForSharedAudio() {
    if (this.book?.persist && this.shareOn()) void this.share.download(this.book.id)
  }

  /**
   * The player is about to generate a sentence with the live voice. Load the voice if it's on the device; if it would
   * have to be downloaded first, ask (only for the sentence to play now; prefetches just wait).
   */
  private async liveVoiceNeeded(current: boolean) {
    const status = usePlayback.getState().model.status
    if (status === 'ready' || status === 'loading' || status === 'downloading') return
    if (isFakeVoice() || (await isVoiceInstalled(this.voice()).catch(() => false))) {
      void this.ensureModel()
      return
    }
    if (current && !usePlayback.getState().downloadPrompt) {
      this.player.pause()
      this.pendingStart = () => this.player.play()
      usePlayback.setState({ downloadPrompt: this.voice() })
    }
    throw new CancelledError()
  }

  /** Whether sentence `i` of the open book has stored audio (prepared, or played before with this voice). */
  private async hasStoredAudio(i: number): Promise<boolean> {
    const s = this.index?.sentences[i]
    if (!this.book || !s) return false
    try {
      return (await audioStore.lookup(this.book.id, [{ index: i, text: s.spoken.text }])).cached.has(i)
    } catch {
      return false
    }
  }

  /**
   * Start playback at sentence `i`. When the voice isn't loaded yet and that sentence has stored audio, play right
   * away without touching the voice (it is loaded later, only if a sentence without audio comes up).
   */
  private startAt(i: number, start: () => void, beforeAsking?: () => void) {
    if (usePlayback.getState().model.status !== 'idle') {
      void this.ensureModel()
      start()
      return
    }
    void this.hasStoredAudio(i).then((stored) => {
      if (stored) start()
      else
        this.withDownloadConsent(() => {
          void this.ensureModel()
          start()
        }, beforeAsking)
    })
  }

  /** Kokoro can't keep up on this device (reported once per engine). */
  private onVoiceTooSlow() {
    if (slowVoiceAction(getVoicePref()) === 'switch') {
      // Auto: switch to the fast voice right away, keep playing from the same sentence
      setAutoVoice('piper')
      this.switchEngine()
      toast('Switched to the fast voice so playback stays smooth on this device.', 6000)
    } else {
      toast('This device is too slow for the natural voice. For smooth playback choose Settings → Voice → Fast (Piper).', 9000)
    }
  }

  private applySpeed(speed: number) {
    this.player.setSpeed(speed)
    usePlayback.setState({ speed: this.player.speed })
  }

  onIndex(fn: IndexListener): () => void {
    this.indexListeners.add(fn)
    if (this.index) fn(this.index)
    return () => this.indexListeners.delete(fn)
  }

  /** Voice currently in use (fake backend reports kokoro). */
  voice(): VoiceModel {
    return (this.backend as { voice?: VoiceModel }).voice ?? 'kokoro'
  }

  /** A book's text and sentence index, exactly as the player reads it (same index settings). */
  private async bookData(bookId: string): Promise<{ doc: BookDoc; index: BookIndex }> {
    if (this.book?.id === bookId && this.index) return { doc: this.book.doc, index: this.index }
    const doc = await getContent(bookId)
    // the book was deleted meanwhile: nothing to do
    if (!doc) throw new CancelledError()
    return { doc, index: indexBook(doc, settingsSnapshot()) }
  }

  /** Spoken text of every sentence of a book, exactly as the player reads it (same index settings). */
  private async sentenceTexts(bookId: string): Promise<string[]> {
    return (await this.bookData(bookId)).index.sentences.map((s) => s.spoken.text)
  }

  /**
   * Generate the audio of sentences `from..to` of a book ahead of time (queued behind earlier requests). Asks before
   * a first-time voice download, like play.
   */
  prepare(bookId: string, from: number, to: number, label: string) {
    this.withDownloadConsent(() => {
      void this.ensureModel()
      void requestPersistentStorage()
      this.preparer.enqueue(bookId, from, to, label)
    })
  }

  /** A sentence of some book got its prepared audio (Contents updates its marks). */
  onPrepared(fn: (bookId: string, index: number) => void): () => void {
    this.preparedListeners.add(fn)
    return () => this.preparedListeners.delete(fn)
  }

  /** Switch the voice engine (Auto / GPU / Processor): unload the model; it reloads on the next play. */
  switchEngine() {
    const wasActive = this.player.isActive
    this.player.pause()
    this.backend.reset?.()
    this.player.dropAudio()
    this.player.resetRtf()
    this.slowVoice.reset()
    resetModelState()
    if (wasActive) this.play()
  }

  /** Make sure the voice model is loading; reports download progress to the store. */
  ensureModel(): Promise<void> {
    return ensureModel(this.backend)
  }

  open(book: OpenBook, start?: Locator | number) {
    if (this.book?.id === book.id && this.index) {
      this.book = book
      if (start !== undefined) this.seekTo(start, false)
      return
    }
    if (this.book?.persist) void this.saveNow()
    this.player.pause()
    this.book = book
    const idx = indexBook(book.doc, settingsSnapshot())
    this.index = idx
    this.player.setSource(
      { bookId: book.id, count: idx.sentences.length, text: (i) => idx.sentences[i].spoken.text },
      resolveStart(idx, start),
    )
    usePlayback.setState({
      bookId: book.id,
      title: book.title,
      cover: book.cover,
      count: idx.sentences.length,
      index: this.player.index,
      section: idx.sentences[this.player.index]?.section ?? 0,
      state: 'idle',
    })
    this.indexListeners.forEach((fn) => fn(idx))
    updateMediaPosition(this)
    void this.preloadVoice()
    this.lookForSharedAudio()
  }

  /** If the voice is already on this device, load it in the background so the first play starts quickly. */
  private async preloadVoice() {
    if (isFakeVoice() || usePlayback.getState().model.status !== 'idle') return
    if (await isVoiceInstalled(this.voice()).catch(() => false)) void this.ensureModel()
  }

  /**
   * Run `start` now, or first ask before a voice download: when no voice has been loaded yet and the voice's files
   * are not on this device, a sheet asks for OK (size, offline, mobile data). The sheet calls confirmDownload().
   */
  private withDownloadConsent(start: () => void, beforeAsking?: () => void) {
    if (isFakeVoice() || usePlayback.getState().model.status !== 'idle') return start()
    void isVoiceInstalled(this.voice())
      .catch(() => false)
      .then((installed) => {
        if (installed) return start()
        beforeAsking?.()
        this.pendingStart = start
        usePlayback.setState({ downloadPrompt: this.voice() })
      })
  }

  private pendingStart: (() => void) | null = null

  /** The user agreed to download the voice: start what they asked for. */
  confirmDownload() {
    usePlayback.setState({ downloadPrompt: null })
    const start = this.pendingStart
    this.pendingStart = null
    void this.ensureModel()
    start?.()
  }

  /** Load the current voice (asking first if it must be downloaded), without starting playback. */
  prepareVoice() {
    this.withDownloadConsent(() => void this.ensureModel())
  }

  cancelDownload() {
    usePlayback.setState({ downloadPrompt: null })
    this.pendingStart = null
  }

  close() {
    void this.saveNow()
    this.player.pause()
    this.book = null
    this.index = null
    usePlayback.setState({ bookId: null, title: '', state: 'idle', count: 0, index: 0 })
  }

  /** Rebuild the index of the open book, keeping the position (by locator) and playing state. */
  private reindex() {
    if (!this.book || !this.index) return
    const loc = this.locator()
    const wasActive = this.player.isActive
    const book = this.book
    this.book = null
    this.index = null
    this.open(book, loc ?? 0)
    if (wasActive) this.play()
  }

  /** Stable locator of the current sentence. */
  locator(i = this.player.index): Locator | null {
    return locatorOf(this.index, i)
  }

  play() {
    this.startAt(this.player.index, () => this.player.play())
  }

  toggle() {
    if (this.player.isActive) this.player.pause()
    else this.play()
  }

  seekTo(target: Locator | number, autoplay?: boolean, offset: SeekOffset = 0) {
    if (!this.index) return
    const i = typeof target === 'number' ? target : resolveStart(this.index, target)
    if (!autoplay) return this.player.seek(i, offset, autoplay)
    this.startAt(
      i,
      () => this.player.seek(i, offset, true),
      // while the download question is open, already move to the tapped spot
      () => this.player.seek(i, offset, false),
    )
  }

  nextSection(dir: 1 | -1) {
    if (!this.index) return
    const target = sectionJumpTarget(this.index, this.player.index, dir)
    if (target !== null) this.seekTo(target)
  }

  setSpeed(speed: number) {
    this.applySpeed(speed)
    useSettings.getState().set({ speed: this.player.speed })
    updateMediaPosition(this)
  }

  estimate(): TimeEstimate {
    const within = playedFraction(this.player.currentTime, this.player.duration)
    return estimateTimes(this.index, this.player.index, within, this.secondsPerChar, this.player.speed)
  }

  /** Map a fraction of the book (0..1) to a sentence index. */
  sentenceAtFraction(f: number): number {
    return sentenceAtFraction(this.index, f)
  }

  /**
   * Where the reader is looking, when it differs from the voice: set while reading without audio (the user scrolled),
   * cleared as soon as the voice moves. While set, it is what gets saved, so reopening the book returns to the page
   * the reader was on, not to where the audio stopped earlier.
   */
  private viewLocator: Locator | null = null

  /** Remember the reading position from the screen (only when the voice is not playing). */
  saveViewPosition(loc: Locator) {
    if (this.player.isActive || !this.book?.persist || !this.index) return
    this.viewLocator = loc
    void this.saveNow()
  }

  saveNow(): Promise<void> {
    const loc = this.viewLocator
    if (loc && this.index && !this.player.isActive) {
      const rec = progressRecord({ book: this.book, index: this.index, sentence: sentenceAt(this.index, loc.block, loc.offset) })
      return rec ? saveProgress({ ...rec, locator: loc }) : Promise.resolve()
    }
    return this.progress.saveNow()
  }

  setSleep(mode: SleepMode) {
    this.sleep.set(mode)
  }

  clearSleep() {
    this.sleep.clear()
  }
}

const NO_AUTO_KEY = 'lumen-audio-noauto'
/** Books whose prepared audio the user deleted on this device (no automatic download from Drive). */
function noAutoBooks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(NO_AUTO_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

let persistAsked = false
/** Ask once for persistent storage, so the browser doesn't clear prepared audio under storage pressure. */
async function requestPersistentStorage() {
  if (persistAsked) return
  persistAsked = true
  await navigator.storage?.persist?.().catch(() => false)
}

let instance: Session | null = null
export function session(): Session {
  instance ??= new Session()
  return instance
}
export type { Session }
