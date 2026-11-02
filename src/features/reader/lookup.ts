import { toast } from '@/ui/toast'

export type LookupApp = 'share' | 'colordict'

/** Text to send: a single word as-is, longer selections trimmed (dictionary apps expect a word or short phrase). */
function cleanQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^[“"'‘([]+|[”"'’).,;:!?\]]+$/g, '').slice(0, 200)
}

/**
 * ColorDict listens for the Android intent `colordict.intent.action.SEARCH` (the one Moon+ Reader uses). Chrome can
 * only start it through an `intent:` URL, and only if ColorDict accepts launches from the browser — that can't be
 * detected, so if the page is still visible shortly after, we say so.
 */
function openColorDict(query: string) {
  const url =
    'intent:#Intent;action=colordict.intent.action.SEARCH;package=com.socialnmobile.colordict;' +
    `S.EXTRA_QUERY=${encodeURIComponent(query)};B.EXTRA_FULLSCREEN=false;end`
  let left = false
  const onHide = () => (left = true)
  document.addEventListener('visibilitychange', onHide, { once: true })
  location.href = url
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    if (!left && document.visibilityState === 'visible')
      toast('ColorDict didn’t open from the browser. In Settings → Reading, set “Look up words with” to “Choose app”.', 8000)
  }, 1800)
}

/** Look a word up in another app: the Android share picker (pick ColorDict, Translate, ...) or ColorDict directly. */
export async function lookUp(text: string, app: LookupApp) {
  const query = cleanQuery(text)
  if (!query) return
  if (app === 'colordict') return openColorDict(query)
  if (navigator.share) {
    try {
      await navigator.share({ text: query })
    } catch {
      /* user closed the picker */
    }
    return
  }
  await navigator.clipboard?.writeText(query).catch(() => {})
  toast(`Copied “${query}” — sharing isn’t available in this browser`)
}
