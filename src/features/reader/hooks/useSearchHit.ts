import { useEffect, useRef } from 'react'
import type { Highlighter } from '@/features/reader/highlight/highlighter'
import type { SearchHit } from '@/features/reader/sheets'

const SEARCH_HIT_MS = 4000

/** Marks a search hit in the text for a few seconds. */
export function useSearchHit(highlighter: Highlighter) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = (hit: SearchHit) => {
    highlighter.setSearchHit(hit)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => highlighter.setSearchHit(null), SEARCH_HIT_MS)
  }
  const clear = () => highlighter.setSearchHit(null)

  return { show, clear }
}
