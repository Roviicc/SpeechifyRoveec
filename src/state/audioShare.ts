import { create } from 'zustand'
import type { AudioShareState } from '@/sync/audio/audioShare'

/** Prepared audio in Google Drive (per book: packs in Drive, missing here, not uploaded, transfers), mirrored from the session. */
export const useAudioShare = create<AudioShareState>()(() => ({ books: {} }))
