import { create } from 'zustand'
import type { PreparerState } from '@/session/preparer'

/** Progress of "Prepare chapters" (generating audio ahead), mirrored from the session's Preparer. */
export const usePrepare = create<PreparerState>()(() => ({ current: null, queue: [] }))
