import type { BookDoc } from '@/engine/book/types'

export interface OpenBook {
  id: string
  title: string
  cover?: string
  doc: BookDoc
  /** persist progress for this book (false for the scratch TTS test page) */
  persist: boolean
}
